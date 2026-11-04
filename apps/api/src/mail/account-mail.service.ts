import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { VALIDITY_HOURS, type IssuedPasswordToken } from "../auth/password-token.service.js";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BrandLogoService } from "../settings/brand-logo.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { MailService } from "./mail.service.js";
import { renderInvitationEmail, renderResetEmail, renderTestEmail, type EmailContext, type MailLogo } from "./templates.js";

/** Ce que l'administrateur doit savoir de l'envoi : réussi, échoué (il transmet alors le lien lui-même) ou non configuré. */
export type MailOutcome =
  | { status: "SENT"; to: string }
  | { status: "FAILED"; to: string }
  | { status: "NOT_CONFIGURED" };

/** Résultat d'un essai d'envoi : l'administrateur voit s'il a réussi et, sinon, ce que répond le serveur de messagerie. */
export type TestMailOutcome =
  | { status: "SENT"; to: string }
  | { status: "FAILED"; to: string; detail: string }
  | { status: "NOT_CONFIGURED" };

/**
 * Envoie par email le lien d'invitation ou de réinitialisation d'un compte. Ne lève jamais d'erreur : un email qui échoue ne doit
 * pas défaire la création du compte ni l'émission du lien, que l'administrateur peut toujours transmettre lui-même.
 */
@Injectable()
export class AccountMailService {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(BrandLogoService) private readonly logos: BrandLogoService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async sendLink(userId: string, link: IssuedPasswordToken, actorId: string): Promise<MailOutcome> {
    const smtp = this.env.smtp;
    if (!smtp || !this.mail.enabled) return { status: "NOT_CONFIGURED" };

    const recipient = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });
    if (!recipient) return { status: "NOT_CONFIGURED" };
    const kind = link.purpose === "INVITATION" ? "invitation" : "reset";

    try {
      const [identity, branding, logoState, actor] = await Promise.all([
        this.settings.current("identity"),
        this.settings.current("branding"),
        this.logos.state(),
        this.prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true } }),
      ]);
      const associationName = String(identity.name);
      const context: EmailContext = {
        associationName,
        recipientName: recipient.displayName,
        recipientEmail: recipient.email,
        actorName: actor?.displayName ?? null,
        link: `${smtp.publicUrl}${link.path}`,
        expiresAt: link.expiresAt,
        validityHours: VALIDITY_HOURS[link.purpose],
        accentColor: String(branding.accentColor),
        logo: await this.rasterLogo(),
        showName: logoState.showName,
      };
      const email = link.purpose === "INVITATION" ? renderInvitationEmail(context) : renderResetEmail(context);
      const replyTo = typeof identity.email === "string" && identity.email !== "" ? identity.email : undefined;
      await this.mail.send({ from: { address: smtp.from, name: associationName }, to: recipient.email, ...(replyTo && { replyTo }), email });
    } catch {
      // Le détail technique est déjà journalisé par MailService ; l'audit garde seulement le fait, sans le lien.
      await this.audit.record({ action: "user.mail.failed", objectType: "User", objectId: userId, actorId, details: { kind } });
      return { status: "FAILED", to: recipient.email };
    }
    await this.audit.record({ action: "user.mail.sent", objectType: "User", objectId: userId, actorId, details: { kind } });
    return { status: "SENT", to: recipient.email };
  }

  /**
   * Essai d'envoi, toujours adressé à la personne qui le demande (jamais à une adresse saisie : l'écran ne peut pas servir de relais).
   * Ne lève jamais d'erreur ; `detail` reprend le code et le message du serveur de messagerie, sans aucun secret.
   */
  async sendTest(actorId: string): Promise<TestMailOutcome> {
    const smtp = this.env.smtp;
    if (!smtp || !this.mail.enabled) return { status: "NOT_CONFIGURED" };
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { email: true, displayName: true } });
    if (!actor) return { status: "NOT_CONFIGURED" };

    try {
      const [identity, branding, logoState] = await Promise.all([this.settings.current("identity"), this.settings.current("branding"), this.logos.state()]);
      const associationName = String(identity.name);
      const email = renderTestEmail({
        associationName,
        recipientName: actor.displayName,
        link: smtp.publicUrl,
        accentColor: String(branding.accentColor),
        logo: await this.rasterLogo(),
        showName: logoState.showName,
      });
      await this.mail.send({ from: { address: smtp.from, name: associationName }, to: actor.email, email });
    } catch (error) {
      await this.audit.record({ action: "mail.test.failed", objectType: "Mail", actorId, details: {} });
      const code = error instanceof Error ? ((error as { code?: string }).code ?? error.name) : "erreur inconnue";
      const message = error instanceof Error ? error.message : "";
      return { status: "FAILED", to: actor.email, detail: `${code}${message ? ` : ${message}` : ""}`.replace(/\s+/g, " ").slice(0, 300) };
    }
    await this.audit.record({ action: "mail.test.sent", objectType: "Mail", actorId, details: {} });
    return { status: "SENT", to: actor.email };
  }

  /** Le logo n'est intégré que s'il s'affiche partout : PNG ou JPEG (un SVG est remplacé par le nom de l'association). */
  private async rasterLogo(): Promise<MailLogo | null> {
    const logo = await this.logos.current();
    if (!logo || (logo.mimeType !== "image/png" && logo.mimeType !== "image/jpeg")) return null;
    return { mimeType: logo.mimeType, data: logo.data };
  }
}
