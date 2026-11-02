import { amountCell, type CsvCell } from "../accounting/csv.js";
import type { GrantReport } from "./grant-expenses.service.js";

const money = (value: string | null): CsvCell => (value === null ? "" : amountCell(value));

/** Lignes CSV du compte rendu d'une subvention (ADR 0021 : texte neutralisé, montants exacts). Mêmes chiffres que l'écran. */
export function grantReportCsv(report: GrantReport): CsvCell[][] {
  const period = report.period.from || report.period.to ? `du ${report.period.from ?? "…"} au ${report.period.to ?? "…"}` : "toute la durée";
  return [
    ["Compte rendu de subvention", report.grant.title, report.grant.funder, report.grant.reference ?? ""],
    ["Période du compte rendu", period],
    ["Période financée", report.grant.periodStart || report.grant.periodEnd ? `du ${report.grant.periodStart ?? "…"} au ${report.grant.periodEnd ?? "…"}` : "non précisée"],
    ["Montant accordé", money(report.granted)],
    [],
    ["Dépenses affectées par poste"],
    ["Compte", "Poste", "Nombre de dépenses", "Montant"],
    ...report.groups.map((g): CsvCell[] => [g.accountNumber, g.accountLabel, g.count, money(g.amount)]),
    ["Total des dépenses affectées", "", "", money(report.spent)],
    [],
    ["Versements reçus"],
    ["Date de l'encaissement", "Montant"],
    ...report.payments.map((p): CsvCell[] => [p.operationDate, money(p.amount)]),
    ["Total reçu", money(report.received)],
    [],
    ["Reliquat (reçu − dépenses affectées)", money(report.residual)],
    ...report.coFinancingReasons.map((reason): CsvCell[] => ["Cofinancement", reason]),
    ...report.warnings.map((warning): CsvCell[] => ["Avertissement", warning]),
  ];
}
