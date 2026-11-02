import { amountCell, type CsvCell } from "./csv.js";
import type { JournalBookEntry, LedgerAccount, TrialBalance } from "./reports.service.js";
import type { BalanceSheet, ComparedGroup, IncomeStatement, TreasuryStatement } from "./statements.service.js";

/** Lignes CSV des états (ADR 0021) : mêmes chiffres que l'écran, rien de recalculé. */

const money = (value: string | null | undefined): CsvCell => (value == null ? "" : amountCell(value));

function groupRows(groups: ComparedGroup[], withPrevious: boolean): CsvCell[][] {
  const rows: CsvCell[][] = [];
  for (const group of groups) {
    rows.push([group.label, "", money(null), ...(withPrevious ? [money(null)] : [])].slice(0, withPrevious ? 4 : 3));
    for (const row of group.rows) rows.push(["", row.label, money(row.amount), ...(withPrevious ? [money(row.previous)] : [])]);
    rows.push(["", `Total — ${group.label}`, money(group.total), ...(withPrevious ? [money(group.previousTotal)] : [])]);
  }
  return rows;
}

export function incomeStatementCsv(statement: IncomeStatement): CsvCell[][] {
  const withPrevious = statement.previous !== null;
  return [
    ["Compte de résultat", statement.fiscalYear.label, `du ${statement.fiscalYear.start} au ${statement.fiscalYear.end}`],
    ["Groupe", "Rubrique", statement.fiscalYear.label, ...(withPrevious ? [statement.previous!.label] : [])],
    ...groupRows(statement.sections, withPrevious),
    ...statement.intermediate.map((line): CsvCell[] => ["", line.label, money(line.amount), ...(withPrevious ? [money(line.previous)] : [])]),
    ["", "Résultat de l'exercice", money(statement.result), ...(withPrevious ? [money(statement.previousResult)] : [])],
  ];
}

export function balanceSheetCsv(sheet: BalanceSheet): CsvCell[][] {
  const withPrevious = sheet.previous !== null;
  const head: CsvCell[] = ["Groupe", "Rubrique", sheet.fiscalYear.label, ...(withPrevious ? [sheet.previous!.label] : [])];
  return [
    ["Bilan", sheet.fiscalYear.label, `au ${sheet.fiscalYear.end}`],
    ["ACTIF"],
    head,
    ...groupRows(sheet.assets, withPrevious),
    ["", "Total de l'actif", money(sheet.totalAssets), ...(withPrevious ? [money(sheet.previousTotalAssets)] : [])],
    ["PASSIF"],
    head,
    ...groupRows(sheet.liabilities, withPrevious),
    ["", "Total du passif", money(sheet.totalLiabilities), ...(withPrevious ? [money(sheet.previousTotalLiabilities)] : [])],
  ];
}

export function treasuryStatementCsv(statement: TreasuryStatement): CsvCell[][] {
  const withPrevious = statement.previous !== null;
  const head: CsvCell[] = ["Compte", "Libellé", "Compte financier", "Solde de départ", "Encaissements", "Décaissements", "Solde de clôture", ...(withPrevious ? ["Clôture précédente"] : [])];
  return [
    ["État de trésorerie", statement.fiscalYear.label, `du ${statement.fiscalYear.start} au ${statement.fiscalYear.end}`],
    head,
    ...statement.rows.map((row): CsvCell[] => [
      row.number,
      row.label,
      row.financialAccountName ?? "",
      money(row.opening),
      money(row.receipts),
      money(row.payments),
      money(row.closing),
      ...(withPrevious ? [money(row.previous?.closing)] : []),
    ]),
    ["Total", "", "", money(statement.totals.opening), money(statement.totals.receipts), money(statement.totals.payments), money(statement.totals.closing), ...(withPrevious ? [money(statement.previousTotals?.closing)] : [])],
  ];
}

export function trialBalanceCsv(balance: TrialBalance): CsvCell[][] {
  return [
    ["Compte", "Libellé", "Débit", "Crédit", "Solde débiteur", "Solde créditeur"],
    ...balance.rows.map((r): CsvCell[] => [r.number, r.label, money(r.debit), money(r.credit), money(r.debitBalance), money(r.creditBalance)]),
    ["Total", "", money(balance.totals.debit), money(balance.totals.credit), money(balance.totals.debitBalance), money(balance.totals.creditBalance)],
  ];
}

export function ledgerCsv(ledger: { accounts: LedgerAccount[] }): CsvCell[][] {
  const rows: CsvCell[][] = [["Compte", "Libellé du compte", "Date", "Journal", "N° d'écriture", "Libellé", "Référence", "Libellé de ligne", "Débit", "Crédit", "Solde cumulé"]];
  for (const account of ledger.accounts) {
    for (const line of account.lines) {
      rows.push([account.number, account.label, line.date, line.journalCode, line.entryNumber, line.entryLabel, line.reference ?? "", line.lineLabel ?? "", money(line.debit), money(line.credit), money(line.balance)]);
    }
    rows.push([account.number, `Total ${account.label}`, "", "", "", "", "", "", money(account.totalDebit), money(account.totalCredit), money(account.balance)]);
  }
  return rows;
}

export function journalBookCsv(book: { entries: JournalBookEntry[] }): CsvCell[][] {
  const rows: CsvCell[][] = [["Date", "Journal", "N°", "Libellé", "Référence", "État", "Compte", "Libellé du compte", "Libellé de ligne", "Débit", "Crédit"]];
  for (const entry of book.entries) {
    for (const line of entry.lines) {
      rows.push([entry.date, entry.journalCode, entry.number, entry.label, entry.reference ?? "", entry.status, line.accountNumber, line.accountLabel, line.label ?? "", money(line.debit), money(line.credit)]);
    }
  }
  return rows;
}
