import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { z } from "zod";
import { Money } from "@cotiasso/accounting-domain";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { signedAmount } from "./financial-accounts.service.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");
const label = z.string().trim().min(1, "Libellé obligatoire.").max(200, "Libellé trop long (200 caractères).");
const nonZero = signedAmount.refine((value) => Number(value) !== 0, "Le montant ne peut pas être nul.");

const transactionInput = z
  .object({
    operationDate: isoDate,
    valueDate: isoDate.nullish(),
    amount: nonZero,
    label,
    reference: z.string().trim().max(100).nullish(),
    projectId: z.uuid().nullish(),
    counterpartAccountId: z.uuid().nullish(),
  })
  .strict();

const transactionPatch = z
  .object({
    version: z.number().int().min(1),
    operationDate: isoDate.optional(),
    valueDate: isoDate.nullable().optional(),
    amount: nonZero.optional(),
    label: label.optional(),
    reference: z.string().trim().max(100).nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    counterpartAccountId: z.uuid().nullable().optional(),
  })
  .strict();

const qualifyInput = z
  .object({
    transactionIds: z.array(z.uuid()).min(1, "Cochez au moins une transaction.").max(200, "200 transactions au plus à la fois."),
    counterpartAccountId: z.uuid().optional(),
    projectId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => value.counterpartAccountId !== undefined || value.projectId !== undefined, {
    message: "Choisissez un compte de contrepartie et/ou un projet à appliquer.",
    path: ["counterpartAccountId"],
  });

const listQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    minAmount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
    maxAmount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
    q: z.string().trim().max(100).optional(),
    origin: z.enum(["MANUAL", "IMPORT"]).optional(),
    projectId: z.uuid().optional(),
    qualified: z.enum(["true", "false"]).optional(),
    accounting: z.enum(["NONE", "IN_PROGRESS", "POSTED"]).optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export interface TransactionView {
  id: string;
  financialAccountId: string;
  operationDate: string;
  valueDate: string | null;
  /** Montant signé : encaissement positif, décaissement négatif. */
  amount: string;
  label: string;
  reference: string | null;
  origin: "MANUAL" | "IMPORT";
  externalId: string | null;
  /** Identifiée par la banque (importée, ou saisie rattachée à une ligne de relevé) : données financières figées. */
  bankIdentified: boolean;
  projectId: string | null;
  projectCode: string | null;
  counterpartAccountId: string | null;
  counterpartAccountNumber: string | null;
  /** Qualifiée = nature (compte de contrepartie) choisie, ou répartie sur plusieurs comptes ; ne préjuge pas de la comptabilisation ni du rapprochement. */
  qualified: boolean;
  /** Répartie sur plusieurs catégories (« fractionnée ») : pas de contrepartie unique, ses parts sont dans les lignes de l'écriture liée. */
  split: boolean;
  /**
   * Comptabilisation (dimension distincte du rapprochement) : « à comptabiliser » (NONE), « en cours » tant que l'écriture
   * liée est un brouillon (IN_PROGRESS), « comptabilisée » (POSTED).
   */
  accounting: "NONE" | "IN_PROGRESS" | "POSTED";
  /** Écriture liée (liaison active), le cas échéant. */
  entry: { id: string; status: "DRAFT" | "POSTED"; journalCode: string; number: number | null } | null;
  /** Virement interne dont la transaction fait partie : sens et compte de l'autre côté. */
  transfer: { id: string; direction: "OUT" | "IN"; otherAccountId: string; otherAccountName: string } | null;
  /** Montant, date et compte figés (identifiant bancaire, écriture liée ou virement). */
  financialLock: "RECONCILED" | "BANK" | "ENTRY" | "TRANSFER" | null;
  /** Peut encore être supprimée (saisie manuelle jamais identifiée, liée ni virée). */
  deletable: boolean;
  /** Rapprochement bancaire où la transaction est pointée (ADR 0018) ; « validé » = rapprochée. */
  reconciliation: { id: string; status: "IN_PROGRESS" | "VALIDATED"; periodEnd: string } | null;
  version: number;
}

export const transactionInclude = {
  project: { select: { code: true } },
  counterpartAccount: { select: { number: true } },
  reconciliation: { select: { id: true, status: true, periodEnd: true } },
  matches: { select: { status: true, entry: { select: { id: true, status: true, number: true, journal: { select: { code: true } }, _count: { select: { lines: true } } } } } },
  transferOut: { select: { id: true, inTransaction: { select: { financialAccount: { select: { id: true, name: true } } } } } },
  transferIn: { select: { id: true, outTransaction: { select: { financialAccount: { select: { id: true, name: true } } } } } },
} satisfies Prisma.TransactionInclude;
const include = transactionInclude;
type Loaded = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

/** Liaison active à une écriture non contrepassée qui a au moins deux parts de contrepartie (trois lignes ou plus). */
const SPLIT_MATCH = { status: "ACTIVE", entry: { status: { not: "REVERSED" }, lines: { some: { position: { gte: 3 } } } } } satisfies Prisma.TreasuryMatchWhereInput;

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);

