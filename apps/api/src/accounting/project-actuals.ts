import { Money } from "@cotiasso/accounting-domain";
import type { PrismaService } from "../prisma/prisma.service.js";

/** Réalisé d'un projet pour un compte et un exercice : charges (classe 6) ou produits (classe 7), en net. */
export interface ProjectActual {
  fiscalYearId: string;
  fiscalYearLabel: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  kind: "CHARGE" | "PRODUCT";
  /** Charges : débits moins crédits. Produits : crédits moins débits. */
  amount: Money;
}

/**
 * Réalisé comptable d'un projet : les parts ventilées sur lui des lignes de charge et de produit des écritures
 * comptabilisées ou contrepassées (jamais un brouillon). Une contrepassation reprend la ventilation de l'originale dans
 * l'autre sens : les deux s'annulent. **Source unique** de la synthèse et du rapport budgétaire du projet (CA-13).
 */
export async function loadProjectActuals(prisma: PrismaService, projectId: string): Promise<ProjectActual[]> {
  const rows = await prisma.$queryRaw<
    {
      fiscalYearId: string;
      label: string;
      start: Date;
      end: Date;
      accountId: string;
      number: string;
      accountLabel: string;
      class: string;
      side: string;
      total: string;
    }[]
  >`
    SELECT e."fiscalYearId" AS "fiscalYearId", f."label" AS "label", f."start" AS "start", f."end" AS "end",
           a."id" AS "accountId", a."number" AS "number", a."label" AS "accountLabel",
           substr(a."number", 1, 1) AS "class", CASE WHEN l."debit" > 0 THEN 'D' ELSE 'C' END AS "side",
           sum(al."amount")::text AS "total"
    FROM "AnalyticalAllocation" al
    JOIN "JournalLine" l ON l."id" = al."lineId"
    JOIN "JournalEntry" e ON e."id" = l."entryId"
    JOIN "FiscalYear" f ON f."id" = e."fiscalYearId"
    JOIN "Account" a ON a."id" = l."accountId"
    WHERE al."projectId" = ${projectId}::uuid AND e."status" IN ('POSTED', 'REVERSED')
    GROUP BY e."fiscalYearId", f."label", f."start", f."end", a."id", a."number", a."label",
             substr(a."number", 1, 1), CASE WHEN l."debit" > 0 THEN 'D' ELSE 'C' END
    ORDER BY f."start", a."number"`;

  const byKey = new Map<string, ProjectActual>();
  for (const row of rows) {
    if (row.class !== "6" && row.class !== "7") continue;
    const kind = row.class === "6" ? "CHARGE" : "PRODUCT";
    const key = `${row.fiscalYearId}|${row.accountId}`;
    const entry: ProjectActual = byKey.get(key) ?? {
      fiscalYearId: row.fiscalYearId,
      fiscalYearLabel: row.label,
      fiscalYearStart: row.start.toISOString().slice(0, 10),
      fiscalYearEnd: row.end.toISOString().slice(0, 10),
      accountId: row.accountId,
      accountNumber: row.number,
      accountLabel: row.accountLabel,
      kind,
      amount: Money.zero(),
    };
    const total = Money.parse(row.total);
    const increases = kind === "CHARGE" ? row.side === "D" : row.side === "C";
    entry.amount = increases ? entry.amount.add(total) : entry.amount.subtract(total);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}
