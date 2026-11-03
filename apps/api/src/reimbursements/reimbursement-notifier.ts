import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import type { NotificationKind, Prisma } from "../generated/prisma/client.js";
import { MailService } from "../mail/mail.service.js";
import { renderNotificationEmail, type MailLogo, type NotificationTemplate } from "../mail/templates.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BrandLogoService } from "../settings/brand-logo.service.js";
import { SettingsService } from "../settings/settings.service.js";
import type { SubjectEvent } from "../workflows/subject-handlers.js";
import { WorkflowEngineService } from "../workflows/workflow-engine.service.js";

type Tx = Prisma.TransactionClient;

const POLL_MS = 30_000;
const BATCH = 20;
/** Un envoi réservé mais jamais terminé (arrêt du serveur) est repris après ce délai. */
const LEASE_MS = 10 * 60_000;
/** Délai avant le prochain essai, selon le nombre d'essais déjà faits ; au-delà, l'envoi est abandonné. */
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

const TEMPLATES: Record<NotificationKind, NotificationTemplate> = {
  REIMBURSEMENT_TO_DECIDE: "TO_DECIDE",
  REIMBURSEMENT_TO_PAY: "TO_PAY",
  REIMBURSEMENT_APPROVED: "APPROVED",
  REIMBURSEMENT_RETURNED: "RETURNED",
  REIMBURSEMENT_REFUSED: "REFUSED",
  REIMBURSEMENT_PAID: "PAID",
};

/**
 * Notifications par email des demandes de remboursement (ADR 0035, tranche 4). Elles sont **écrites dans la transaction de la
 * décision** (file `NotificationOutbox`) puis envoyées en arrière-plan avec de nouveaux essais : un email qui échoue ne défait
 * jamais une décision. Sans SMTP, rien n'est écrit et l'application fonctionne comme avant (on consulte « À faire »). Le message
 * reste minimal (qui, quelle demande, un lien) : l'état affiché dans l'application fait foi.
 */
