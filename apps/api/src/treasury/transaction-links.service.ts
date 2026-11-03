import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "./db-refusal.js";
import { transactionInclude, transactionView, type TransactionView } from "./transactions.service.js";

const prepareInput = z.object({ journalId: z.uuid().optional() }).strict();
const linkInput = z.object({ entryId: z.uuid() }).strict();

export interface EntryCandidate {
  id: string;
  date: string;
  label: string;
  status: "DRAFT" | "POSTED";
  journalCode: string;
  number: number | null;
}

/** Refus levés par les déclencheurs SQL ou les contrôles de saisie, traduits en messages lisibles. */
const REFUSALS = [
  "ne correspond",
  "Seule une écriture ordinaire",
  "liée à une écriture",
  "liaison",
  "virement",
  "n'est pas ouvert",
  "exercice",
  "désactivé",
  "archivé",
  "immuable",
];

export function linkRefusal(error: unknown): string | null {
  const raised = triggerMessage(error);
  if (raised && REFUSALS.some((fragment) => raised.includes(fragment))) return raised;
  const text = `${(error as Error)?.message ?? ""}\n${String((error as { cause?: unknown })?.cause ?? "")}`;
  const line = text.split("\n").find((candidate) => REFUSALS.some((fragment) => candidate.includes(fragment)));
  return line ? line.replace(/^.*?ERROR:\s*/, "").trim() : null;
}

