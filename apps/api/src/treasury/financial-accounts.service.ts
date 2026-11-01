import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { FinancialAccount, FinancialAccountType } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");
/** Montant signé à deux décimales au plus, en chaîne (NUMERIC(14,2)). */
export const signedAmount = z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/, "Montant invalide (12 chiffres et 2 décimales au plus).");
const name = z.string().trim().min(1, "Nom obligatoire.").max(120, "Nom trop long (120 caractères).");

const accountInput = z
  .object({
    name,
    type: z.enum(["BANK", "CASH"]),
    reference: z.string().trim().max(60).nullish(),
    accountId: z.uuid("Compte comptable invalide."),
    openedOn: isoDate,
    openingBalance: signedAmount.default("0"),
  })
  .strict();

const accountPatch = z
  .object({
    name: name.optional(),
    reference: z.string().trim().max(60).nullable().optional(),
    openedOn: isoDate.optional(),
    openingBalance: signedAmount.optional(),
    /** Archivage : seul `true` est permis, un compte archivé ne se réactive pas. */
    archived: z.literal(true).optional(),
  })
  .strict();

const statementInput = z
  .object({ periodStart: isoDate, periodEnd: isoDate, closingBalance: signedAmount })
  .strict()
  .refine((s) => s.periodStart <= s.periodEnd, { message: "La fin de période précède son début.", path: ["periodEnd"] });

export interface BalanceView {
  /** Solde d'ouverture saisi, à la date d'ouverture : une information, sans écriture associée. */
  opening: string;
  /** Solde calculé : ouverture + somme des transactions enregistrées. */
  computed: string;
  /** Solde des écritures comptabilisées sur le compte de trésorerie liée (peut différer tant que tout n'est pas comptabilisé). */
  accounting: string;
  /** Dernier rapprochement validé : seul état dans lequel le compte est dit « rapproché ». */
  reconciled: { periodEnd: string; closingBalance: string } | null;
  lastStatement: {
    periodEnd: string;
    closingBalance: string;
    /** Solde calculé à la date de fin du relevé. */
    computedAtEnd: string;
    /** Relevé moins calculé : tout écart non nul reste à expliquer ; le compte n'est pas présenté comme rapproché. */
    gap: string;
  } | null;
}

export interface FinancialAccountView {
  id: string;
  name: string;
  type: FinancialAccountType;
  currency: string;
  reference: string | null;
  accountId: string;
  accountNumber: string;
  journalId: string;
  journalCode: string;
  openedOn: string;
  archivedOn: string | null;
  balances: BalanceView;
}

export interface StatementView {
  id: string;
  periodStart: string;
  periodEnd: string;
  closingBalance: string;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const money = (value: { toFixed(places: number): string } | string) => Money.parse(typeof value === "string" ? value : value.toFixed(2));

function provided<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}

/**
 * Comptes bancaires et caisses. Chacun est lié à un compte de trésorerie (classe 5) et à un journal créés pour lui,
 * définitifs ; le solde initial est une information datée, le solde calculé vient des transactions, le solde de relevé
 * est une preuve distincte. Un compte utilisé s'archive, il ne se supprime pas.
 */
