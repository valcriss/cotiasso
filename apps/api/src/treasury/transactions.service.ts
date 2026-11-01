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
  /** Qualifiée = nature (compte de contrepartie) choisie ; ne préjuge pas de la comptabilisation ni du rapprochement. */
  qualified: boolean;
  version: number;
}

const include = {
  project: { select: { code: true } },
  counterpartAccount: { select: { number: true } },
} satisfies Prisma.TransactionInclude;
type Loaded = Prisma.TransactionGetPayload<{ include: typeof include }>;

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);

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
  qualified: t.counterpartAccountId !== null,
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
        ...(q.qualified && { counterpartAccountId: q.qualified === "true" ? { not: null } : null }),
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