export const transactionView = (t: Loaded): TransactionView => view(t);

/** Fractionnée : pas de contrepartie unique, et une écriture liée à plus d'une ligne de contrepartie (banque + au moins deux parts). */
function qualificationOf(t: Loaded): Pick<TransactionView, "qualified" | "split"> {
  const active = t.matches.find((m) => m.status === "ACTIVE" && m.entry.status !== "REVERSED");
  const split = t.counterpartAccountId === null && !t.transferOut && !t.transferIn && !!active && active.entry._count.lines > 2;
  return { qualified: t.counterpartAccountId !== null || split, split };
}

function accountingOf(t: Loaded): Pick<TransactionView, "accounting" | "entry" | "financialLock" | "transfer" | "deletable" | "reconciliation"> {
  const active = t.matches.find((m) => m.status === "ACTIVE");
  const entry = active && active.entry.status !== "REVERSED" ? { id: active.entry.id, status: active.entry.status as "DRAFT" | "POSTED", journalCode: active.entry.journal.code, number: active.entry.number } : null;
  const transfer = t.transferOut
    ? { id: t.transferOut.id, direction: "OUT" as const, otherAccountId: t.transferOut.inTransaction.financialAccount.id, otherAccountName: t.transferOut.inTransaction.financialAccount.name }
    : t.transferIn
      ? { id: t.transferIn.id, direction: "IN" as const, otherAccountId: t.transferIn.outTransaction.financialAccount.id, otherAccountName: t.transferIn.outTransaction.financialAccount.name }
      : null;
  return {
    accounting: entry ? (entry.status === "DRAFT" ? "IN_PROGRESS" : "POSTED") : "NONE",
    entry,
    transfer,
    financialLock: t.reconciliation?.status === "VALIDATED" ? "RECONCILED" : t.externalId !== null ? "BANK" : t.matches.length > 0 ? "ENTRY" : transfer ? "TRANSFER" : null,
    deletable: t.origin === "MANUAL" && t.externalId === null && t.matches.length === 0 && transfer === null && t.reconciliation === null,
    reconciliation: t.reconciliation && t.reconciliation.status !== "CANCELLED" ? { id: t.reconciliation.id, status: t.reconciliation.status, periodEnd: day(t.reconciliation.periodEnd) } : null,
  };
}

const view = (t: Loaded): TransactionView => ({
  id: t.id,
  financialAccountId: t.financialAccountId,
  operationDate: day(t.operationDate),
  valueDate: t.valueDate ? day(t.valueDate) : null,
  amount: Money.parse(t.amount.toFixed(2)).toString(),
  label: t.label,
  reference: t.reference,
  origin: t.origin,
  externalId: t.externalId,
  bankIdentified: t.externalId !== null,
  projectId: t.projectId,
  projectCode: t.project?.code ?? null,
  counterpartAccountId: t.counterpartAccountId,
  counterpartAccountNumber: t.counterpartAccount?.number ?? null,
  ...accountingOf(t),
  ...qualificationOf(t),
  version: t.version,
});

