import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { draftDataFor, rethrowLink } from "../treasury/transaction-links.service.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");

const bookInput = z
  .object({
    categoryId: z.uuid("Catégorie invalide."),
    projectId: z.uuid().nullish(),
    /** Comptabiliser tout de suite (par défaut). Faux = l'écriture reste un brouillon à relire. */
    post: z.boolean().default(true),
  })
  .strict();

const operationInput = z
  .object({
    financialAccountId: z.uuid("Compte invalide."),
    direction: z.enum(["IN", "OUT"]),
    amount: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (chiffres positifs, 2 décimales au plus).")
      .refine((value) => Number(value) > 0, "Le montant doit être supérieur à zéro."),
    date: isoDate,
    label: z.string().trim().min(1, "Libellé obligatoire.").max(200, "Libellé trop long (200 caractères)."),
    categoryId: z.uuid("Catégorie invalide."),
    projectId: z.uuid().nullish(),
    reference: z.string().trim().max(100).nullish(),
    /** Comptabiliser tout de suite (par défaut). Faux = l'écriture reste un brouillon à relire. */
    post: z.boolean().default(true),
  })
  .strict();

export interface OperationResult {
  transactionId: string;
  entryId: string;
  posted: boolean;
  journalCode: string;
  number: number | null;
}

/**
 * Saisie guidée « J'ai reçu / J'ai dépensé de l'argent » (ADR 0028). Une seule action crée la transaction, l'écriture à
 * partie double (banque + catégorie) et, si demandé et permis, la comptabilise : **tout ou rien**, dans une transaction SQL.
 * Elle ne fait que composer les mécanismes existants (ADR 0014, 0017) ; aucune règle comptable n'est ajoutée ici.
 */
@Injectable()
export class OperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async record(body: unknown, actorId: string, canPost: boolean): Promise<OperationResult> {
    const input = parse(operationInput, body);
    // Le droit de comptabiliser est distinct : sans lui, on prépare un brouillon au lieu de refuser l'opération.
    const post = input.post && canPost;

    const account = await this.prisma.financialAccount.findUnique({ where: { id: input.financialAccountId }, include: { account: true } });
    if (!account) throw new AccountingNotFoundError("Compte");
    if (account.archivedOn) throw new AccountingConflictError("Ce compte est archivé : on n'y enregistre plus d'opération.");
    const category = await this.prisma.operationCategory.findUnique({ where: { id: input.categoryId }, include: { account: true } });
    if (!category || !category.active) throw new AccountingNotFoundError("Catégorie");
    if (category.direction !== input.direction) {
      throw new AccountingConflictError("Cette catégorie ne correspond pas au sens de l'opération (argent reçu ou dépensé).");
    }
    const date = new Date(`${input.date}T00:00:00Z`);
    const year = await this.prisma.fiscalYear.findFirst({ where: { start: { lte: date }, end: { gte: date } }, select: { id: true, status: true } });
    if (!year) {
      throw new AccountingConflictError("Aucun exercice ne couvre cette date. Vérifiez la date, ou créez l'exercice dans Paramètres › Comptabilité.");
    }
    if (year.status !== "OPEN") throw new AccountingConflictError("L'exercice de cette date est fermé à la saisie : on n'y enregistre plus d'opération.");

    // Une dépense ou une recette appartient à un projet ; sans choix, c'est le projet permanent « Fonctionnement ».
    let projectId = input.projectId ?? null;
    if (!projectId && /^[67]/.test(category.account.number)) {
      projectId = (await this.prisma.project.findFirst({ where: { permanent: true }, select: { id: true } }))?.id ?? null;
    }

    const signed = input.direction === "IN" ? input.amount : `-${input.amount}`;
    let journalCode = "";
    let number: number | null = null;
    const created = await this.prisma
      .$transaction(async (db) => {
        const transaction = await db.transaction.create({
          data: {
            financialAccountId: account.id,
            operationDate: date,
            amount: signed,
            label: input.label,
            reference: input.reference ?? null,
            projectId,
            counterpartAccountId: category.accountId,
            createdBy: actorId,
          },
          include: { counterpartAccount: { select: { number: true } } },
        });
        const entry = await db.journalEntry.create({
          data: draftDataFor(
            {
              id: transaction.id,
              label: transaction.label,
              reference: transaction.reference,
              amount: transaction.amount,
              operationDate: transaction.operationDate,
              projectId,
              counterpartAccountId: category.accountId,
              counterpartAccount: category.account,
              financialAccount: { accountId: account.accountId, journalId: account.journalId },
            },
            year.id,
            actorId,
          ),
          select: { id: true },
        });
        await db.treasuryMatch.create({ data: { transactionId: transaction.id, entryId: entry.id, financialAccountId: account.id, createdBy: actorId } });
        if (post) {
          const posted = await db.journalEntry.update({
            where: { id: entry.id },
            data: { status: "POSTED", postedBy: actorId },
            select: { number: true, journal: { select: { code: true } } },
          });
          number = posted.number;
          journalCode = posted.journal.code;
        }
        return { transactionId: transaction.id, entryId: entry.id };
      })
      .catch((error) => {
        const refusal = triggerMessage(error);
        if (refusal && !/P2002|Unique constraint/.test(String((error as Error)?.message))) throw new AccountingConflictError(refusal);
        return rethrowLink(error);
      });

