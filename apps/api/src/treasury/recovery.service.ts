import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Money } from "@cotiasso/accounting-domain";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { EntriesService, EntryPostingRefusedError } from "../accounting/entries.service.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { RecoveryBatchStatus, RecoveryItemKind } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "./db-refusal.js";
import { draftDataFor } from "./transaction-links.service.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");

const createInput = z
  .object({
    name: z.string().trim().min(3, "Donnez un nom d'au moins 3 caractères au lot.").max(120, "Nom trop long (120 caractères)."),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();

const prepareInput = z
  .object({ financialAccountId: z.uuid(), from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, { message: "La fin de période précède son début.", path: ["to"] });

const openingInput = z
  .object({
    financialAccountId: z.uuid(),
    counterpartAccountId: z.uuid(),
    explanation: z.string().trim().min(5, "Expliquez l'origine de ce solde (5 caractères au moins).").max(120, "Explication trop longue (120 caractères)."),
  })
  .strict();

export type SkipReason = "NOT_QUALIFIED" | "ALREADY_LINKED" | "TRANSFER" | "NO_FISCAL_YEAR" | "YEAR_NOT_OPEN" | "REFUSED";

export interface PrepareReport {
  created: number;
  skipped: { transactionId: string; date: string; label: string; amount: string; reason: SkipReason; message: string }[];
  /** Nombre d'ignorées par raison (le détail ci-dessus est plafonné). */
  skippedByReason: Partial<Record<SkipReason, number>>;
}

export interface PostReport {
  posted: number;
  failed: { entryId: string; date: string; label: string; messages: string[] }[];
  remainingDrafts: number;
  /** Vrai si le lot est passé à « terminé ». */
  completed: boolean;
}

export interface BatchItemView {
  entryId: string;
  kind: RecoveryItemKind;
  financialAccountId: string;
  financialAccountName: string;
  date: string;
  label: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  journalCode: string;
  number: number | null;
  amount: string;
}

export interface BatchView {
  id: string;
  name: string;
  note: string | null;
  status: RecoveryBatchStatus;
  createdAt: string;
  closedAt: string | null;
  abandonedAt: string | null;
  drafts: number;
  posted: number;
  total: number;
}

const SKIP_LABELS: Record<SkipReason, string> = {
  NOT_QUALIFIED: "Pas de compte de contrepartie : qualifiez la transaction d'abord.",
  ALREADY_LINKED: "Déjà liée à une écriture.",
  TRANSFER: "Côté d'un virement interne : il a son propre brouillon.",
  NO_FISCAL_YEAR: "Aucun exercice ne couvre cette date.",
  YEAR_NOT_OPEN: "L'exercice de cette date n'est pas ouvert.",
  REFUSED: "Refusée par la base.",
};
const REPORT_DETAIL_LIMIT = 100;

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);

function rethrow(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
  if (/P2002|Unique constraint|23505|duplicate key/i.test(text)) {
    throw new AccountingConflictError("Ce compte financier a déjà une écriture d'ouverture dans un lot de reprise.");
  }
  const message = triggerMessage(error);
  if (message) throw new AccountingConflictError(message);
  throw error;
}

/**
 * Lots de reprise (ADR 0019) : brouillons créés en masse, comptabilisés ensemble (chacun isolé, avec compte rendu) ou
 * abandonnés sans jamais toucher à ce qui est déjà comptabilisé.
 */
@Injectable()
export class RecoveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EntriesService) private readonly entries: EntriesService,
  ) {}

  async list(): Promise<BatchView[]> {
    const rows = await this.prisma.recoveryBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: { items: { select: { entry: { select: { status: true } } } } },
    });
    return rows.map((row) => this.summary(row));
  }

  async get(id: string): Promise<{ batch: BatchView; items: BatchItemView[] }> {
    const row = await this.prisma.recoveryBatch.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: [{ entry: { date: "asc" } }, { createdAt: "asc" }],
          include: {
            financialAccount: { select: { name: true } },
            entry: { include: { journal: { select: { code: true } }, lines: { select: { debit: true } } } },
          },
        },
      },
    });
    if (!row) throw new AccountingNotFoundError("Lot de reprise");
    return {
      batch: this.summary(row),
      items: row.items.map((item) => ({
        entryId: item.entryId,
        kind: item.kind,
        financialAccountId: item.financialAccountId,
        financialAccountName: item.financialAccount.name,
        date: day(item.entry.date),
        label: item.entry.label,
        status: item.entry.status,
        journalCode: item.entry.journal.code,
        number: item.entry.number,
        amount: item.entry.lines.reduce((sum, l) => sum.add(Money.parse(l.debit.toFixed(2))), Money.zero()).toString(),
      })),
    };
  }

  async create(body: unknown, actorId: string): Promise<BatchView> {
    const input = parse(createInput, body);
    const created = await this.prisma.recoveryBatch.create({ data: { name: input.name, note: input.note ?? null, createdBy: actorId } }).catch(rethrow);
    await this.audit.record({ action: "recovery.batch.created", objectType: "RecoveryBatch", objectId: created.id, actorId, details: { name: input.name } });
    return this.summary({ ...created, items: [] });
  }

  /** Un brouillon par transaction qualifiée, non liée, hors virement, dans un exercice ouvert ; compte rendu des ignorées. */
  async prepareEntries(id: string, body: unknown, actorId: string): Promise<PrepareReport> {
    const input = parse(prepareInput, body);
    await this.loadOpen(id);
    const account = await this.prisma.financialAccount.findUnique({ where: { id: input.financialAccountId } });
    if (!account) throw new AccountingNotFoundError("Compte financier");

    const years = await this.prisma.fiscalYear.findMany({ select: { id: true, start: true, end: true, status: true } });
    const transactions = await this.prisma.transaction.findMany({
      where: {
        financialAccountId: account.id,
        ...((input.from || input.to) && { operationDate: { ...(input.from && { gte: asDate(input.from) }), ...(input.to && { lte: asDate(input.to) }) } }),
      },
      include: {
        counterpartAccount: { select: { number: true } },
        matches: { where: { status: "ACTIVE" }, select: { id: true } },
        transferOut: { select: { id: true } },
        transferIn: { select: { id: true } },
      },
      orderBy: [{ operationDate: "asc" }, { id: "asc" }],
      take: 1000,
    });

    const report: PrepareReport = { created: 0, skipped: [], skippedByReason: {} };
    const skip = (t: (typeof transactions)[number], reason: SkipReason, message?: string) => {
      report.skippedByReason[reason] = (report.skippedByReason[reason] ?? 0) + 1;
      if (report.skipped.length < REPORT_DETAIL_LIMIT) {
        report.skipped.push({ transactionId: t.id, date: day(t.operationDate), label: t.label, amount: t.amount.toFixed(2), reason, message: message ?? SKIP_LABELS[reason] });
      }
    };

    for (const t of transactions) {
      if (t.matches.length > 0) skip(t, "ALREADY_LINKED");
      else if (t.transferOut || t.transferIn) skip(t, "TRANSFER");
      else if (!t.counterpartAccountId || !t.counterpartAccount) skip(t, "NOT_QUALIFIED");
      else {
        const year = years.find((y) => y.start <= t.operationDate && y.end >= t.operationDate);
        if (!year) skip(t, "NO_FISCAL_YEAR");
        else if (year.status !== "OPEN") skip(t, "YEAR_NOT_OPEN");
        else {
          try {
            await this.prisma.$transaction(async (db) => {
              const entry = await db.journalEntry.create({
                data: draftDataFor(
                  { ...t, counterpartAccountId: t.counterpartAccountId!, counterpartAccount: t.counterpartAccount!, financialAccount: { accountId: account.accountId, journalId: account.journalId } },
                  year.id,
                  actorId,
                ),
                select: { id: true },
              });
              await db.treasuryMatch.create({ data: { transactionId: t.id, entryId: entry.id, financialAccountId: account.id, createdBy: actorId } });
              await db.recoveryBatchItem.create({ data: { batchId: id, entryId: entry.id, kind: "TRANSACTION", financialAccountId: account.id } });
            });
            report.created += 1;
          } catch (error) {
            skip(t, "REFUSED", triggerMessage(error) ?? SKIP_LABELS.REFUSED);
          }
        }
      }
    }
    await this.audit.record({
      action: "recovery.entries.prepared",
      objectType: "RecoveryBatch",
      objectId: id,
      actorId,
      details: { accountId: account.id, created: report.created, skipped: Object.values(report.skippedByReason).reduce((a, b) => a + b, 0) },
    });
    return report;
  }

  /** Brouillon d'ouverture : banque / compte de classe 1 choisi, origine expliquée, aucun compte d'équilibrage automatique. */
  async prepareOpening(id: string, body: unknown, actorId: string): Promise<BatchItemView> {
    const input = parse(openingInput, body);
    await this.loadOpen(id);
    const account = await this.prisma.financialAccount.findUnique({ where: { id: input.financialAccountId }, include: { account: { select: { number: true } } } });
    if (!account) throw new AccountingNotFoundError("Compte financier");
    const opening = account.openingBalance;
    if (opening.isZero()) {
      throw new AccountingConflictError(`Le compte « ${account.name} » a un solde d'ouverture nul : il n'y a rien à reprendre.`);
    }
    const counterpart = await this.prisma.account.findUnique({ where: { id: input.counterpartAccountId } });
    if (!counterpart) throw new AccountingNotFoundError("Compte de contrepartie");
    if (!counterpart.number.startsWith("1")) {
      throw new AccountingConflictError("L'origine d'un solde d'ouverture se choisit parmi les comptes de capitaux (classe 1) : fonds associatifs, report à nouveau, réserves…");
    }
    if (!counterpart.active) throw new AccountingConflictError(`Le compte ${counterpart.number} est désactivé.`);
    const journal = await this.prisma.journal.findFirst({ where: { type: "OPENING", active: true }, orderBy: { code: "asc" } });
    if (!journal) throw new AccountingConflictError("Aucun journal d'à-nouveaux actif : créez-en un dans les paramètres comptables.");
    const year = await this.prisma.fiscalYear.findFirst({ where: { start: { lte: account.openedOn }, end: { gte: account.openedOn } }, select: { id: true } });
    if (!year) throw new AccountingConflictError(`Aucun exercice ne couvre la date d'ouverture du compte (${day(account.openedOn)}). Créez l'exercice d'abord.`);

    const absolute = opening.abs().toFixed(2);
    const positive = opening.gt(0);
    const entryId = await this.prisma
      .$transaction(async (db) => {
        const entry = await db.journalEntry.create({
          data: {
            fiscalYearId: year.id,
            journalId: journal.id,
            date: account.openedOn,
            label: `Solde d'ouverture de ${account.name} — ${input.explanation}`.slice(0, 200),
            createdBy: actorId,
            lines: {
              create: [
                { position: 1, accountId: account.accountId, debit: positive ? absolute : "0", credit: positive ? "0" : absolute },
                { position: 2, accountId: counterpart.id, debit: positive ? "0" : absolute, credit: positive ? absolute : "0" },
              ],
            },
          },
          select: { id: true },
        });
        await db.recoveryBatchItem.create({ data: { batchId: id, entryId: entry.id, kind: "OPENING", financialAccountId: account.id } });
        return entry.id;
      })
      .catch(rethrow);
    await this.audit.record({
      action: "recovery.opening.prepared",
      objectType: "RecoveryBatch",
      objectId: id,
      actorId,
      details: { accountId: account.id, entryId, counterpart: counterpart.number },
    });
    const { items } = await this.get(id);
    return items.find((item) => item.entryId === entryId)!;
  }

  /** Comptabilise les brouillons du lot dans l'ordre chronologique, chacun isolé ; les refusés restent en brouillon. */
  async post(id: string, actorId: string): Promise<PostReport> {
    await this.loadOpen(id);
    const drafts = await this.prisma.recoveryBatchItem.findMany({
      where: { batchId: id, entry: { status: "DRAFT" } },
      orderBy: [{ entry: { date: "asc" } }, { createdAt: "asc" }],
      select: { entry: { select: { id: true, date: true, label: true } } },
    });
    const report: PostReport = { posted: 0, failed: [], remainingDrafts: 0, completed: false };
    for (const { entry } of drafts) {
      try {
        await this.entries.post(entry.id, actorId);
        report.posted += 1;
      } catch (error) {
        const messages =
          error instanceof EntryPostingRefusedError ? error.errors.map((e) => e.message) : [triggerMessage(error) ?? "L'écriture n'a pas pu être comptabilisée."];
        report.failed.push({ entryId: entry.id, date: day(entry.date), label: entry.label, messages });
      }
    }
    report.remainingDrafts = report.failed.length;
    if (report.remainingDrafts === 0 && (report.posted > 0 || (await this.prisma.recoveryBatchItem.count({ where: { batchId: id } })) > 0)) {
      await this.prisma.recoveryBatch.update({ where: { id }, data: { status: "COMPLETED", closedAt: new Date() } }).catch(rethrow);
      report.completed = true;
    }
    await this.audit.record({
      action: "recovery.batch.posted",
      objectType: "RecoveryBatch",
      objectId: id,
      actorId,
      details: { posted: report.posted, failed: report.failed.length, completed: report.completed },
    });
    return report;
  }

  /** Supprime les brouillons du lot (liaisons libérées) ; les écritures comptabilisées restent intactes. */
  async abandon(id: string, actorId: string): Promise<{ deleted: number; kept: number }> {
    await this.loadOpen(id);
    const result = await this.prisma
      .$transaction(async (db) => {
        const items = await db.recoveryBatchItem.findMany({ where: { batchId: id }, select: { entry: { select: { id: true, status: true } } } });
        const draftIds = items.filter((i) => i.entry.status === "DRAFT").map((i) => i.entry.id);
        if (draftIds.length > 0) await db.journalEntry.deleteMany({ where: { id: { in: draftIds }, status: "DRAFT" } });
        await db.recoveryBatch.update({ where: { id }, data: { status: "ABANDONED", abandonedAt: new Date(), abandonedBy: actorId } });
        return { deleted: draftIds.length, kept: items.length - draftIds.length };
      })
      .catch(rethrow);
    await this.audit.record({ action: "recovery.batch.abandoned", objectType: "RecoveryBatch", objectId: id, actorId, details: result });
    return result;
  }

  private async loadOpen(id: string) {
    const row = await this.prisma.recoveryBatch.findUnique({ where: { id } });
    if (!row) throw new AccountingNotFoundError("Lot de reprise");
    if (row.status !== "OPEN") throw new AccountingConflictError("Ce lot de reprise n'est plus en préparation : il ne change plus.");
    return row;
  }

  private summary(row: {
    id: string;
    name: string;
    note: string | null;
    status: RecoveryBatchStatus;
    createdAt: Date;
    closedAt: Date | null;
    abandonedAt: Date | null;
    items: { entry: { status: string } }[];
  }): BatchView {
    const drafts = row.items.filter((i) => i.entry.status === "DRAFT").length;
    return {
      id: row.id,
      name: row.name,
      note: row.note,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      abandonedAt: row.abandonedAt?.toISOString() ?? null,
      drafts,
      posted: row.items.length - drafts,
      total: row.items.length,
    };
  }
}
