import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingNotFoundError } from "./errors.js";
import { parse } from "./schemas.js";
import { computeBalance, computeIncome, type AccountNet, type BalanceComputation, type IncomeComputation, type StatementGroup } from "./statements.js";

const query = z.object({ fiscalYearId: z.uuid("Exercice invalide.") }).strict();

export interface YearRef {
  id: string;
  label: string;
  start: string;
  end: string;
  status: string;
}

export interface ComparedRow {
  code: string;
  label: string;
  amount: string;
  /** Montant de l'exercice précédent ; `null` quand il n'y a pas d'exercice précédent (jamais un zéro trompeur). */
  previous: string | null;
}

export interface ComparedGroup {
  code: string;
  label: string;
  help: string;
  rows: ComparedRow[];
  total: string;
  previousTotal: string | null;
}

export interface Comparison {
  fiscalYear: YearRef;
  /** Exercice précédent, ou `null` s'il n'y en a pas : la colonne N−1 est alors absente. */
  previous: YearRef | null;
  /** Brouillons de l'exercice : non pris en compte dans l'état. */
  draftEntries: number;
  /** Avertissement quand l'exercice précédent n'est pas clôturé : ses soldes ne sont pas encore reportés dans cet exercice. */
  carryWarning: string | null;
}

export interface IncomeStatement extends Comparison {
  sections: ComparedGroup[];
  intermediate: { code: string; label: string; amount: string; previous: string | null }[];
  products: string;
  charges: string;
  result: string;
  previousResult: string | null;
  /** Comptes utilisés rangés par défaut selon leur numéro (aucune rubrique choisie). */
  defaulted: { number: string; label: string }[];
  /** Comptes qu'aucune rubrique n'accueille : l'état est incomplet tant qu'ils existent. */
  unclassified: { number: string; label: string; amount: string }[];
}

export interface BalanceSheet extends Comparison {
  assets: ComparedGroup[];
  liabilities: ComparedGroup[];
  totalAssets: string;
  totalLiabilities: string;
  previousTotalAssets: string | null;
  previousTotalLiabilities: string | null;
  difference: string;
  balanced: boolean;
  result: string;
  unclassified: { number: string; label: string; amount: string }[];
}

export interface TreasuryFigures {
  opening: string;
  receipts: string;
  payments: string;
  closing: string;
}

export interface TreasuryRow extends TreasuryFigures {
  number: string;
  label: string;
  /** Nom du compte financier (banque, caisse) lié à ce compte de trésorerie, s'il existe. */
  financialAccountName: string | null;
  /** Chiffres de l'exercice précédent ; `null` sans exercice précédent ou si le compte n'y avait aucun mouvement. */
  previous: TreasuryFigures | null;
}

export interface TreasuryStatement extends Comparison {
  rows: TreasuryRow[];
  totals: TreasuryFigures;
  previousTotals: TreasuryFigures | null;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

function compare(current: StatementGroup[], previous: StatementGroup[] | null): ComparedGroup[] {
  return current.map((group) => {
    const before = previous?.find((g) => g.code === group.code);
    return {
      code: group.code,
      label: group.label,
      help: group.help,
      total: group.total,
      previousTotal: before ? before.total : null,
      rows: group.rows.map((row) => ({ ...row, previous: before?.rows.find((r) => r.code === row.code)?.amount ?? null })),
    };
  });
}

/**
 * Compte de résultat et bilan d'un exercice, avec l'exercice précédent en regard (ADR 0020). Même source de lignes que les
 * états de lecture : écritures comptabilisées ou contrepassées, jamais un brouillon.
 */
@Injectable()
export class StatementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async incomeStatement(params: unknown): Promise<IncomeStatement> {
    const { fiscalYearId } = parse(query, params);
    const { base, year, previous } = await this.context(fiscalYearId);
    const current = computeIncome(await this.nets(year.id));
    const before: IncomeComputation | null = previous ? computeIncome(await this.nets(previous.id)) : null;
    return {
      ...base,
      sections: compare(current.sections, before?.sections ?? null),
      intermediate: current.intermediate.map((line) => ({ ...line, previous: before?.intermediate.find((l) => l.code === line.code)?.amount ?? null })),
      products: current.products,
      charges: current.charges,
      result: current.result,
      previousResult: before?.result ?? null,
      defaulted: current.defaulted,
      unclassified: current.unclassified,
    };
  }

  async balanceSheet(params: unknown): Promise<BalanceSheet> {
    const { fiscalYearId } = parse(query, params);
    const { base, year, previous } = await this.context(fiscalYearId);
    const current: BalanceComputation = computeBalance(await this.nets(year.id));
    const before: BalanceComputation | null = previous ? computeBalance(await this.nets(previous.id)) : null;
    const groups = compare(current.groups, before?.groups ?? null);
    const side = (code: string) => groups.filter((g) => (code === "ASSET" ? isAsset(g.code) : !isAsset(g.code)));
    return {
      ...base,
      assets: side("ASSET"),
      liabilities: side("LIABILITY"),
      totalAssets: current.totalAssets,
      totalLiabilities: current.totalLiabilities,
      previousTotalAssets: before?.totalAssets ?? null,
      previousTotalLiabilities: before?.totalLiabilities ?? null,
      difference: current.difference,
      balanced: current.balanced,
      result: current.result,
      unclassified: current.unclassified,
    };
  }