@Injectable()
export class FinancialAccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<FinancialAccountView[]> {
    const accounts = await this.prisma.financialAccount.findMany({
      orderBy: [{ archivedOn: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      include: { account: { select: { number: true } }, journal: { select: { code: true } } },
    });
    return Promise.all(accounts.map((account) => this.view(account)));
  }

  async get(id: string): Promise<FinancialAccountView> {
    const account = await this.prisma.financialAccount.findUnique({
      where: { id },
      include: { account: { select: { number: true } }, journal: { select: { code: true } } },
    });
    if (!account) throw new AccountingNotFoundError("Compte financier");
    return this.view(account);
  }

  async create(body: unknown, actorId: string): Promise<FinancialAccountView> {
    const input = parse(accountInput, body);
    const accounting = await this.prisma.account.findUnique({ where: { id: input.accountId } });
    if (!accounting) throw new AccountingNotFoundError("Compte comptable");
    if (!accounting.active) throw new AccountingConflictError("Le compte comptable est désactivé.");
    if (!accounting.number.startsWith("5")) {
      throw new AccountingConflictError("Un compte financier se rattache à un compte de trésorerie (classe 5).");
    }
    const taken = await this.prisma.financialAccount.findUnique({ where: { accountId: input.accountId } });
    if (taken) throw new AccountingConflictError(`Le compte ${accounting.number} est déjà utilisé par « ${taken.name} ».`);

    const created = await this.prisma
      .$transaction(async (tx) => {
        // Journal propre au compte : BQ-n pour une banque, CA-n pour une caisse.
        const prefix = input.type === "BANK" ? "BQ" : "CA";
        const codes = (await tx.journal.findMany({ where: { code: { startsWith: `${prefix}-` } }, select: { code: true } })).map((j) =>
          Number(j.code.slice(prefix.length + 1)),
        );
        const next = Math.max(0, ...codes.filter(Number.isInteger)) + 1;
        const journal = await tx.journal.create({
          data: { code: `${prefix}-${next}`, label: input.name, type: input.type, createdBy: actorId },
        });
        return tx.financialAccount.create({
          data: {
            name: input.name,
            type: input.type,
            reference: input.reference ?? null,
            accountId: input.accountId,
            journalId: journal.id,
            openedOn: asDate(input.openedOn),
            openingBalance: input.openingBalance,
            createdBy: actorId,
          },
          select: { id: true },
        });
      })
      .catch((error) => this.rethrow(error));
    await this.audit.record({
      action: "financial-account.created",
      objectType: "FinancialAccount",
      objectId: created.id,
      actorId,
      details: { type: input.type },
    });
    return this.get(created.id);
  }

  async update(id: string, body: unknown, actorId: string): Promise<FinancialAccountView> {
    const patch = parse(accountPatch, body);
    const current = await this.prisma.financialAccount.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Compte financier");
    if ((patch.openedOn !== undefined || patch.openingBalance !== undefined) && (await this.prisma.transaction.count({ where: { financialAccountId: id } })) > 0) {
      throw new AccountingConflictError("Le solde et la date d'ouverture ne changent plus une fois des transactions enregistrées.");
    }
    if (patch.archived && current.archivedOn) throw new AccountingConflictError("Ce compte est déjà archivé.");

    const { archived, openedOn, ...rest } = patch;
    await this.prisma.financialAccount
      .update({
        where: { id },
        data: {
          ...provided(rest),
          ...(openedOn !== undefined && { openedOn: asDate(openedOn) }),
          ...(archived && { archivedOn: asDate(day(new Date())) }),
        },
      })
      .catch((error) => this.rethrow(error));
    await this.audit.record({
      action: patch.archived ? "financial-account.archived" : "financial-account.updated",
      objectType: "FinancialAccount",
      objectId: id,
      actorId,
      details: { fields: Object.keys(patch) },
    });
    return this.get(id);
  }

  async listStatements(accountId: string): Promise<StatementView[]> {
    await this.get(accountId);
    const rows = await this.prisma.bankStatement.findMany({ where: { financialAccountId: accountId }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }] });
    return rows.map((row) => ({
      id: row.id,
      periodStart: day(row.periodStart),
      periodEnd: day(row.periodEnd),
      closingBalance: money(row.closingBalance).toString(),
    }));
  }

  /** Enregistre le solde d'un relevé : une preuve datée, en ajout seul, jamais une validation du solde calculé. */
  async addStatement(accountId: string, body: unknown, actorId: string): Promise<StatementView> {
    const input = parse(statementInput, body);
    await this.get(accountId);
    const row = await this.prisma.bankStatement.create({
      data: {
        financialAccountId: accountId,
        periodStart: asDate(input.periodStart),
        periodEnd: asDate(input.periodEnd),
        closingBalance: input.closingBalance,
        createdBy: actorId,
      },
    });
    await this.audit.record({ action: "bank-statement.recorded", objectType: "FinancialAccount", objectId: accountId, actorId, details: { periodEnd: input.periodEnd } });
    return {
      id: row.id,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      closingBalance: money(row.closingBalance).toString(),
    };
  }

  private async view(
    account: FinancialAccount & { account: { number: string }; journal: { code: string } },
  ): Promise<FinancialAccountView> {
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      reference: account.reference,
      accountId: account.accountId,
      accountNumber: account.account.number,
      journalId: account.journalId,
      journalCode: account.journal.code,
      openedOn: day(account.openedOn),
      archivedOn: account.archivedOn ? day(account.archivedOn) : null,
      balances: await this.balances(account),
    };
  }

  private async balances(account: FinancialAccount): Promise<BalanceView> {
    const opening = money(account.openingBalance);
    const [sum] = await this.prisma.$queryRaw<{ total: string | null }[]>`
      SELECT sum("amount")::text AS total FROM "Transaction" WHERE "financialAccountId" = ${account.id}::uuid`;
    const computed = opening.add(money(sum?.total ?? "0"));

    const [ledger] = await this.prisma.$queryRaw<{ net: string | null }[]>`
      SELECT (sum(l."debit") - sum(l."credit"))::text AS net
      FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
      WHERE l."accountId" = ${account.accountId}::uuid AND e."status" IN ('POSTED', 'REVERSED')`;

    const statement = await this.prisma.bankStatement.findFirst({
      where: { financialAccountId: account.id },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    });
    let lastStatement: BalanceView["lastStatement"] = null;
    if (statement) {
      const [upTo] = await this.prisma.$queryRaw<{ total: string | null }[]>`
        SELECT sum("amount")::text AS total FROM "Transaction"
        WHERE "financialAccountId" = ${account.id}::uuid AND "operationDate" <= ${statement.periodEnd}`;
      const computedAtEnd = opening.add(money(upTo?.total ?? "0"));
      const closing = money(statement.closingBalance);
      lastStatement = {
        periodEnd: day(statement.periodEnd),
        closingBalance: closing.toString(),
        computedAtEnd: computedAtEnd.toString(),
        gap: closing.subtract(computedAtEnd).toString(),
      };
    }
    const validated = await this.prisma.reconciliation.findFirst({
      where: { financialAccountId: account.id, status: "VALIDATED" },
      orderBy: { periodEnd: "desc" },
      select: { periodEnd: true, closingBalance: true },
    });
    return {
      opening: opening.toString(),
      computed: computed.toString(),
      reconciled: validated ? { periodEnd: day(validated.periodEnd), closingBalance: money(validated.closingBalance).toString() } : null,
      accounting: money(ledger?.net ?? "0").toString(),
      lastStatement,
    };
  }

  private rethrow(error: unknown): never {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
    const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
    if (/P2002|Unique constraint/i.test(text)) throw new AccountingConflictError("Ce compte comptable ou ce journal est déjà utilisé par un compte financier.");
    const line = text.split("\n").find((l) => /Un compte financier|Le solde et la date|journal d'un compte|classe 5|archivé/i.test(l));
    if (line) throw new AccountingConflictError(line.replace(/^.*?ERROR:\s*/, "").trim());
    throw error;
  }
}
