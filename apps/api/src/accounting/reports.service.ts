import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingNotFoundError } from "./errors.js";
import { parse } from "./schemas.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const base = {
  fiscalYearId: z.uuid("Exercice invalide."),
  from: isoDate.optional(),
  to: isoDate.optional(),
};
const prefix = z.string().regex(/^[1-8][0-9]{0,7}$/, "Préfixe de compte invalide (chiffres, classes 1 à 8).");

const ledgerQuery = z.object({ ...base, accountId: z.uuid().optional(), prefix: prefix.optional() }).strict();
const balanceQuery = z.object({ ...base, prefix: prefix.optional() }).strict();
const journalQuery = z.object({ ...base, journalId: z.uuid().optional() }).strict();

/** Garde-fou : un état trop volumineux est refusé avec un message qui invite à restreindre, jamais tronqué en silence. */
export const MAX_LEDGER_LINES = 5000;
export const MAX_JOURNAL_ENTRIES = 2000;

export class ReportTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportTooLargeError";
  }
}

export interface LedgerLine {
  date: string;
  journalCode: string;
  entryId: string;
  entryNumber: number;
  entryLabel: string;
  reference: string | null;
  lineLabel: string | null;
  debit: string;
  credit: string;
  /** Solde cumulé (débit − crédit) après cette ligne : positif = débiteur, négatif = créditeur. */
  balance: string;
}

export interface LedgerAccount {
  accountId: string;
  number: string;
  label: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
  lines: LedgerLine[];
}

export interface TrialBalanceRow {
  accountId: string;
  number: string;
  label: string;
  debit: string;
  credit: string;
  debitBalance: string;
  creditBalance: string;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { debit: string; credit: string; debitBalance: string; creditBalance: string };
  /** Vrai si les mouvements s'équilibrent (débit total = crédit total) : un faux est une anomalie à investiguer. */
  balanced: boolean;
}