export function rethrowLink(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  if (/P2002|Unique constraint|23505|duplicate key/i.test(text)) {
    throw new AccountingConflictError("Cette transaction est déjà liée à une écriture, ou cette écriture l'est déjà pour ce compte financier.");
  }
  if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Écriture, journal ou projet inexistant.");
  const refusal = linkRefusal(error);
  if (refusal) throw new AccountingConflictError(refusal);
  throw error;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/** Transaction qualifiée, avec ce qu'il faut pour préparer son brouillon d'écriture. */
export interface DraftSource {
  id: string;
  label: string;
  reference: string | null;
  amount: Prisma.Decimal;
  operationDate: Date;
  projectId: string | null;
  counterpartAccountId: string;
  counterpartAccount: { number: string };
  financialAccount: { accountId: string; journalId: string };
}

/** Une part de contrepartie d'un brouillon : un compte et la fraction du montant de la transaction qui lui revient. */
export interface DraftSplit {
  accountId: string;
  accountNumber: string;
  /** Montant positif à deux décimales. */
  amount: string;
}

type DraftBase = Omit<DraftSource, "counterpartAccountId" | "counterpartAccount">;

/**
 * Brouillon d'écriture : ligne de trésorerie + une ligne par part de contrepartie (+ projet proposé pour les classes 6 et 7,
 * ADR 0013). Le total des parts doit égaler le montant de la transaction : la base le refuse sinon (écriture déséquilibrée).
 */
function buildDraft(tx: DraftBase, parts: DraftSplit[], fiscalYearId: string, actorId: string, journalId?: string): Prisma.JournalEntryUncheckedCreateInput {
  const absolute = tx.amount.abs().toFixed(2);
  const incoming = tx.amount.gt(0);
  return {
    fiscalYearId,
    journalId: journalId ?? tx.financialAccount.journalId,
    date: tx.operationDate,
    label: tx.label,
    reference: tx.reference,
    createdBy: actorId,
    lines: {
      create: [
        { position: 1, accountId: tx.financialAccount.accountId, debit: incoming ? absolute : "0", credit: incoming ? "0" : absolute },
        ...parts.map((part, index) => ({
          position: index + 2,
          accountId: part.accountId,
          debit: incoming ? "0" : part.amount,
          credit: incoming ? part.amount : "0",
          ...(tx.projectId && /^[67]/.test(part.accountNumber) && { allocations: { create: [{ projectId: tx.projectId, amount: part.amount }] } }),
        })),
      ],
    },
  };
}

/**
 * Brouillon d'écriture d'une transaction qualifiée : ligne de trésorerie + ligne de contrepartie. Partagé par la préparation
 * unitaire (ADR 0017) et par les lots de reprise (ADR 0019).
 */
export function draftDataFor(tx: DraftSource, fiscalYearId: string, actorId: string, journalId?: string): Prisma.JournalEntryUncheckedCreateInput {
  return buildDraft(tx, [{ accountId: tx.counterpartAccountId, accountNumber: tx.counterpartAccount.number, amount: tx.amount.abs().toFixed(2) }], fiscalYearId, actorId, journalId);
}

/** Brouillon d'une transaction répartie sur plusieurs comptes (« fractionner », ADR 0028) : une ligne de contrepartie par part. */
export function draftDataForSplits(tx: DraftBase, splits: DraftSplit[], fiscalYearId: string, actorId: string, journalId?: string): Prisma.JournalEntryUncheckedCreateInput {
  return buildDraft(tx, splits, fiscalYearId, actorId, journalId);
}

/**
 * Liaison d'une transaction à l'écriture qui la comptabilise (ADR 0017) : préparation d'un brouillon, association d'une
 * écriture existante, dissociation d'un brouillon. L'invariant (la ligne de banque de l'écriture égale la transaction) et
 * les cas interdits sont garantis par les déclencheurs SQL ; ce service ajoute les messages et l'audit.
 */
@Injectable()
export class TransactionLinksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Prépare un brouillon d'écriture depuis la transaction (trésorerie + contrepartie + projet proposé) et le lui relie. */
  async prepareEntry(transactionId: string, body: unknown, actorId: string): Promise<{ transaction: TransactionView; entryId: string }> {
    const input = parse(prepareInput, body);
    const tx = await this.load(transactionId);
    if (tx.matches.some((m) => m.status === "ACTIVE")) {
      throw new AccountingConflictError("Cette transaction est déjà liée à une écriture.");
    }
    if (!tx.counterpartAccountId || !tx.counterpartAccount) {
      throw new AccountingConflictError(
        "Choisissez d'abord le compte de contrepartie de la transaction (modifiez-la) : sans lui, on ne peut pas deviner la nature de l'opération.",
      );
    }
    const year = await this.prisma.fiscalYear.findFirst({
      where: { start: { lte: tx.operationDate }, end: { gte: tx.operationDate } },
      select: { id: true },
    });
    if (!year) throw new AccountingConflictError("Aucun exercice ne couvre la date de cette transaction. Créez l'exercice d'abord.");

    const entryId = await this.prisma
      .$transaction(async (db) => {
        const entry = await db.journalEntry.create({
          data: draftDataFor({ ...tx, counterpartAccountId: tx.counterpartAccountId!, counterpartAccount: tx.counterpartAccount! }, year.id, actorId, input.journalId),
          select: { id: true },
        });
        await db.treasuryMatch.create({
          data: { transactionId: tx.id, entryId: entry.id, financialAccountId: tx.financialAccountId, createdBy: actorId },
        });
        return entry.id;
      })
      .catch(rethrowLink);
    await this.audit.record({ action: "transaction.entry.prepared", objectType: "Transaction", objectId: tx.id, actorId, details: { entryId } });
    return { transaction: await this.view(tx.id), entryId };
  }

  /** Associe une écriture existante dont la ligne de banque correspond à la transaction. */
  async link(transactionId: string, body: unknown, actorId: string): Promise<TransactionView> {
    const { entryId } = parse(linkInput, body);
    const tx = await this.load(transactionId);
    if (!(await this.prisma.journalEntry.findUnique({ where: { id: entryId }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Écriture");
    }
    await this.prisma.treasuryMatch
      .create({ data: { transactionId: tx.id, entryId, financialAccountId: tx.financialAccountId, createdBy: actorId } })
      .catch(rethrowLink);
    await this.audit.record({ action: "transaction.linked", objectType: "Transaction", objectId: tx.id, actorId, details: { entryId } });
    return this.view(tx.id);
  }

  /** Dissocie la transaction d'un brouillon : elle redevient à comptabiliser. Une écriture comptabilisée se contrepasse. */
  async unlink(transactionId: string, actorId: string): Promise<TransactionView> {
    const active = await this.prisma.treasuryMatch.findFirst({
      where: { transactionId, status: "ACTIVE" },
      include: { entry: { select: { status: true } } },
    });
    if (!active) throw new AccountingConflictError("Cette transaction n'est liée à aucune écriture.");
    if (active.entry.status !== "DRAFT") {
      throw new AccountingConflictError("L'écriture liée est comptabilisée : pour défaire la liaison, contrepassez l'écriture.");
    }
    await this.prisma.treasuryMatch.delete({ where: { id: active.id } }).catch(rethrowLink);
    await this.audit.record({ action: "transaction.unlinked", objectType: "Transaction", objectId: transactionId, actorId, details: { entryId: active.entryId } });
    return this.view(transactionId);
  }

  /** Écritures auxquelles la transaction peut être associée : ligne de banque de même montant, pas déjà liées pour ce compte. */
  async candidates(transactionId: string): Promise<EntryCandidate[]> {
    const tx = await this.load(transactionId);
    const rows = await this.prisma.journalEntry.findMany({
      where: {
        kind: "NORMAL",
        status: { in: ["DRAFT", "POSTED"] },
        lines: { some: { accountId: tx.financialAccount.accountId } },
        matches: { none: { financialAccountId: tx.financialAccountId, status: "ACTIVE" } },
      },
      include: { journal: { select: { code: true } }, lines: { select: { accountId: true, debit: true, credit: true } } },
      orderBy: { date: "desc" },
      take: 300,
    });
    const gap = (date: Date) => Math.abs(date.getTime() - tx.operationDate.getTime());
    return rows
      .filter((entry) =>
        entry.lines
          .filter((l) => l.accountId === tx.financialAccount.accountId)
          .reduce((sum, l) => sum.plus(l.debit).minus(l.credit), new Prisma.Decimal(0))
          .eq(tx.amount),
      )
      .sort((a, b) => gap(a.date) - gap(b.date))
      .slice(0, 20)
      .map((entry) => ({
        id: entry.id,
        date: day(entry.date),
        label: entry.label,
        status: entry.status as "DRAFT" | "POSTED",
        journalCode: entry.journal.code,
        number: entry.number,
      }));
  }

  private async load(id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: { ...transactionInclude, financialAccount: { select: { accountId: true, journalId: true } } },
    });
    if (!tx) throw new AccountingNotFoundError("Transaction");
    return tx;
  }

  private async view(id: string): Promise<TransactionView> {
    return transactionView(await this.prisma.transaction.findUniqueOrThrow({ where: { id }, include: transactionInclude }));
  }
}
