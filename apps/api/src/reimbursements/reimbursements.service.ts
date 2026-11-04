import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { DocumentsService, type DocumentDetail, type DocumentSummary, type IncomingFile, type Viewer } from "../documents/documents.service.js";
import type { Prisma, ReimbursementStatus } from "../generated/prisma/client.js";
import { OperationsService } from "../guided/operations.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { WorkflowEngineService, type InstanceView } from "../workflows/workflow-engine.service.js";
import { WorkflowsService } from "../workflows/workflows.service.js";

export const REIMBURSEMENT_SUBJECT = "reimbursement";
export const LINK_TYPE = "reimbursement-request";
const RECEIPT_CATEGORY = "facture";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");
const amountString = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (chiffres positifs, 2 décimales au plus).")
  .refine((value) => Number(value) > 0, "Le montant doit être supérieur à zéro.");
const reason = z.string().trim().min(3, "Dites en quelques mots à quoi correspond cette dépense (3 caractères au moins).").max(500, "Motif trop long (500 caractères).");

const createInput = z.object({ amount: amountString, expenseDate: isoDate, reason, projectId: z.uuid().nullish() }).strict();
const updateInput = z
  .object({ version: z.number().int().min(1), amount: amountString.optional(), expenseDate: isoDate.optional(), reason: reason.optional(), projectId: z.uuid().nullable().optional() })
  .strict();
const decisionInput = z.object({ type: z.enum(["APPROVE", "REFUSE", "RETURN"]), message: z.string().trim().max(500).nullish() }).strict();
const cancelInput = z.object({ message: z.string().trim().max(500).nullish() }).strict();
const processInput = z
  .object({
    mode: z.enum(["CREATE", "EXISTING"]),
    /** Catégorie « argent dépensé » qui reçoit la dépense. */
    categoryId: z.uuid("Catégorie invalide.").optional(),
    financialAccountId: z.uuid().optional(),
    date: isoDate.optional(),
    transactionId: z.uuid().optional(),
    /** Comptabiliser tout de suite (par défaut), si la personne en a le droit. */
    post: z.boolean().default(true),
  })
  .strict();

export type Snapshot = { amount: string; expenseDate: string; projectId: string | null };

export interface ReimbursementView {
  id: string;
  number: number;
  status: ReimbursementStatus;
  amount: string;
  expenseDate: string;
  reason: string;
  projectId: string | null;
  projectName: string | null;
  requesterUserId: string;
  requesterName: string;
  version: number;
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  documentCount: number;
  /** Étape qui attend une décision, en mots courants (« Accord du président »). */
  awaitingLabel: string | null;
  /** Dernier message du circuit : motif du refus, ou de ce qu'il faut corriger. */
  lastMessage: string | null;
  paid: { transactionId: string; entryId: string } | null;
  instance: InstanceView | null;
  /** Ce que la personne qui regarde peut faire sur cette demande. */
  can: { edit: boolean; submit: boolean; cancel: boolean; delete: boolean; decide: boolean; process: boolean; stepType: "APPROVAL" | "PROCESSING" | null };
}

export interface ListedReimbursement {
  id: string;
  number: number;
  status: ReimbursementStatus;
  amount: string;
  expenseDate: string;
  reason: string;
  requesterName: string;
  awaitingLabel: string | null;
  submittedAt: string | null;
}

export interface Actor {
  userId: string;
  canViewAll: boolean;
  canPost: boolean;
}

/** Texte lisible de l'étape en cours. */
const awaiting = (instance: InstanceView | null): string | null => instance?.steps.find((s) => s.state === "CURRENT")?.label ?? null;

const day = (date: Date) => date.toISOString().slice(0, 10);
const money = (value: Prisma.Decimal) => value.toFixed(2);

/**
 * Demandes de remboursement d'une avance personnelle (ADR 0035). Une demande appartient à son demandeur tant qu'elle
 * est en brouillon ou à corriger ; une fois déposée elle suit le circuit de validation en vigueur (moteur générique) et
 * finit remboursée par le traitement, qui enregistre la sortie d'argent dans les comptes — tout ou rien.
 */
