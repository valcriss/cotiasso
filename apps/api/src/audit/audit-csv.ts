import type { CsvCell } from "../accounting/csv.js";
import type { AuditExportRow, AuditFilters } from "./audit-query.service.js";

const when = (date: Date): string => date.toISOString();

function criteria(filters: AuditFilters): string {
  const parts = [
    filters.action && `action « ${filters.action} »`,
    filters.objectType && `objet « ${filters.objectType} »`,
    filters.objectId && `identifiant « ${filters.objectId} »`,
    filters.actorId && `acteur ${filters.actorId}`,
    filters.from && `à partir du ${when(filters.from)}`,
    filters.to && `jusqu'au ${when(filters.to)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "aucun (journal complet)";
}

/**
 * Lignes CSV du journal d'audit (ADR 0021 : texte neutralisé contre les formules). Dans l'ordre chronologique, avec l'empreinte de
 * chaque événement et celle du précédent : le fichier peut être comparé au journal par la vérification d'intégrité de
 * l'application. Les détails sont du JSON (jamais de secret : le journal n'en contient pas).
 */
export function auditCsv(rows: AuditExportRow[], filters: AuditFilters, generatedAt: Date): CsvCell[][] {
  return [
    ["Journal d'audit", `exporté le ${when(generatedAt)}`, `${rows.length} événement(s)`],
    ["Filtres appliqués", criteria(filters)],
    [
      "Ce fichier est une copie de contrôle. La chaîne d'empreintes détecte une modification faite en base ; elle ne constitue pas un archivage à valeur probante.",
    ],
    [],
    ["N°", "Date et heure (UTC)", "Acteur", "Email de l'acteur", "Action", "Type d'objet", "Identifiant de l'objet", "Justification", "Détails", "Empreinte", "Empreinte précédente"],
    ...rows.map((row): CsvCell[] => [
      row.seq,
      when(row.occurredAt),
      row.actor?.displayName ?? "",
      row.actor?.email ?? "",
      row.action,
      row.objectType,
      row.objectId ?? "",
      row.justification ?? "",
      row.details === null || row.details === undefined || Object.keys(row.details as object).length === 0 ? "" : JSON.stringify(row.details),
      row.hash ?? "",
      row.previousHash ?? "",
    ]),
  ];
}