    if (!journalCode) {
      journalCode = (await this.prisma.journal.findUniqueOrThrow({ where: { id: account.journalId }, select: { code: true } })).code;
    }
    await this.audit.record({
      action: "operation.recorded",
      objectType: "Transaction",
      objectId: created.transactionId,
      actorId,
      details: { direction: input.direction, entryId: created.entryId, posted: post },
    });
    return { ...created, posted: post, journalCode, number };
  }

  /**
   * « Classer et enregistrer » un mouvement qui existe déjà (importé du relevé ou saisi) : applique la catégorie (et le
   * projet), prépare l'écriture, la relie et, si permis, la comptabilise — tout ou rien. Les mouvements déjà liés à une
   * écriture, ou membres d'un virement, sont refusés avec leur raison.
   */
  async book(transactionId: string, body: unknown, actorId: string, canPost: boolean): Promise<OperationResult> {
    const input = parse(bookInput, body);
    const post = input.post && canPost;
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { financialAccount: true, matches: { where: { status: "ACTIVE" } }, transferOut: true, transferIn: true },
    });
    if (!tx) throw new AccountingNotFoundError("Mouvement");
    if (tx.matches.length > 0) throw new AccountingConflictError("Ce mouvement est déjà enregistré dans les comptes (ou en brouillon).");
    if (tx.transferOut || tx.transferIn) throw new AccountingConflictError("Ce mouvement fait partie d'un virement entre vos comptes : il s'enregistre avec le virement.");
    if (tx.financialAccount.archivedOn) throw new AccountingConflictError("Ce compte est archivé.");
    const category = await this.prisma.operationCategory.findUnique({ where: { id: input.categoryId }, include: { account: true } });
    if (!category || !category.active) throw new AccountingNotFoundError("Catégorie");
    const incoming = tx.amount.gt(0);
    if (category.direction !== (incoming ? "IN" : "OUT")) {
      throw new AccountingConflictError(
        incoming ? "Ce mouvement est de l'argent reçu : choisissez une catégorie d'argent reçu." : "Ce mouvement est de l'argent dépensé : choisissez une catégorie d'argent dépensé.",
      );
    }
    const year = await this.prisma.fiscalYear.findFirst({ where: { start: { lte: tx.operationDate }, end: { gte: tx.operationDate } }, select: { id: true, status: true } });
    if (!year) throw new AccountingConflictError("Aucun exercice ne couvre la date de ce mouvement. Créez l'exercice dans Paramètres › Comptabilité.");
    if (year.status !== "OPEN") throw new AccountingConflictError("L'exercice de ce mouvement est fermé à la saisie.");
    let projectId = input.projectId ?? tx.projectId ?? null;
    if (!projectId && /^[67]/.test(category.account.number)) {
      projectId = (await this.prisma.project.findFirst({ where: { permanent: true }, select: { id: true } }))?.id ?? null;
    }

    let number: number | null = null;
    let journalCode = "";
    const entryId = await this.prisma
      .$transaction(async (db) => {
        await db.transaction.update({ where: { id: tx.id }, data: { counterpartAccountId: category.accountId, projectId } });
        const entry = await db.journalEntry.create({
          data: draftDataFor(
            {
              id: tx.id,
              label: tx.label,
              reference: tx.reference,
              amount: tx.amount,
              operationDate: tx.operationDate,
              projectId,
              counterpartAccountId: category.accountId,
              counterpartAccount: category.account,
              financialAccount: { accountId: tx.financialAccount.accountId, journalId: tx.financialAccount.journalId },
            },
            year.id,
            actorId,
          ),
          select: { id: true },
        });
        await db.treasuryMatch.create({ data: { transactionId: tx.id, entryId: entry.id, financialAccountId: tx.financialAccountId, createdBy: actorId } });
        if (post) {
          const posted = await db.journalEntry.update({
            where: { id: entry.id },
            data: { status: "POSTED", postedBy: actorId },
            select: { number: true, journal: { select: { code: true } } },
          });
          number = posted.number;
          journalCode = posted.journal.code;
        }
        return entry.id;
      })
      .catch((error) => {
        const refusal = triggerMessage(error);
        if (refusal && !/P2002|Unique constraint/.test(String((error as Error)?.message))) throw new AccountingConflictError(refusal);
        return rethrowLink(error);
      });
    if (!journalCode) journalCode = (await this.prisma.journal.findUniqueOrThrow({ where: { id: tx.financialAccount.journalId }, select: { code: true } })).code;
    await this.audit.record({ action: "operation.booked", objectType: "Transaction", objectId: tx.id, actorId, details: { entryId, posted: post } });
    return { transactionId: tx.id, entryId, posted: post, journalCode, number };
  }
}