@Injectable()
export class ReimbursementsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WorkflowEngineService) private readonly engine: WorkflowEngineService,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}

  /**
   * Les demandes de remboursement sont ouvertes quand un circuit est en vigueur (sinon : traitement direct, CA-08) **et utilisable** :
   * chaque étape a au moins une personne qui peut décider (`ready`). Sinon une demande resterait bloquée, et le menu masque la rubrique.
   */
  async status(userId: string): Promise<{ enabled: boolean; ready: boolean; canRequest: boolean; reason: string | null }> {
    const enabled = await this.engine.isEnabled(REIMBURSEMENT_SUBJECT);
    const blocked = enabled ? await this.workflows.activeWarnings(REIMBURSEMENT_SUBJECT) : [];
    const ready = enabled && blocked.length === 0;
    const member = await this.memberOf(userId);
    return {
      enabled,
      ready,
      canRequest: ready && !!member,
      reason: !enabled
        ? "Les demandes de remboursement ne sont pas encore ouvertes : un administrateur doit d’abord mettre un circuit de validation en vigueur."
        : !ready
          ? `Le circuit de validation en vigueur ne peut pas fonctionner pour l’instant : ${blocked[0]!.message} Un administrateur doit le corriger (Paramètres › Circuits de validation) avant que les demandes soient ouvertes.`
          : !member
            ? "Votre compte n’est pas relié à une fiche de membre actif. Le lien se fait tout seul quand la fiche et le compte ont la même adresse email ; sinon, demandez à un administrateur de l’associer (Membres › votre fiche › Associer à un compte utilisateur)."
            : null,
    };
  }

  async projects(): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.project.findMany({ where: { status: { in: ["PREPARATION", "ACTIVE"] } }, select: { id: true, name: true, permanent: true }, orderBy: [{ permanent: "desc" }, { name: "asc" }] });
    return rows.map(({ id, name }) => ({ id, name }));
  }

  // --- listes ---

  async mine(userId: string): Promise<ListedReimbursement[]> {
    const rows = await this.prisma.reimbursementRequest.findMany({ where: { requesterUserId: userId }, include: { member: true }, orderBy: [{ number: "desc" }] });
    return this.listed(rows);
  }

  async all(filter: { status?: string } = {}): Promise<ListedReimbursement[]> {
    const rows = await this.prisma.reimbursementRequest.findMany({
      where: { status: { not: "DRAFT" }, ...(filter.status && { status: filter.status as ReimbursementStatus }) },
      include: { member: true },
      orderBy: [{ number: "desc" }],
      take: 500,
    });
    return this.listed(rows);
  }

  /** Demandes que cette personne peut décider maintenant (accord, ou remboursement). */
  async toDecide(userId: string): Promise<(ListedReimbursement & { stepType: "APPROVAL" | "PROCESSING" })[]> {
    const pending = await this.engine.awaiting(userId, REIMBURSEMENT_SUBJECT);
    if (pending.length === 0) return [];
    const rows = await this.prisma.reimbursementRequest.findMany({ where: { id: { in: pending.map((p) => p.subjectId) } }, include: { member: true }, orderBy: [{ number: "asc" }] });
    const steps = new Map(pending.map((p) => [p.subjectId, p]));
    return (await this.listed(rows, steps)).map((item) => ({ ...item, stepType: steps.get(item.id)!.stepType }));
  }

  // --- fiche ---

  async get(id: string, actor: Actor): Promise<ReimbursementView> {
    const request = await this.load(id);
    const instance = await this.instanceOf(id);
    const step = instance ? await this.engine.decisionFor(instance.id, actor.userId) : null;
    await this.assertVisible(request, instance?.id ?? null, actor, step !== null);
    return this.view(request, instance, actor, step);
  }

  // --- dépôt ---

  async create(body: unknown, actor: Actor): Promise<ReimbursementView> {
    const input = parse(createInput, body);
    await this.assertOpen(actor.userId);
    const member = (await this.memberOf(actor.userId))!;
    await this.assertProject(input.projectId ?? null);
    const created = await this.prisma.reimbursementRequest.create({
      data: { requesterUserId: actor.userId, memberId: member.id, amount: input.amount, expenseDate: new Date(`${input.expenseDate}T00:00:00Z`), reason: input.reason, projectId: input.projectId ?? null },
    });
    await this.audit.record({ action: "reimbursement.created", objectType: "ReimbursementRequest", objectId: created.id, actorId: actor.userId });
    return this.get(created.id, actor);
  }

  async update(id: string, body: unknown, actor: Actor): Promise<ReimbursementView> {
    const { version, ...fields } = parse(updateInput, body);
    const request = await this.ownRequest(id, actor.userId);
    if (request.status !== "DRAFT" && request.status !== "RETURNED") {
      throw new AccountingConflictError("Cette demande est déjà déposée : elle ne se modifie plus. Si une correction est nécessaire, la personne qui l’examine peut vous la renvoyer.");
    }
    if (fields.projectId !== undefined) await this.assertProject(fields.projectId);
    const changed = await this.prisma.reimbursementRequest
      .updateMany({
        where: { id, version },
        data: {
          ...(fields.amount !== undefined && { amount: fields.amount }),
          ...(fields.expenseDate !== undefined && { expenseDate: new Date(`${fields.expenseDate}T00:00:00Z`) }),
          ...(fields.reason !== undefined && { reason: fields.reason }),
          ...(fields.projectId !== undefined && { projectId: fields.projectId }),
          version: { increment: 1 },
        },
      })
      .catch((error: unknown) => this.rethrow(error));
    if (changed.count !== 1) throw new AccountingConflictError("Cette demande a été modifiée entre-temps. Rechargez-la avant de l’enregistrer.");
    await this.audit.record({ action: "reimbursement.updated", objectType: "ReimbursementRequest", objectId: id, actorId: actor.userId, details: { fields: Object.keys(fields) } });
    return this.get(id, actor);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const request = await this.ownRequest(id, actor.userId);
    if (request.status !== "DRAFT") throw new AccountingConflictError("Seul un brouillon se supprime. Une demande déposée s’annule, avec un motif.");
    // Les justificatifs d'un brouillon abandonné sont archivés (un document ne se supprime jamais).
    const links = await this.prisma.documentLink.findMany({ where: { objectType: LINK_TYPE, objectId: id, document: { archivedAt: null } }, select: { documentId: true } });
    for (const link of links) await this.documents.setArchived(link.documentId, true, this.internalViewer(actor.userId));
    await this.prisma.reimbursementRequest.delete({ where: { id } }).catch((error: unknown) => this.rethrow(error));
    await this.audit.record({ action: "reimbursement.deleted", objectType: "ReimbursementRequest", objectId: id, actorId: actor.userId });
  }

  /** Dépose la demande dans le circuit (ou la renvoie après correction). Le justificatif est obligatoire. */
  async submit(id: string, actor: Actor): Promise<ReimbursementView> {
    const request = await this.ownRequest(id, actor.userId);
    if (request.status !== "DRAFT" && request.status !== "RETURNED") throw new AccountingConflictError("Cette demande est déjà déposée.");
    await this.assertOpen(actor.userId);
    const receipts = await this.prisma.documentLink.count({ where: { objectType: LINK_TYPE, objectId: id, document: { archivedAt: null } } });
    if (receipts === 0) {
      throw new AccountingConflictError("Il manque le justificatif. Ajoutez la facture, le ticket ou le reçu (photo ou PDF), puis déposez de nouveau votre demande.");
    }
    const snapshot: Snapshot = { amount: money(request.amount), expenseDate: day(request.expenseDate), projectId: request.projectId };

    await this.prisma
      .$transaction(async (tx) => {
        if (request.status === "DRAFT") {
          await tx.reimbursementRequest.update({ where: { id }, data: { submittedSnapshot: snapshot, submittedAt: new Date() } });
          await this.engine.start({ subjectType: REIMBURSEMENT_SUBJECT, subjectId: id, requesterUserId: actor.userId }, tx);
        } else {
          const previous = request.submittedSnapshot as Snapshot | null;
          const restartFromFirst = !previous || previous.amount !== snapshot.amount || previous.expenseDate !== snapshot.expenseDate || previous.projectId !== snapshot.projectId;
          const instance = await tx.workflowInstance.findFirstOrThrow({ where: { subjectType: REIMBURSEMENT_SUBJECT, subjectId: id }, select: { id: true } });
          await tx.reimbursementRequest.update({ where: { id }, data: { submittedSnapshot: snapshot } });
          await this.engine.resume(instance.id, actor.userId, { restartFromFirst }, tx);
        }
      })
      .catch((error: unknown) => this.rethrow(error));
    await this.audit.record({ action: "reimbursement.submitted", objectType: "ReimbursementRequest", objectId: id, actorId: actor.userId, details: { resubmitted: request.status === "RETURNED" } });
    return this.get(id, actor);
  }

  async cancel(id: string, body: unknown, actor: Actor): Promise<ReimbursementView> {
    const { message } = parse(cancelInput, body ?? {});
    const request = await this.ownRequest(id, actor.userId);
    if (request.status !== "IN_CIRCUIT" && request.status !== "RETURNED") {
      throw new AccountingConflictError(request.status === "DRAFT" ? "Cette demande n’est pas encore déposée : supprimez le brouillon." : "Cette demande est terminée : elle ne s’annule plus.");
    }
    const instance = await this.instanceOf(id);
    if (!instance) throw new AccountingNotFoundError("Circuit de la demande");
    await this.engine.decide(instance.id, { type: "CANCEL", actorId: actor.userId, message: message ?? null });
    await this.audit.record({ action: "reimbursement.cancelled", objectType: "ReimbursementRequest", objectId: id, actorId: actor.userId });
    return this.get(id, actor);
  }

  // --- justificatifs ---

  /** Dépose un justificatif, relié à la demande. Document confidentiel : il n'apparaît que pour ceux qui ont ce droit. */
  async addReceipt(id: string, file: IncomingFile, title: string | undefined, actor: Actor): Promise<DocumentDetail> {
    const request = await this.ownRequest(id, actor.userId);
    if (request.status !== "DRAFT" && request.status !== "RETURNED") {
      throw new AccountingConflictError("Cette demande est déjà déposée : on n’y ajoute un justificatif que si elle vous est renvoyée pour correction.");
    }
    const { document } = await this.documents.create(
      { title: title?.trim() || `Justificatif de la demande n° ${request.number}`, category: RECEIPT_CATEGORY, restricted: true, links: [{ objectType: LINK_TYPE, objectId: id }] },
      file,
      this.internalViewer(actor.userId),
    );
    return document;
  }

  async receipts(id: string, actor: Actor): Promise<DocumentSummary[]> {
    await this.get(id, actor);
    const { items } = await this.documents.list({ objectType: LINK_TYPE, objectId: id }, this.internalViewer(actor.userId));
    return items;
  }

  async downloadReceipt(id: string, documentId: string, actor: Actor) {
    await this.get(id, actor);
    await this.assertLinked(id, documentId);
    return this.documents.download(documentId, undefined, this.internalViewer(actor.userId));
  }

  async archiveReceipt(id: string, documentId: string, actor: Actor): Promise<void> {
    const request = await this.ownRequest(id, actor.userId);
    if (request.status !== "DRAFT" && request.status !== "RETURNED") throw new AccountingConflictError("Cette demande est déjà déposée : ses justificatifs ne se retirent plus.");
    await this.assertLinked(id, documentId);
    await this.documents.setArchived(documentId, true, this.internalViewer(actor.userId));
  }

  // --- décisions ---

  async decide(id: string, body: unknown, actor: Actor): Promise<ReimbursementView> {
    const input = parse(decisionInput, body);
    const request = await this.load(id);
    const instance = await this.instanceOf(id);
    if (!instance) throw new AccountingConflictError("Cette demande n’est pas encore déposée.");
    // Une demande qu'on ne peut pas voir est introuvable : on ne révèle pas son existence.
    const step = await this.engine.decisionFor(instance.id, actor.userId);
    await this.assertVisible(request, instance.id, actor, step !== null);
    await this.engine.decide(instance.id, { type: input.type, actorId: actor.userId, message: input.message ?? null });
    await this.audit.record({
      action: input.type === "APPROVE" ? "reimbursement.approved" : input.type === "REFUSE" ? "reimbursement.refused" : "reimbursement.returned",
      objectType: "ReimbursementRequest",
      objectId: id,
      actorId: actor.userId,
    });
    return this.get(id, actor);
  }

  /**
   * Étape de traitement : rembourse. Valide la décision, enregistre la sortie d'argent dans les comptes (nouvelle opération
   * ou mouvement bancaire existant du même montant) et solde la demande — **une seule transaction SQL**, tout ou rien.
   */
  async process(id: string, body: unknown, actor: Actor): Promise<ReimbursementView> {
    const input = parse(processInput, body);
    const request = await this.load(id);
    const instance = await this.instanceOf(id);
    if (!instance || request.status !== "IN_CIRCUIT") throw new AccountingConflictError("Cette demande n’attend pas de remboursement.");
    const step = await this.engine.decisionFor(instance.id, actor.userId);
    await this.assertVisible(request, instance.id, actor, step !== null);
    if (step?.stepType !== "PROCESSING") throw new AccountingConflictError("Cette demande n’est pas à l’étape du remboursement, ou ce n’est pas à vous de la traiter.");

    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: request.memberId }, select: { firstName: true, lastName: true } });
    await this.prisma
      .$transaction(async (tx) => {
        await this.engine.decide(instance.id, { type: "PROCESS", actorId: actor.userId }, tx);
        const { transactionId, entryId } = await this.book(tx, request, member, input, actor);
        await tx.reimbursementPayment.create({ data: { requestId: id, transactionId, entryId, createdBy: actor.userId } });
        await this.audit.record({ action: "reimbursement.paid", objectType: "ReimbursementRequest", objectId: id, actorId: actor.userId, details: { transactionId, entryId } }, tx);
      })
      .catch((error: unknown) => this.rethrow(error));
    return this.get(id, actor);
  }

  /** Mouvements bancaires de sortie du même montant, pas déjà rattachés à une demande : candidats à l'étape de traitement. */
  async candidates(id: string): Promise<{ id: string; label: string; date: string; accountName: string; booked: boolean }[]> {
    const request = await this.load(id);
    const rows = await this.prisma.transaction.findMany({
      where: { amount: request.amount.negated(), reimbursementPayment: null, transferOut: null, transferIn: null },
      include: { financialAccount: { select: { name: true } }, matches: { where: { status: "ACTIVE" }, select: { id: true } } },
      orderBy: [{ operationDate: "desc" }, { id: "asc" }],
      take: 50,
    });
    return rows.map((t) => ({ id: t.id, label: t.label, date: day(t.operationDate), accountName: t.financialAccount.name, booked: t.matches.length > 0 }));
  }

  // --- interne ---

  private async book(
    tx: Prisma.TransactionClient,
    request: { number: number; amount: Prisma.Decimal; reason: string; projectId: string | null },
    member: { firstName: string; lastName: string },
    input: z.infer<typeof processInput>,
    actor: Actor,
  ): Promise<{ transactionId: string; entryId: string }> {
    const post = input.post;
    if (input.mode === "CREATE") {
      if (!input.financialAccountId || !input.date || !input.categoryId) {
        throw new AccountingConflictError("Pour enregistrer le remboursement, indiquez le compte bancaire qui a payé, la date et la catégorie de la dépense.");
      }
      const label = `Remboursement de frais — ${member.firstName} ${member.lastName} — ${request.reason}`.slice(0, 200);
      const done = await this.operations.record(
        { financialAccountId: input.financialAccountId, direction: "OUT", amount: money(request.amount), date: input.date, label, categoryId: input.categoryId, projectId: request.projectId, reference: `Demande n° ${request.number}`, post },
        actor.userId,
        actor.canPost,
        tx,
      );
      return { transactionId: done.transactionId, entryId: done.entryId };
    }
    if (!input.transactionId) throw new AccountingConflictError("Choisissez le mouvement bancaire qui correspond à ce remboursement.");
    const movement = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      include: { matches: { where: { status: "ACTIVE" }, select: { entryId: true } }, transferOut: true, transferIn: true, reimbursementPayment: true },
    });
    if (!movement) throw new AccountingNotFoundError("Mouvement");
    if (!movement.amount.equals(request.amount.negated())) {
      throw new AccountingConflictError(`Ce mouvement (${money(movement.amount.abs())} €) n’a pas le même montant que la demande (${money(request.amount)} €) : choisissez-en un autre, ou enregistrez le remboursement à part.`);
    }
    if (movement.reimbursementPayment) throw new AccountingConflictError("Ce mouvement rembourse déjà une autre demande.");
    if (movement.transferOut || movement.transferIn) throw new AccountingConflictError("Ce mouvement est un virement entre vos comptes : choisissez un autre mouvement.");
    const existing = movement.matches[0];
    if (existing) return { transactionId: movement.id, entryId: existing.entryId };
    if (!input.categoryId) throw new AccountingConflictError("Ce mouvement n’est pas encore enregistré dans les comptes : choisissez la catégorie de la dépense.");
    const done = await this.operations.book(movement.id, { categoryId: input.categoryId, projectId: request.projectId, post }, actor.userId, actor.canPost, tx);
    return { transactionId: movement.id, entryId: done.entryId };
  }

  private internalViewer(userId: string): Viewer {
    // Les justificatifs sont confidentiels : seul ce chemin, qui vérifie d'abord qui a le droit de voir la demande, les ouvre.
    return { userId, canSeeRestricted: true };
  }

  private async assertLinked(requestId: string, documentId: string): Promise<void> {
    const link = await this.prisma.documentLink.findFirst({ where: { objectType: LINK_TYPE, objectId: requestId, documentId }, select: { id: true } });
    if (!link) throw new AccountingNotFoundError("Justificatif");
  }

  private async memberOf(userId: string) {
    return this.prisma.member.findFirst({ where: { userId, status: "ACTIVE" }, select: { id: true } });
  }

  private async assertOpen(userId: string): Promise<void> {
    const status = await this.status(userId);
    if (!status.canRequest) throw new AccountingConflictError(status.reason!);
  }

  private async assertProject(projectId: string | null): Promise<void> {
    if (!projectId) return;
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
    if (!project || project.status === "ARCHIVED" || project.status === "FINISHED") throw new AccountingConflictError("Ce projet n’existe pas ou n’accepte plus de dépenses : choisissez-en un autre.");
  }

  private async load(id: string) {
    const request = await this.prisma.reimbursementRequest.findUnique({ where: { id } });
    if (!request) throw new AccountingNotFoundError("Demande");
    return request;
  }

  /** Une demande du demandeur ; celle d'un autre est introuvable (on ne révèle pas son existence). */
  private async ownRequest(id: string, userId: string) {
    const request = await this.load(id);
    if (request.requesterUserId !== userId) throw new AccountingNotFoundError("Demande");
    return request;
  }

  private instanceOf(requestId: string) {
    return this.prisma.workflowInstance.findFirst({ where: { subjectType: REIMBURSEMENT_SUBJECT, subjectId: requestId }, select: { id: true }, orderBy: { createdAt: "desc" } });
  }

  /** Visible par : le demandeur, qui a `reimbursements:view`, qui a déjà décidé sur la demande, ou qui doit la décider maintenant. */
  private async assertVisible(request: { requesterUserId: string; status: ReimbursementStatus }, instanceId: string | null, actor: Actor, deciding: boolean): Promise<void> {
    if (request.requesterUserId === actor.userId) return;
    if (request.status === "DRAFT") throw new AccountingNotFoundError("Demande");
    if (actor.canViewAll || deciding) return;
    if (instanceId && (await this.prisma.approvalDecision.count({ where: { instanceId, actorUserId: actor.userId } })) > 0) return;
    throw new AccountingNotFoundError("Demande");
  }

  private async listed(
    rows: { id: string; number: number; status: ReimbursementStatus; amount: Prisma.Decimal; expenseDate: Date; reason: string; submittedAt: Date | null; member: { firstName: string; lastName: string } }[],
    steps: Map<string, { label: string }> = new Map<string, { label: string }>(),
  ): Promise<ListedReimbursement[]> {
    const labels = new Map<string, string | null>();
    const needing = rows.filter((r) => r.status === "IN_CIRCUIT" && !steps.has(r.id));
    if (needing.length > 0) {
      const instances = await this.prisma.workflowInstance.findMany({
        where: { subjectType: REIMBURSEMENT_SUBJECT, subjectId: { in: needing.map((r) => r.id) } },
        include: { definitionVersion: true },
      });
      for (const instance of instances) {
        const nodes = (instance.definitionVersion.document as { nodes?: { id: string; label: string }[] }).nodes ?? [];
        labels.set(instance.subjectId, nodes.find((n) => n.id === instance.currentNodeId)?.label ?? null);
      }
    }
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      amount: money(r.amount),
      expenseDate: day(r.expenseDate),
      reason: r.reason,
      requesterName: `${r.member.firstName} ${r.member.lastName}`,
      awaitingLabel: steps.get(r.id)?.label ?? labels.get(r.id) ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null,
    }));
  }

  private async view(
    request: NonNullable<Awaited<ReturnType<ReimbursementsService["load"]>>>,
    instanceRef: { id: string } | null,
    actor: Actor,
    step: { stepType: "APPROVAL" | "PROCESSING" } | null,
  ): Promise<ReimbursementView> {
    const [member, project, documentCount, payment, instance] = await Promise.all([
      this.prisma.member.findUniqueOrThrow({ where: { id: request.memberId }, select: { firstName: true, lastName: true } }),
      request.projectId ? this.prisma.project.findUnique({ where: { id: request.projectId }, select: { name: true } }) : null,
      this.prisma.documentLink.count({ where: { objectType: LINK_TYPE, objectId: request.id, document: { archivedAt: null } } }),
      this.prisma.reimbursementPayment.findUnique({ where: { requestId: request.id } }),
      instanceRef ? this.engine.view(instanceRef.id) : null,
    ]);
    const names = instance ? await this.prisma.user.findMany({ where: { id: { in: [...new Set(instance.decisions.map((d) => d.actorUserId))] } }, select: { id: true, displayName: true } }) : [];
    const byId = new Map(names.map((u) => [u.id, u.displayName]));
    if (instance) for (const d of instance.decisions) d.actorName = byId.get(d.actorUserId) ?? "Quelqu’un";
    const mine = request.requesterUserId === actor.userId;
    const editable = mine && (request.status === "DRAFT" || request.status === "RETURNED");
    const last = instance?.decisions.filter((d) => d.message && (d.outcome === "REFUSED" || d.outcome === "RETURNED")).at(-1);
    return {
      id: request.id,
      number: request.number,
      status: request.status,
      amount: money(request.amount),
      expenseDate: day(request.expenseDate),
      reason: request.reason,
      projectId: request.projectId,
      projectName: project?.name ?? null,
      requesterUserId: request.requesterUserId,
      requesterName: `${member.firstName} ${member.lastName}`,
      version: request.version,
      createdAt: request.createdAt.toISOString(),
      submittedAt: request.submittedAt?.toISOString() ?? null,
      closedAt: request.closedAt?.toISOString() ?? null,
      documentCount,
      awaitingLabel: request.status === "IN_CIRCUIT" ? awaiting(instance) : null,
      lastMessage: request.status === "RETURNED" || request.status === "REFUSED" ? (last?.message ?? null) : null,
      paid: payment ? { transactionId: payment.transactionId, entryId: payment.entryId } : null,
      instance,
      can: {
        edit: editable,
        submit: editable,
        cancel: mine && (request.status === "IN_CIRCUIT" || request.status === "RETURNED"),
        delete: mine && request.status === "DRAFT",
        decide: step !== null,
        process: step?.stepType === "PROCESSING",
        stepType: step?.stepType ?? null,
      },
    };
  }

  private rethrow(error: unknown): never {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
    const message = triggerMessage(error);
    if (message) throw new AccountingConflictError(message);
    throw error;
  }
}