  /** Trésorerie d'un exercice : départ, encaissements, décaissements et clôture de chaque compte de classe 5 (ADR 0021). */
  async treasuryStatement(params: unknown): Promise<TreasuryStatement> {
    const { fiscalYearId } = parse(query, params);
    const { base, year, previous } = await this.context(fiscalYearId);
    const current = await this.treasuryFigures(year.id);
    const before = previous ? await this.treasuryFigures(previous.id) : null;
    const rows: TreasuryRow[] = current.map((row) => ({ ...row, previous: before ? (before.find((b) => b.number === row.number) ?? null) : null }));
    // Un compte mouvementé seulement l'an dernier figure aussi, avec zéro cette année.
    for (const old of before ?? []) {
      if (!rows.some((r) => r.number === old.number)) {
        const zero = "0.00";
        rows.push({ ...old, opening: zero, receipts: zero, payments: zero, closing: zero, previous: { opening: old.opening, receipts: old.receipts, payments: old.payments, closing: old.closing } });
      }
    }
    rows.sort((a, b) => a.number.localeCompare(b.number));
    const total = (items: TreasuryFigures[]): TreasuryFigures => ({
      opening: sumMoney(items.map((i) => i.opening)),
      receipts: sumMoney(items.map((i) => i.receipts)),
      payments: sumMoney(items.map((i) => i.payments)),
      closing: sumMoney(items.map((i) => i.closing)),
    });
    return {
      ...base,
      rows,
      totals: total(rows),
      previousTotals: before ? total(before) : null,
    };
  }

  private async treasuryFigures(fiscalYearId: string): Promise<Omit<TreasuryRow, "previous">[]> {
    const rows = await this.prisma.$queryRaw<
      { number: string; label: string; name: string | null; opening: string; receipts: string; payments: string }[]
    >`
      SELECT a."number" AS "number", a."label" AS "label", f."name" AS "name",
             COALESCE(sum(l."debit" - l."credit") FILTER (WHERE e."kind" = 'OPENING' OR j."type" = 'OPENING'), 0)::text AS "opening",
             COALESCE(sum(l."debit") FILTER (WHERE e."kind" <> 'OPENING' AND j."type" <> 'OPENING'), 0)::text AS "receipts",
             COALESCE(sum(l."credit") FILTER (WHERE e."kind" <> 'OPENING' AND j."type" <> 'OPENING'), 0)::text AS "payments"
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e.id = l."entryId"
      JOIN "Journal" j ON j.id = e."journalId"
      JOIN "Account" a ON a.id = l."accountId"
      LEFT JOIN "FinancialAccount" f ON f."accountId" = a.id
      WHERE e."fiscalYearId" = ${fiscalYearId}::uuid AND e.status IN ('POSTED', 'REVERSED') AND a."number" LIKE '5%'
      GROUP BY a.id, a."number", a."label", f."name"
      ORDER BY a."number"`;
    return rows.map((row) => {
      const opening = Money.parse(row.opening);
      const receipts = Money.parse(row.receipts);
      const payments = Money.parse(row.payments);
      return {
        number: row.number,
        label: row.label,
        financialAccountName: row.name,
        opening: opening.toString(),
        receipts: receipts.toString(),
        payments: payments.toString(),
        closing: opening.add(receipts).subtract(payments).toString(),
      };
    });
  }

  private async context(fiscalYearId: string) {
    const year = await this.prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
    if (!year) throw new AccountingNotFoundError("Exercice");
    const previous = await this.prisma.fiscalYear.findFirst({ where: { end: { lt: year.start } }, orderBy: { end: "desc" } });
    const draftEntries = await this.prisma.journalEntry.count({ where: { fiscalYearId, status: "DRAFT" } });
    const ref = (y: typeof year): YearRef => ({ id: y.id, label: y.label, start: day(y.start), end: day(y.end), status: y.status });
    const carryWarning =
      previous && previous.status !== "CLOSED"
        ? `L'exercice « ${previous.label} » n'est pas clôturé : ses soldes ne sont pas encore reportés, cet état ne montre que les mouvements de « ${year.label} ».`
        : null;
    return { year, previous, base: { fiscalYear: ref(year), previous: previous ? ref(previous) : null, draftEntries, carryWarning } };
  }

  /** Débit moins crédit de chaque compte sur les écritures comptabilisées ou contrepassées de l'exercice. */
  private async nets(fiscalYearId: string): Promise<AccountNet[]> {
    const rows = await this.prisma.$queryRaw<{ number: string; label: string; reportLine: string | null; net: string }[]>`
      SELECT a."number" AS "number", a."label" AS "label", a."reportLine" AS "reportLine", (sum(l."debit") - sum(l."credit"))::text AS "net"
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e.id = l."entryId"
      JOIN "Account" a ON a.id = l."accountId"
      WHERE e."fiscalYearId" = ${fiscalYearId}::uuid AND e.status IN ('POSTED', 'REVERSED')
      GROUP BY a.id, a."number", a."label", a."reportLine"
      ORDER BY a."number"`;
    return rows.map((row) => ({ number: row.number, label: row.label, reportLine: row.reportLine, net: Money.parse(row.net) }));
  }
}

const sumMoney = (values: string[]) => values.reduce((total, value) => total.add(Money.parse(value)), Money.zero()).toString();

const ASSET_GROUPS = new Set(["FIXED_ASSETS", "CURRENT_ASSETS", "CASH", "ASSET_ADJUSTMENTS"]);
const isAsset = (code: string) => ASSET_GROUPS.has(code);