const REFUSALS = [
  "Le compte financier est archivé",
  "précède l'ouverture",
  "Le compte de contrepartie",
  "projet archivé",
  "Une transaction importée",
  "données financières d'une transaction importée",
  "identifiant bancaire",
  "liée à une écriture",
  "ne correspond",
  "rapproch",
  "pointé",
];

/**
 * Transactions : mouvements financiers d'un compte, distincts des écritures comptables. Une transaction manuelle se
 * modifie et se supprime tant qu'elle n'est pas comptabilisée ; une transaction importée garde ses données financières
 * inchangées (la qualification est enregistrée à part). Les garanties sont dans la base.
 */
@Injectable()
export class TransactionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(accountId: string, query: unknown): Promise<{ transactions: TransactionView[]; next: string | null }> {
    const q = parse(listQuery, query);
    await this.assertAccount(accountId);
    const rows = await this.prisma.transaction.findMany({
      where: {
        financialAccountId: accountId,
        ...((q.from || q.to) && { operationDate: { ...(q.from && { gte: asDate(q.from)! }), ...(q.to && { lte: asDate(q.to)! }) } }),
        ...(q.origin && { origin: q.origin }),
        ...(q.projectId && { projectId: q.projectId }),
        ...(q.accounting === "NONE" && { matches: { none: { status: "ACTIVE" } } }),
        ...(q.accounting === "IN_PROGRESS" && { matches: { some: { status: "ACTIVE", entry: { status: "DRAFT" } } } }),
        ...(q.accounting === "POSTED" && { matches: { some: { status: "ACTIVE", entry: { status: "POSTED" } } } }),
        // « Classée » compte aussi un mouvement fractionné (pas de contrepartie unique, mais une écriture à plusieurs parts).
        ...(q.qualified === "true" && { NOT: { counterpartAccountId: null, NOT: { matches: { some: SPLIT_MATCH } } } }),
        ...(q.qualified === "false" && { counterpartAccountId: null, NOT: { matches: { some: SPLIT_MATCH } } }),
        ...(q.q && {
          OR: [
            { label: { contains: q.q, mode: "insensitive" } },
            { reference: { contains: q.q, mode: "insensitive" } },
          ],
        }),
        // Montant en valeur absolue : un filtre « de 50 à 200 » vaut pour les encaissements comme les décaissements.
        ...((q.minAmount || q.maxAmount) && {
          AND: [
            {
              OR: [
                { amount: { ...(q.minAmount && { gte: q.minAmount }), ...(q.maxAmount && { lte: q.maxAmount }) } },
                {
                  amount: {
                    ...(q.maxAmount && { gte: `-${q.maxAmount}` }),
                    ...(q.minAmount && { lte: `-${q.minAmount}` }),
                  },
                },
              ],
            },
          ],
        }),
      },
      include,
      orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.after && { cursor: { id: q.after }, skip: 1 }),
    });
    const page = rows.slice(0, q.limit);
    return { transactions: page.map(view), next: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async create(accountId: string, body: unknown, actorId: string): Promise<TransactionView> {
    const input = parse(transactionInput, body);
    await this.assertAccount(accountId);
    const created = await this.prisma.transaction
      .create({
        data: {
          financialAccountId: accountId,
          operationDate: asDate(input.operationDate)!,
          valueDate: asDate(input.valueDate),
          amount: input.amount,
          label: input.label,
          reference: input.reference ?? null,
          projectId: input.projectId ?? null,
          counterpartAccountId: input.counterpartAccountId ?? null,
          createdBy: actorId,
        },
        include,
      })
      .catch((error) => this.rethrow(error));
    await this.audit.record({ action: "transaction.created", objectType: "Transaction", objectId: created.id, actorId, details: { accountId } });
    return view(created);
  }

  /** Applique un compte de contrepartie et/ou un projet à une sélection de transactions d'un compte (tout ou rien). */
  async qualifyMany(accountId: string, body: unknown, actorId: string): Promise<{ updated: number }> {
    const input = parse(qualifyInput, body);
    await this.assertAccount(accountId);
    const ids = [...new Set(input.transactionIds)];
    const updated = await this.prisma
      .$transaction(async (db) => {
        const result = await db.transaction.updateMany({
          where: { id: { in: ids }, financialAccountId: accountId },
          data: {
            ...(input.counterpartAccountId !== undefined && { counterpartAccountId: input.counterpartAccountId }),
            ...(input.projectId !== undefined && { projectId: input.projectId }),
            version: { increment: 1 },
          },
        });
        if (result.count !== ids.length) {
          throw new AccountingConflictError("Certaines transactions n'appartiennent pas à ce compte : rien n'a été modifié.");
        }
        return result.count;
      })
      .catch((error) => this.rethrow(error));
    await this.audit.record({
      action: "transactions.qualified",
      objectType: "FinancialAccount",
      objectId: accountId,
      actorId,
      details: { count: updated, counterpart: input.counterpartAccountId !== undefined, project: input.projectId !== undefined },
    });
    return { updated };
  }

  async update(id: string, body: unknown, actorId: string): Promise<TransactionView> {
    const { version, operationDate, valueDate, ...patch } = parse(transactionPatch, body);
    const current = await this.prisma.transaction.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Transaction");
    if (current.externalId !== null && (patch.amount !== undefined || operationDate !== undefined)) {
      throw new AccountingConflictError("Le montant et la date d'une transaction importée ou rattachée à un relevé ne changent pas : les données de la banque sont conservées.");
    }
    // Contrôle de version optimiste : personne n'a modifié la transaction entre-temps.
    const changed = await this.prisma.transaction
      .updateMany({
        where: { id, version },
        data: {
          ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
          ...(operationDate !== undefined && { operationDate: asDate(operationDate)! }),
          ...(valueDate !== undefined && { valueDate: asDate(valueDate) }),
          version: { increment: 1 },
        },
      })
      .catch((error) => this.rethrow(error));
    if (changed.count !== 1) {
      throw new AccountingConflictError("Cette transaction a été modifiée entre-temps. Rechargez-la avant de l'enregistrer.");
    }
    await this.audit.record({
      action: "transaction.updated",
      objectType: "Transaction",
      objectId: id,
      actorId,
      details: { fields: Object.keys({ ...patch, ...(operationDate !== undefined && { operationDate }), ...(valueDate !== undefined && { valueDate }) }) },
    });
    return view(await this.load(id));
  }

  async remove(id: string, actorId: string): Promise<void> {
    const current = await this.prisma.transaction.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Transaction");
    if (current.origin !== "MANUAL" || current.externalId !== null) {
      throw new AccountingConflictError("Une transaction importée ou rattachée à un relevé ne se supprime pas.");
    }
    await this.prisma.transaction.delete({ where: { id } }).catch((error) => this.rethrow(error));
    await this.audit.record({ action: "transaction.deleted", objectType: "Transaction", objectId: id, actorId, details: { accountId: current.financialAccountId } });
  }

  private async load(id: string): Promise<Loaded> {
    const row = await this.prisma.transaction.findUnique({ where: { id }, include });
    if (!row) throw new AccountingNotFoundError("Transaction");
    return row;
  }

  private async assertAccount(id: string): Promise<void> {
    if (!(await this.prisma.financialAccount.findUnique({ where: { id }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Compte financier");
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
    const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
    if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Projet ou compte de contrepartie inexistant.");
    const line = text.split("\n").find((l) => REFUSALS.some((fragment) => l.includes(fragment)));
    if (line) throw new AccountingConflictError(line.replace(/^.*?ERROR:\s*/, "").trim());
    throw error;
  }
}