@Injectable()
export class ReimbursementNotifier implements OnApplicationShutdown {
  private readonly logger = new Logger(ReimbursementNotifier.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkflowEngineService) private readonly engine: WorkflowEngineService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(BrandLogoService) private readonly logos: BrandLogoService,
  ) {}

  /** Lance l'envoi périodique (appelé au démarrage du serveur, jamais dans les tests). Sans SMTP, il ne fait rien. */
  start(): void {
    if (this.timer || !this.mail.enabled) return;
    this.timer = setInterval(() => {
      this.dispatchDue().catch((error: unknown) => this.logger.warn(`Envoi des notifications impossible (${error instanceof Error ? error.message : "erreur inconnue"})`));
    }, POLL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Écrit les notifications que cet événement du circuit déclenche. À appeler dans la transaction de la décision. */
  async enqueue(event: SubjectEvent, tx: Tx): Promise<void> {
    if (!this.mail.enabled) return;
    const actors = new Set((event.decisions ?? []).map((d) => d.actorUserId));
    const rows: { kind: NotificationKind; recipientUserId: string }[] = [];
    const toRequester = (kind: NotificationKind) => {
      if (!actors.has(event.requesterUserId)) rows.push({ kind, recipientUserId: event.requesterUserId });
    };

    if (event.type === "RETURNED") toRequester("REIMBURSEMENT_RETURNED");
    else if (event.type === "REFUSED") toRequester("REIMBURSEMENT_REFUSED");
    else if (event.type === "COMPLETED") toRequester("REIMBURSEMENT_PAID");
    else if (event.type === "STEP_ACTIVATED" || event.type === "RESUMED") {
      if ((event.decisions ?? []).some((d) => d.outcome === "APPROVED")) toRequester("REIMBURSEMENT_APPROVED");
      if (event.nodeId) {
        const step = await this.engine.designatedUsers(event.instanceId, event.nodeId, tx);
        if (step) {
          const kind: NotificationKind = step.stepType === "PROCESSING" ? "REIMBURSEMENT_TO_PAY" : "REIMBURSEMENT_TO_DECIDE";
          // Ni la personne qui vient de décider, ni le demandeur lui-même n'ont besoin d'être prévenus d'une étape qui les attend.
          for (const userId of step.users) if (userId !== event.requesterUserId && !actors.has(userId)) rows.push({ kind, recipientUserId: userId });
        }
      }
    }
    if (rows.length > 0) await tx.notificationOutbox.createMany({ data: rows.map((row) => ({ ...row, subjectId: event.subjectId })) });
  }

  /**
   * Envoie les notifications dues. Chaque envoi est réservé (verrou sans attente) avant d'être tenté : deux traitements en
   * parallèle ne l'envoient pas deux fois. Un échec est retenté après un délai croissant, puis abandonné.
   */
  async dispatchDue(now: Date = new Date()): Promise<{ sent: number; failed: number; retried: number }> {
    const result = { sent: 0, failed: 0, retried: 0 };
    if (!this.mail.enabled || !this.env.smtp) return result;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const ids = (
        await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "NotificationOutbox"
          WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
          ORDER BY "createdAt", "id" LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED`
      ).map((row) => row.id);
      if (ids.length === 0) return [];
      await tx.notificationOutbox.updateMany({ where: { id: { in: ids } }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) } });
      return tx.notificationOutbox.findMany({ where: { id: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    });

    for (const row of claimed) {
      try {
        await this.send(row);
        await this.prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), lastError: null } });
        result.sent++;
      } catch (error) {
        const code = error instanceof Error ? ((error as { code?: string }).code ?? error.name) : "ERREUR";
        if (row.attempts >= MAX_ATTEMPTS || error instanceof GoneError) {
          await this.prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: "FAILED", lastError: String(code).slice(0, 100) } });
          result.failed++;
        } else {
          await this.prisma.notificationOutbox.update({
            where: { id: row.id },
            data: { nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[row.attempts - 1]!), lastError: String(code).slice(0, 100) },
          });
          result.retried++;
        }
      }
    }
    return result;
  }

  private async send(row: { kind: NotificationKind; recipientUserId: string; subjectId: string }): Promise<void> {
    const smtp = this.env.smtp!;
    const [recipient, request] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: row.recipientUserId }, select: { email: true, displayName: true, status: true } }),
      this.prisma.reimbursementRequest.findUnique({ where: { id: row.subjectId }, select: { number: true, member: { select: { firstName: true, lastName: true } } } }),
    ]);
    // Un compte désactivé ou une demande disparue : rien à envoyer, inutile de réessayer.
    if (!recipient || recipient.status !== "ACTIVE" || !request) throw new GoneError();
    const [identity, branding, logoState] = await Promise.all([this.settings.current("identity"), this.settings.current("branding"), this.logos.state()]);
    const associationName = String(identity.name);
    const toDo = row.kind === "REIMBURSEMENT_TO_DECIDE" || row.kind === "REIMBURSEMENT_TO_PAY";
    const email = renderNotificationEmail({
      template: TEMPLATES[row.kind],
      associationName,
      recipientName: recipient.displayName,
      requesterName: `${request.member.firstName} ${request.member.lastName}`,
      requestNumber: request.number,
      link: `${smtp.publicUrl}/remboursements${toDo ? "?onglet=a-traiter" : ""}`,
      accentColor: String(branding.accentColor),
      logo: await this.rasterLogo(),
      showName: logoState.showName,
    });
    const replyTo = typeof identity.email === "string" && identity.email !== "" ? identity.email : undefined;
    await this.mail.send({ from: { address: smtp.from, name: associationName }, to: recipient.email, ...(replyTo && { replyTo }), email });
  }

  private async rasterLogo(): Promise<MailLogo | null> {
    const logo = await this.logos.current();
    if (!logo || (logo.mimeType !== "image/png" && logo.mimeType !== "image/jpeg")) return null;
    return { mimeType: logo.mimeType, data: logo.data };
  }
}

/** La personne ou la demande n'existe plus ou n'est plus active : on abandonne sans réessayer. */
class GoneError extends Error {
  constructor() {
    super("GONE");
    this.name = "GONE";
  }
}