export interface JournalBookEntry {
  id: string;
  date: string;
  journalCode: string;
  number: number;
  label: string;
  reference: string | null;
  kind: string;
  status: string;
  lines: { accountNumber: string; accountLabel: string; label: string | null; debit: string; credit: string }[];
  totalDebit: string;
  totalCredit: string;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const amount = (value: string) => Money.parse(value);

/**
 * États de lecture du grand livre : grand livre par compte, balance et livre-journal. Ils ne lisent que les
 * écritures comptabilisées ou contrepassées (jamais un brouillon) d'un exercice ; ce sont les mêmes lignes que celles
 * dont partiront les états de synthèse (lot 2c), il n'y a pas de seconde source de calcul.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ledger(query: unknown): Promise<{ accounts: LedgerAccount[] }> {
    const q = parse(ledgerQuery, query);
    await this.assertYear(q.fiscalYearId);

    const rows = await this.prisma.$queryRaw<
      {
        accountId: string;
        number: string;
        accountLabel: string;
        entryId: string;
        date: Date;
        journalCode: string;
        entryNumber: number;
        entryLabel: string;
        reference: string | null;
        lineLabel: string | null;
        debit: string;
        credit: string;
      }[]
    >(Prisma.sql`
      SELECT a.id AS "accountId", a."number" AS "number", a."label" AS "accountLabel",
             e.id AS "entryId", e."date" AS "date", j."code" AS "journalCode", e."number" AS "entryNumber",
             e."label" AS "entryLabel", e."reference" AS "reference", l."label" AS "lineLabel",
             l."debit"::text AS "debit", l."credit"::text AS "credit"
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e.id = l."entryId"
      JOIN "Journal" j ON j.id = e."journalId"
      JOIN "Account" a ON a.id = l."accountId"
      WHERE e."fiscalYearId" = ${q.fiscalYearId}::uuid
        AND e.status IN ('POSTED', 'REVERSED')
        ${q.from ? Prisma.sql`AND e."date" >= ${asDate(q.from)}` : Prisma.empty}
        ${q.to ? Prisma.sql`AND e."date" <= ${asDate(q.to)}` : Prisma.empty}
        ${q.accountId ? Prisma.sql`AND a.id = ${q.accountId}::uuid` : Prisma.empty}
        ${q.prefix ? Prisma.sql`AND a."number" LIKE ${`${q.prefix}%`}` : Prisma.empty}
      ORDER BY a."number", e."date", j."code", e."number", l."position"
      LIMIT ${MAX_LEDGER_LINES + 1}`);
    if (rows.length > MAX_LEDGER_LINES) {
      throw new ReportTooLargeError(
        `Plus de ${MAX_LEDGER_LINES} lignes : choisissez un compte, une classe de comptes ou une période plus courte.`,
      );
    }

    const accounts: LedgerAccount[] = [];
    let current: { account: LedgerAccount; debit: Money; credit: Money } | null = null;
    for (const row of rows) {
      if (!current || current.account.accountId !== row.accountId) {
        if (current) this.closeAccount(current);
        current = {
          account: { accountId: row.accountId, number: row.number, label: row.accountLabel, totalDebit: "0.00", totalCredit: "0.00", balance: "0.00", lines: [] },
          debit: Money.zero(),
          credit: Money.zero(),
        };
        accounts.push(current.account);
      }
      current.debit = current.debit.add(amount(row.debit));
      current.credit = current.credit.add(amount(row.credit));
      current.account.lines.push({
        date: day(row.date),
        journalCode: row.journalCode,
        entryId: row.entryId,
        entryNumber: row.entryNumber,
        entryLabel: row.entryLabel,
        reference: row.reference,
        lineLabel: row.lineLabel,
        debit: row.debit,
        credit: row.credit,
        balance: current.debit.subtract(current.credit).toString(),
      });
    }
    if (current) this.closeAccount(current);
    return { accounts };
  }

  async trialBalance(query: unknown): Promise<TrialBalance> {
    const q = parse(balanceQuery, query);
    await this.assertYear(q.fiscalYearId);

    const rows = await this.prisma.$queryRaw<
      { accountId: string; number: string; label: string; debit: string; credit: string }[]
    >(Prisma.sql`
      SELECT a.id AS "accountId", a."number" AS "number", a."label" AS "label",
             sum(l."debit")::text AS "debit", sum(l."credit")::text AS "credit"
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e.id = l."entryId"
      JOIN "Account" a ON a.id = l."accountId"
      WHERE e."fiscalYearId" = ${q.fiscalYearId}::uuid
        AND e.status IN ('POSTED', 'REVERSED')
        ${q.from ? Prisma.sql`AND e."date" >= ${asDate(q.from)}` : Prisma.empty}
        ${q.to ? Prisma.sql`AND e."date" <= ${asDate(q.to)}` : Prisma.empty}
        ${q.prefix ? Prisma.sql`AND a."number" LIKE ${`${q.prefix}%`}` : Prisma.empty}
      GROUP BY a.id, a."number", a."label"
      ORDER BY a."number"`);

    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    let totalDebitBalance = Money.zero();
    let totalCreditBalance = Money.zero();
    const result: TrialBalanceRow[] = rows.map((row) => {
      const debit = amount(row.debit);
      const credit = amount(row.credit);
      const net = debit.subtract(credit);
      const debitBalance = net.isPositive() ? net : Money.zero();
      const creditBalance = net.isNegative() ? Money.zero().subtract(net) : Money.zero();
      totalDebit = totalDebit.add(debit);
      totalCredit = totalCredit.add(credit);
      totalDebitBalance = totalDebitBalance.add(debitBalance);
      totalCreditBalance = totalCreditBalance.add(creditBalance);
      return {
        accountId: row.accountId,
        number: row.number,
        label: row.label,
        debit: debit.toString(),
        credit: credit.toString(),
        debitBalance: debitBalance.toString(),
        creditBalance: creditBalance.toString(),
      };
    });
    return {
      rows: result,
      totals: {
        debit: totalDebit.toString(),
        credit: totalCredit.toString(),
        debitBalance: totalDebitBalance.toString(),
        creditBalance: totalCreditBalance.toString(),
      },
      balanced: totalDebit.equals(totalCredit) && totalDebitBalance.equals(totalCreditBalance),
    };
  }

  async journalBook(query: unknown): Promise<{ entries: JournalBookEntry[] }> {
    const q = parse(journalQuery, query);
    await this.assertYear(q.fiscalYearId);

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        fiscalYearId: q.fiscalYearId,
        status: { in: ["POSTED", "REVERSED"] },
        ...(q.journalId && { journalId: q.journalId }),
        ...((q.from || q.to) && {
          date: { ...(q.from && { gte: asDate(q.from) }), ...(q.to && { lte: asDate(q.to) }) },
        }),
      },
      include: {
        journal: { select: { code: true } },
        lines: { orderBy: { position: "asc" }, include: { account: { select: { number: true, label: true } } } },
      },
      orderBy: [{ journal: { code: "asc" } }, { number: "asc" }],
      take: MAX_JOURNAL_ENTRIES + 1,
    });
    if (entries.length > MAX_JOURNAL_ENTRIES) {
      throw new ReportTooLargeError(
        `Plus de ${MAX_JOURNAL_ENTRIES} écritures : choisissez un journal ou une période plus courte.`,
      );
    }

    return {
      entries: entries.map((entry) => {
        let debit = Money.zero();
        let credit = Money.zero();
        for (const line of entry.lines) {
          debit = debit.add(amount(line.debit.toFixed(2)));
          credit = credit.add(amount(line.credit.toFixed(2)));
        }
        return {
          id: entry.id,
          date: day(entry.date),
          journalCode: entry.journal.code,
          number: entry.number!,
          label: entry.label,
          reference: entry.reference,
          kind: entry.kind,
          status: entry.status,
          lines: entry.lines.map((line) => ({
            accountNumber: line.account.number,
            accountLabel: line.account.label,
            label: line.label,
            debit: line.debit.toFixed(2),
            credit: line.credit.toFixed(2),
          })),
          totalDebit: debit.toString(),
          totalCredit: credit.toString(),
        };
      }),
    };
  }

  private closeAccount(current: { account: LedgerAccount; debit: Money; credit: Money }): void {
    current.account.totalDebit = current.debit.toString();
    current.account.totalCredit = current.credit.toString();
    current.account.balance = current.debit.subtract(current.credit).toString();
  }

  private async assertYear(id: string): Promise<void> {
    if (!(await this.prisma.fiscalYear.findUnique({ where: { id }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Exercice");
    }
  }
}
