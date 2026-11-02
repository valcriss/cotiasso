import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { EntriesService } from "../accounting/entries.service.js";
import { AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { countBankEntriesWithoutTransaction } from "./bank-entries.js";
import {
  isComplete,
  percent,
  stageAnomalies,
  type AccountCounts,
  type Anomaly,
  type BlockedDraft,
} from "./recovery-progress.js";

const query = z.object({ fiscalYearId: z.uuid().optional() }).strict();

/** Brouillons examinés au plus : la reprise vise moins de 1 000 opérations ; au-delà on le dit au lieu de ralentir. */
const DRAFT_ANALYSIS_LIMIT = 300;
const DETAIL_LIMIT = 20;

export type OpeningState = "NOT_NEEDED" | "TO_PREPARE" | "DRAFT" | "POSTED" | "REVERSED";

export interface AccountProgress extends AccountCounts {
  financialAccountId: string;
  name: string;
  /** Part de mouvements comptabilisés ; absente s'il n'y a aucun mouvement. */
  percent: number | null;
  /** État du solde d'ouverture, pour l'exercice qui contient l'ouverture du compte seulement. */
  opening: { state: OpeningState; amount: string } | null;
  statementUntil: string | null;
  reconciledUntil: string | null;
  blockedDrafts: number;
}

export interface YearProgress {
  fiscalYear: { id: string; label: string; start: string; end: string; status: "OPEN" | "CLOSING" | "CLOSED" };
  accounts: AccountProgress[];
  totals: AccountCounts & { percent: number | null };
  documents: { postedEntries: number; withoutDocument: number };
  anomalies: Anomaly[];
  /** Plus rien à faire ni à vérifier (les informations ne comptent pas) et au moins un mouvement. */
  complete: boolean;
  /** Vrai si l'analyse des brouillons a été limitée (reprise très volumineuse). */
  draftAnalysisLimited: boolean;
}

export interface ProgressReport {
  generatedAt: string;
  years: YearProgress[];
}

interface CountRow {
  year_id: string;
  account_id: string;
  total: bigint;
  qualified: bigint;
  drafted: bigint;
  posted: bigint;
  reconciled: bigint;
}

interface DraftRow {
  id: string;
  year_id: string;
  account_id: string;
  date: Date;
  label: string;
  mismatch: boolean;
}

interface DocumentRow {
  year_id: string;
  posted: bigint;
  missing: bigint;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Tableau de progression de la reprise (cadrage §20.2, ADR 0027) : pour chaque exercice et chaque compte financier,
 * l'avancement de la chaîne mouvement → qualifié → brouillon → comptabilisé → rapproché, et les anomalies avec l'écran
 * qui les règle. Lecture seule, calculée à la demande : aucune donnée n'est stockée, rien ne peut donc diverger.
 */
@Injectable()
export class RecoveryProgressService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntriesService) private readonly entries: EntriesService,
  ) {}

  async report(rawQuery: unknown, now: Date = new Date()): Promise<ProgressReport> {
    const { fiscalYearId } = parse(query, rawQuery ?? {});
    const years = await this.prisma.fiscalYear.findMany({
      where: fiscalYearId ? { id: fiscalYearId } : {},
      orderBy: { start: "asc" },
    });
    if (fiscalYearId && years.length === 0) throw new AccountingNotFoundError("Exercice");
    if (years.length === 0) return { generatedAt: now.toISOString(), years: [] };

    const yearIds = years.map((y) => y.id);
    const [counts, openings, reconciliations, statements, documents, drafts, situation, untracked] = await Promise.all([
      this.counts(yearIds),
      this.prisma.recoveryBatchItem.findMany({
        where: { kind: "OPENING" },
        select: { financialAccountId: true, entry: { select: { status: true } } },
      }),
      this.prisma.reconciliation.groupBy({ by: ["financialAccountId", "status"], where: { status: { in: ["VALIDATED", "IN_PROGRESS"] } }, _max: { periodEnd: true } }),
      this.prisma.bankStatement.groupBy({ by: ["financialAccountId"], _max: { periodEnd: true } }),
      this.documents(yearIds),
      this.draftDiagnoses(yearIds),
      // Situation d'ouverture (ADR 0029) : une seule écriture reprend les soldes de plusieurs comptes à la fois.
      this.prisma.openingSituation.findFirst({
        where: { entry: { status: { not: "REVERSED" } } },
        select: { entry: { select: { status: true, lines: { select: { accountId: true } } } } },
      }),
      this.untrackedThirdParties(yearIds),
    ]);

    const accounts = await this.prisma.financialAccount.findMany({ orderBy: { name: "asc" } });
    const openingState = new Map(openings.map((o) => [o.financialAccountId, o.entry.status]));
    const validatedUntil = new Map(reconciliations.filter((r) => r.status === "VALIDATED").map((r) => [r.financialAccountId, r._max.periodEnd]));
    const inProgress = new Set(reconciliations.filter((r) => r.status === "IN_PROGRESS").map((r) => r.financialAccountId));
    const statementUntil = new Map(statements.map((s) => [s.financialAccountId, s._max.periodEnd]));
    const countOf = new Map(counts.map((c) => [`${c.year_id}:${c.account_id}`, c]));
    const docOf = new Map(documents.map((d) => [d.year_id, d]));
    const untrackedOf = new Map(untracked.map((u) => [u.year_id, Number(u.lines)]));

    const result: YearProgress[] = [];
    for (const year of years) {
      const anomalies: Anomaly[] = [];
      const rows: AccountProgress[] = [];
      const yearDrafts = drafts.analysed.filter((d) => d.year_id === year.id);

      for (const account of accounts) {
        if (account.openedOn > year.end || (account.archivedOn && account.archivedOn < year.start)) continue;
        const row = countOf.get(`${year.id}:${account.id}`);
        const c: AccountCounts = {
          total: Number(row?.total ?? 0),
          qualified: Number(row?.qualified ?? 0),
          drafted: Number(row?.drafted ?? 0),
          posted: Number(row?.posted ?? 0),
          reconciled: Number(row?.reconciled ?? 0),
        };

        const blocked: BlockedDraft[] = yearDrafts
          .filter((d) => d.account_id === account.id && d.problems.length > 0)
          .map((d) => ({ entryId: d.id, date: day(d.date), label: d.label, messages: d.problems }));
        anomalies.push(...stageAnomalies({ id: account.id, name: account.name }, c, blocked.length));
        if (blocked.length > 0) {
          anomalies.push({
            code: "BLOCKED_DRAFT",
            level: "BLOCKING",
            financialAccountId: account.id,
            financialAccountName: account.name,
            count: blocked.length,
            fix: "ENTRY",
            message: `${blocked.length} brouillon${blocked.length > 1 ? "s ne peuvent" : " ne peut"} pas être comptabilisé${blocked.length > 1 ? "s" : ""} en l'état : ouvrez-le${blocked.length > 1 ? "s" : ""} pour lire la raison et le corriger.`,
            details: blocked.slice(0, DETAIL_LIMIT),
          });
        }

        // Solde d'ouverture : seulement dans l'exercice qui contient l'ouverture du compte.
        let opening: AccountProgress["opening"] = null;
        if (account.openedOn >= year.start && account.openedOn <= year.end) {
          const amount = account.openingBalance.toFixed(2);
          const entryStatus = situation?.entry.lines.some((l) => l.accountId === account.accountId) ? situation.entry.status : openingState.get(account.id);
          const state: OpeningState = account.openingBalance.isZero() ? "NOT_NEEDED" : entryStatus === "POSTED" ? "POSTED" : entryStatus === "DRAFT" ? "DRAFT" : entryStatus === "REVERSED" ? "REVERSED" : "TO_PREPARE";
          opening = { state, amount };
          const base = { financialAccountId: account.id, financialAccountName: account.name, count: 1 };
          if (state === "TO_PREPARE") {
            anomalies.push({ ...base, code: "OPENING_MISSING", level: "TODO", fix: "RECOVERY", message: `Le solde d'ouverture de « ${account.name} » (${amount} €) n'est pas encore expliqué : indiquez d'où vient cet argent (fonds associatifs, report à nouveau…).` });
          } else if (state === "DRAFT") {
            anomalies.push({ ...base, code: "OPENING_DRAFT", level: "TODO", fix: "RECOVERY", message: `L'écriture du solde d'ouverture de « ${account.name} » est préparée mais pas comptabilisée.` });
          } else if (state === "REVERSED") {
            anomalies.push({ ...base, code: "OPENING_REVERSED", level: "WARNING", fix: "ENTRY", message: `L'écriture du solde d'ouverture de « ${account.name} » a été contrepassée : saisissez-en une nouvelle à la main si le solde doit être repris.` });
          }
        }

        // Contrôle bancaire : seulement pour un exercice terminé (un exercice en cours n'a pas encore de relevé de fin).
        const ended = year.end < now;
        const statementEnd = statementUntil.get(account.id) ?? null;
        const reconciledEnd = validatedUntil.get(account.id) ?? null;
        const active = c.total > 0 || opening !== null;
        if (ended && active) {
          const base = { financialAccountId: account.id, financialAccountName: account.name, count: 1, fix: "RECONCILIATION" as const };
          if (!statementEnd || statementEnd < year.end) {
            anomalies.push({ ...base, code: "NO_STATEMENT", level: "TODO", message: `Aucun solde de relevé n'est enregistré à la fin de l'exercice pour « ${account.name} » : saisissez le solde du relevé du ${day(year.end)} pour pouvoir contrôler le compte.` });
          } else if (!reconciledEnd || reconciledEnd < year.end) {
            anomalies.push({ ...base, code: "NOT_RECONCILED", level: "TODO", message: `« ${account.name} » n'est pas rapproché jusqu'au ${day(year.end)}${inProgress.has(account.id) ? " (un rapprochement est en cours : terminez-le)" : " : comparez-le à son relevé"}.` });
          }
        }
        const orphans = await countBankEntriesWithoutTransaction(this.prisma, {
          financialAccountId: account.id,
          accountId: account.accountId,
          after: new Date(year.start.getTime() - 86_400_000),
          upTo: year.end,
        });
        if (orphans > 0) {
          anomalies.push({
            code: "ENTRIES_WITHOUT_TRANSACTION",
            level: "WARNING",
            financialAccountId: account.id,
            financialAccountName: account.name,
            count: orphans,
            fix: "TRANSACTIONS",
            message: `${orphans} écriture${orphans > 1 ? "s" : ""} comptabilisée${orphans > 1 ? "s" : ""} touche${orphans > 1 ? "nt" : ""} « ${account.name} » sans mouvement bancaire associé (frais saisis directement, écriture à la main…) : vérifiez-${orphans > 1 ? "les" : "la"}.`,
          });
        }

        rows.push({
          financialAccountId: account.id,
          name: account.name,
          ...c,
          percent: percent(c.posted, c.total),
          opening,
          statementUntil: statementEnd ? day(statementEnd) : null,
          reconciledUntil: reconciledEnd ? day(reconciledEnd) : null,
          blockedDrafts: blocked.length,
        });
      }

      const doc = docOf.get(year.id);
      const postedEntries = Number(doc?.posted ?? 0);
      const withoutDocument = Number(doc?.missing ?? 0);
      if (withoutDocument > 0) {
        anomalies.push({
          code: "MISSING_DOCUMENTS",
          level: "INFO",
          financialAccountId: null,
          financialAccountName: null,
          count: withoutDocument,
          fix: "DOCUMENTS",
          message: `${withoutDocument} écriture${withoutDocument > 1 ? "s" : ""} comptabilisée${withoutDocument > 1 ? "s" : ""} sur ${postedEntries} n'${withoutDocument > 1 ? "ont" : "a"} aucune pièce jointe (facture, reçu, relevé). Ce n'est pas bloquant : rattachez les justificatifs disponibles depuis la page Documents.`,
        });
      }

      const missingParty = untrackedOf.get(year.id) ?? 0;
      if (missingParty > 0) {
        anomalies.push({
          code: "THIRD_PARTY_MISSING",
          level: "WARNING",
          financialAccountId: null,
          financialAccountName: null,
          count: missingParty,
          fix: "THIRD_PARTIES",
          message: `${missingParty} ligne${missingParty > 1 ? "s" : ""} d'écriture sur des comptes de tiers (sommes à recevoir ou à payer) n'${missingParty > 1 ? "ont" : "a"} pas de tiers indiqué. Ce n'est pas bloquant : indiquez qui est concerné si vous voulez suivre ces sommes par personne.`,
        });
      }

      const sum = (key: keyof AccountCounts) => rows.reduce((acc, r) => acc + r[key], 0);
      const totals = { total: sum("total"), qualified: sum("qualified"), drafted: sum("drafted"), posted: sum("posted"), reconciled: sum("reconciled") };
      result.push({
        fiscalYear: { id: year.id, label: year.label, start: day(year.start), end: day(year.end), status: year.status },
        accounts: rows,
        totals: { ...totals, percent: percent(totals.posted, totals.total) },
        documents: { postedEntries, withoutDocument },
        anomalies,
        complete: rows.length > 0 && totals.total > 0 && isComplete(anomalies),
        draftAnalysisLimited: drafts.limited,
      });
    }
    return { generatedAt: now.toISOString(), years: result };
  }

  /** Compteurs par exercice et par compte financier, en une seule requête. */
  private counts(yearIds: string[]): Promise<CountRow[]> {
    return this.prisma.$queryRaw<CountRow[]>`
      SELECT f."id" AS year_id, a."id" AS account_id,
        count(t."id") AS total,
        count(t."id") FILTER (WHERE t."counterpartAccountId" IS NOT NULL
          OR EXISTS (SELECT 1 FROM "Transfer" tr WHERE tr."outTransactionId" = t."id" OR tr."inTransactionId" = t."id")
          OR EXISTS (SELECT 1 FROM "TreasuryMatch" m WHERE m."transactionId" = t."id" AND m."status" = 'ACTIVE')) AS qualified,
        count(t."id") FILTER (WHERE EXISTS (SELECT 1 FROM "TreasuryMatch" m WHERE m."transactionId" = t."id" AND m."status" = 'ACTIVE')) AS drafted,
        count(t."id") FILTER (WHERE EXISTS (SELECT 1 FROM "TreasuryMatch" m JOIN "JournalEntry" e ON e."id" = m."entryId"
          WHERE m."transactionId" = t."id" AND m."status" = 'ACTIVE' AND e."status" = 'POSTED')) AS posted,
        count(t."id") FILTER (WHERE r."status" = 'VALIDATED') AS reconciled
      FROM "FiscalYear" f
      JOIN "FinancialAccount" a ON a."openedOn" <= f."end" AND (a."archivedOn" IS NULL OR a."archivedOn" >= f."start")
      LEFT JOIN "Transaction" t ON t."financialAccountId" = a."id" AND t."operationDate" BETWEEN f."start" AND f."end"
      LEFT JOIN "Reconciliation" r ON r."id" = t."reconciliationId"
      WHERE f."id" = ANY(${yearIds}::uuid[])
      GROUP BY f."id", a."id"`;
  }

  /** Écritures comptabilisées de chaque exercice, et celles sans aucune pièce jointe (écriture ou mouvement lié). */
  private documents(yearIds: string[]): Promise<DocumentRow[]> {
    return this.prisma.$queryRaw<DocumentRow[]>`
      SELECT e."fiscalYearId" AS year_id, count(*) AS posted,
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM "DocumentLink" dl JOIN "Document" d ON d."id" = dl."documentId"
          WHERE d."archivedAt" IS NULL AND (
            (dl."objectType" = 'journal-entry' AND dl."objectId" = e."id"::text)
            OR (dl."objectType" = 'transaction' AND dl."objectId" IN (SELECT m2."transactionId"::text FROM "TreasuryMatch" m2 WHERE m2."entryId" = e."id"))))) AS missing
      FROM "JournalEntry" e JOIN "Journal" j ON j."id" = e."journalId"
      WHERE e."status" = 'POSTED' AND e."kind" = 'NORMAL' AND e."reversalOfId" IS NULL AND j."type" <> 'OPENING'
        AND e."fiscalYearId" = ANY(${yearIds}::uuid[])
        AND NOT EXISTS (SELECT 1 FROM "TreasuryMatch" m JOIN "Transfer" tr ON tr."outTransactionId" = m."transactionId" OR tr."inTransactionId" = m."transactionId" WHERE m."entryId" = e."id")
      GROUP BY e."fiscalYearId"`;
  }

  /** Lignes d'écritures comptabilisées sur les comptes de tiers (classe 4) sans tiers indiqué, par exercice. */
  private untrackedThirdParties(yearIds: string[]): Promise<{ year_id: string; lines: bigint }[]> {
    return this.prisma.$queryRaw<{ year_id: string; lines: bigint }[]>`
      SELECT e."fiscalYearId" AS year_id, count(*) AS lines
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "Account" a ON a."id" = l."accountId"
      WHERE e."status" = 'POSTED' AND l."thirdPartyId" IS NULL AND a."number" LIKE '4%'
        AND e."fiscalYearId" = ANY(${yearIds}::uuid[])
      GROUP BY e."fiscalYearId"`;
  }

  /**
   * Brouillons reliés à un mouvement : pourquoi chacun ne se comptabiliserait pas (mêmes règles que la comptabilisation,
   * plus la cohérence avec la ligne de banque). Rien n'est écrit.
   */
  private async draftDiagnoses(yearIds: string[]): Promise<{ analysed: (DraftRow & { problems: string[] })[]; limited: boolean }> {
    const rows = await this.prisma.$queryRaw<DraftRow[]>`
      SELECT e."id", e."fiscalYearId" AS year_id, m."financialAccountId" AS account_id, e."date", e."label",
        (treasury_entry_net(e."id", m."financialAccountId") <> t."amount") AS mismatch
      FROM "TreasuryMatch" m
      JOIN "JournalEntry" e ON e."id" = m."entryId"
      JOIN "Transaction" t ON t."id" = m."transactionId"
      WHERE m."status" = 'ACTIVE' AND e."status" = 'DRAFT' AND e."fiscalYearId" = ANY(${yearIds}::uuid[])
      ORDER BY e."date", e."id"`;
    const limited = rows.length > DRAFT_ANALYSIS_LIMIT;
    const analysed: (DraftRow & { problems: string[] })[] = [];
    for (const row of rows.slice(0, DRAFT_ANALYSIS_LIMIT)) {
      const problems = await this.entries.postingProblems(row.id);
      if (row.mismatch) problems.push("La ligne de banque de l'écriture ne correspond plus au montant du mouvement : corrigez l'écriture ou dissociez-la du mouvement.");
      analysed.push({ ...row, problems });
    }
    return { analysed, limited };
  }
}
