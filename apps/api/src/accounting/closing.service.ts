import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { FrozenReportsService } from "./frozen-reports.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import { parse } from "./schemas.js";

export type ClosingCheckLevel = "BLOCKING" | "WARNING";

export interface ClosingCheck {
  code: string;
  level: ClosingCheckLevel;
  message: string;
}

export interface CarryPreview {
  /** Nombre de comptes de bilan (classes 1 à 5) à reporter. */
  accountCount: number;
  /** Résultat de l'exercice : produits (classe 7) moins charges (classe 6). */
  result: { kind: "SURPLUS" | "DEFICIT" | "BALANCED"; amount: string };
}

export interface ClosingReport {
  fiscalYearId: string;
  status: "OPEN" | "CLOSING" | "CLOSED";
  checks: ClosingCheck[];
  canStart: boolean;
  canClose: boolean;
  preview: CarryPreview | null;
  /** Rapports figés automatiquement par cette action (ADR 0031) ; `error` si le figement a échoué (à refaire à la main). */
  frozen?: FrozenOutcome;
}

export type FrozenOutcome = { number: number; provisional: boolean } | { error: string };

const closeInput = z
  .object({ surplusAccountId: z.uuid().nullish(), deficitAccountId: z.uuid().nullish() })
  .strict();

type Db = Prisma.TransactionClient;

interface Balance {
  accountId: string;
  number: string;
  /** Tiers du solde reporté (ADR 0030) : une ligne d'à-nouveaux par compte et par tiers, afin de garder le suivi par personne. */
  thirdPartyId: string | null;
  net: Money;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const nextDay = (date: Date) => new Date(date.getTime() + 86_400_000);

/**
 * Clôture d'un exercice : fermeture à la saisie (`CLOSING`), puis clôture définitive qui génère, dans l'exercice qui
 * suit, l'écriture d'à-nouveaux (soldes des classes 1 à 5 et résultat). Les ajustements se saisissent avant la
 * fermeture. Les garanties (un seul report, exercices clôturés dans l'ordre, pas de brouillon, report comptabilisé)
 * sont en base ; ce service produit les contrôles lisibles et enchaîne les étapes dans une transaction.
 */
@Injectable()
export class ClosingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FrozenReportsService) private readonly frozen: FrozenReportsService,
  ) {}

  async report(id: string): Promise<ClosingReport> {
    const year = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!year) throw new AccountingNotFoundError("Exercice");
    const checks = year.status === "CLOSED" ? [] : await this.checks(this.prisma, id);
    const blocking = checks.some((check) => check.level === "BLOCKING");
    let preview: CarryPreview | null = null;
    if (year.status !== "CLOSED") {
      const carry = await this.carry(this.prisma, id);
      preview = { accountCount: new Set(carry.balances.map((b) => b.accountId)).size, result: carry.result };
    }
    return {
      fiscalYearId: id,
      status: year.status,
      checks,
      canStart: year.status === "OPEN" && !blocking,
      canClose: year.status === "CLOSING" && !blocking,
      preview,
    };
  }

  /** Ferme l'exercice à la saisie : plus aucune comptabilisation, en attendant la clôture définitive ou l'annulation. */
  async startClosing(id: string, actorId: string): Promise<ClosingReport> {
    const year = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!year) throw new AccountingNotFoundError("Exercice");
    if (year.status !== "OPEN") throw new AccountingConflictError("Seul un exercice ouvert peut être fermé à la saisie.");
    this.assertNoBlocking(await this.checks(this.prisma, id));

    const changed = await this.prisma.fiscalYear.updateMany({ where: { id, status: "OPEN" }, data: { status: "CLOSING" } });
    if (changed.count !== 1) throw new AccountingConflictError("L'état de l'exercice a changé entre-temps. Actualisez.");
    await this.audit.record({ action: "fiscal-year.closing-started", objectType: "FiscalYear", objectId: id, actorId });
    // Arrêté provisoire : plus aucune comptabilisation n'est possible, les rapports figés sont donc ceux de l'exercice fermé.
    const frozen = await this.frozen.freezeAutomatically(id, "CLOSING", actorId);
    return { ...(await this.report(id)), frozen };
  }

  /** Rouvre à la saisie un exercice fermé mais pas encore clôturé. Sans effet sur les écritures. */
  async cancelClosing(id: string, actorId: string): Promise<ClosingReport> {
    const year = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!year) throw new AccountingNotFoundError("Exercice");
    if (year.status !== "CLOSING") {
      throw new AccountingConflictError(
        year.status === "CLOSED" ? "Un exercice clôturé ne se rouvre pas." : "Cet exercice n'est pas en cours de clôture.",
      );
    }
    const changed = await this.prisma.fiscalYear.updateMany({ where: { id, status: "CLOSING" }, data: { status: "OPEN" } });
    if (changed.count !== 1) throw new AccountingConflictError("L'état de l'exercice a changé entre-temps. Actualisez.");
    await this.audit.record({ action: "fiscal-year.closing-cancelled", objectType: "FiscalYear", objectId: id, actorId });
    return this.report(id);
  }

  /**
   * Clôture définitivement : génère et comptabilise les à-nouveaux de l'exercice suivant puis passe l'exercice à
   * « clôturé », dans une seule transaction. Au moindre refus, rien n'est écrit.
   */
  async close(id: string, body: unknown, actorId: string): Promise<{ openingEntryId: string; result: CarryPreview["result"]; frozen: FrozenOutcome }> {
    const input = parse(closeInput, body ?? {});

    const done = await this.prisma.$transaction(async (tx) => {
      // Verrou exclusif : plus aucune autre transaction ne modifie l'exercice pendant la clôture.
      await tx.$queryRaw`SELECT id FROM "FiscalYear" WHERE id = ${id}::uuid FOR UPDATE`;
      const year = await tx.fiscalYear.findUnique({ where: { id } });
      if (!year) throw new AccountingNotFoundError("Exercice");
      if (year.status !== "CLOSING") {
        throw new AccountingConflictError("Fermez d'abord l'exercice à la saisie avant de le clôturer.");
      }
      this.assertNoBlocking(await this.checks(tx, id));

      const next = await tx.fiscalYear.findFirstOrThrow({ where: { start: nextDay(year.end) } });
      const journal = await tx.journal.findFirstOrThrow({
        where: { type: "OPENING", active: true },
        orderBy: { code: "asc" },
      });

      const carry = await this.carry(tx, id);
      const lines = await this.openingLines(tx, carry, input);
      if (lines.length < 2) {
        throw new AccountingConflictError("Aucun solde à reporter : l'exercice ne contient aucune écriture comptabilisée.");
      }

      const opening = await tx.journalEntry.create({
        data: {
          fiscalYearId: next.id,
          journalId: journal.id,
          date: next.start,
          label: `À-nouveaux de l'exercice ${year.label}`,
          kind: "OPENING",
          carriesFromId: id,
          createdBy: actorId,
          lines: { create: lines.map((line, index) => ({ position: index + 1, ...line })) },
        },
        select: { id: true },
      });
      await tx.journalEntry.update({ where: { id: opening.id }, data: { status: "POSTED", postedBy: actorId } });
      await tx.fiscalYear.update({ where: { id }, data: { status: "CLOSED", closedBy: actorId } });
      return { openingEntryId: opening.id, result: carry.result };
    }).catch((error) => this.rethrow(error));

    await this.audit.record({
      action: "fiscal-year.closed",
      objectType: "FiscalYear",
      objectId: id,
      actorId,
      details: { openingEntryId: done.openingEntryId, result: done.result.kind },
    });
    // Comptes définitifs de l'exercice clôturé, avec l'exercice précédent en regard.
    const frozen = await this.frozen.freezeAutomatically(id, "CLOSED", actorId);
    return { ...done, frozen };
  }

  // --- Contrôles ---

  private async checks(db: Pick<Db, "fiscalYear" | "journalEntry" | "journal" | "$queryRaw">, id: string): Promise<ClosingCheck[]> {
    const year = await db.fiscalYear.findUniqueOrThrow({ where: { id } });
    const checks: ClosingCheck[] = [];
    const blocking = (code: string, message: string) => checks.push({ code, level: "BLOCKING", message });

    const drafts = await db.journalEntry.count({ where: { fiscalYearId: id, status: "DRAFT" } });
    if (drafts > 0) blocking("DRAFTS_REMAIN", `${drafts} brouillon(s) à comptabiliser ou supprimer.`);

    const earlier = await db.fiscalYear.findFirst({
      where: { start: { lt: year.start }, status: { not: "CLOSED" } },
      orderBy: { start: "asc" },
    });
    if (earlier) blocking("PREVIOUS_NOT_CLOSED", `L'exercice « ${earlier.label} » doit être clôturé avant celui-ci.`);

    const next = await db.fiscalYear.findFirst({ where: { start: nextDay(year.end) } });
    if (!next) {
      blocking("NO_NEXT_YEAR", `Créez l'exercice suivant (il doit débuter le ${day(nextDay(year.end))}) pour y reporter les soldes.`);
    } else if (next.status !== "OPEN") {
      blocking("NEXT_YEAR_NOT_OPEN", `L'exercice suivant « ${next.label} » n'est pas ouvert.`);
    }

    const journal = await db.journal.findFirst({ where: { type: "OPENING", active: true } });
    if (!journal) blocking("NO_OPENING_JOURNAL", "Aucun journal d'à-nouveaux actif pour y comptabiliser le report.");

    const alreadyCarried = await db.journalEntry.count({ where: { carriesFromId: id } });
    if (alreadyCarried > 0) blocking("ALREADY_CARRIED", "Les soldes de cet exercice ont déjà été reportés.");

    const unclassified = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT a.id) AS count
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e.id = l."entryId"
      JOIN "Account" a ON a.id = l."accountId"
      WHERE e."fiscalYearId" = ${id}::uuid AND e.status <> 'DRAFT' AND a."reportLine" IS NULL`;
    const missing = Number(unclassified[0]?.count ?? 0);
    if (missing > 0) {
      checks.push({
        code: "UNCLASSIFIED_ACCOUNTS",
        level: "WARNING",
        message: `${missing} compte(s) utilisé(s) n'ont pas de rubrique choisie : le classement par défaut (selon leur numéro) leur est appliqué dans les états.`,
      });
    }
    const unreconciled = await db.$queryRaw<{ name: string }[]>`
      SELECT f."name" AS name FROM "FinancialAccount" f
      WHERE f."archivedOn" IS NULL AND f."openedOn" <= ${year.end}
        AND NOT EXISTS (SELECT 1 FROM "Reconciliation" r
          WHERE r."financialAccountId" = f."id" AND r."status" = 'VALIDATED' AND r."periodEnd" >= ${year.end})
      ORDER BY f."name"`;
    for (const account of unreconciled) {
      checks.push({
        code: "UNRECONCILED_ACCOUNT",
        level: "WARNING",
        message: `Le compte « ${account.name} » n'est pas rapproché jusqu'au ${day(year.end)} : comparez-le à son relevé (Comptes › Rapprocher) pour être sûr des soldes reportés.`,
      });
    }
    return checks;
  }

  private assertNoBlocking(checks: ClosingCheck[]): void {
    const blocking = checks.filter((check) => check.level === "BLOCKING");
    if (blocking.length > 0) throw new AccountingConflictError(blocking.map((check) => check.message).join(" "));
  }

  // --- Calcul du report ---

  /** Soldes nets (débit − crédit) par compte sur les écritures comptabilisées ou contrepassées de l'exercice. */
  private async carry(db: Pick<Db, "$queryRaw">, id: string): Promise<{ balances: Balance[]; result: CarryPreview["result"]; resultNet: Money }> {
    const rows = await db.$queryRaw<{ accountId: string; number: string; thirdPartyId: string | null; net: string }[]>`
      SELECT a.id AS "accountId", a."number" AS "number", l."thirdPartyId" AS "thirdPartyId", (sum(l."debit") - sum(l."credit"))::text AS net
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e.id = l."entryId"
      JOIN "Account" a ON a.id = l."accountId"
      WHERE e."fiscalYearId" = ${id}::uuid AND e.status IN ('POSTED', 'REVERSED')
      GROUP BY a.id, a."number", l."thirdPartyId"
      ORDER BY a."number", l."thirdPartyId" NULLS FIRST`;

    const balances: Balance[] = [];
    let resultNet = Money.zero();
    for (const row of rows) {
      const net = Money.parse(row.net);
      if ("12345".includes(row.number[0]!)) {
        if (!net.isZero()) balances.push({ accountId: row.accountId, number: row.number, thirdPartyId: row.thirdPartyId, net });
      } else if ("67".includes(row.number[0]!)) {
        resultNet = resultNet.add(net);
      }
    }
    // Net débiteur des classes 6 et 7 = charges en excès = déficit ; net créditeur = excédent.
    const kind = resultNet.isZero() ? "BALANCED" : resultNet.isNegative() ? "SURPLUS" : "DEFICIT";
    const amount = (resultNet.isNegative() ? Money.zero().subtract(resultNet) : resultNet).toString();
    return { balances, result: { kind, amount }, resultNet };
  }

  /** Lignes de l'écriture d'à-nouveaux : un solde par compte de bilan, plus le résultat sur le compte choisi. */
  private async openingLines(
    db: Db,
    carry: Awaited<ReturnType<ClosingService["carry"]>>,
    input: z.infer<typeof closeInput>,
  ): Promise<{ accountId: string; thirdPartyId: string | null; debit: string; credit: string }[]> {
    // Clé « compte|tiers » : un solde par compte et par tiers (le résultat reporté s'ajoute au solde sans tiers du compte choisi).
    const nets = new Map<string, Money>(carry.balances.map((b) => [`${b.accountId}|${b.thirdPartyId ?? ""}`, b.net]));

    if (!carry.resultNet.isZero()) {
      const surplus = carry.result.kind === "SURPLUS";
      const accountId = surplus ? input.surplusAccountId : input.deficitAccountId;
      if (!accountId) {
        throw new AccountingConflictError(
          surplus ? "Choisissez le compte d'excédent pour reporter le résultat." : "Choisissez le compte de déficit pour reporter le résultat.",
        );
      }
      const account = await db.account.findUnique({ where: { id: accountId } });
      if (!account || !account.active) throw new AccountingConflictError("Le compte de résultat choisi est inconnu ou désactivé.");
      if (!"12345".includes(account.number[0]!)) {
        throw new AccountingConflictError("Le résultat se reporte sur un compte de bilan (classes 1 à 5).");
      }
      // Le résultat reporté prend la place des classes 6 et 7 (leur net inversé annule celui des classes 1 à 5) : excédent au crédit, déficit au débit.
      const key = `${accountId}|`;
      nets.set(key, (nets.get(key) ?? Money.zero()).add(carry.resultNet));
    }

    const lines: { accountId: string; thirdPartyId: string | null; debit: string; credit: string }[] = [];
    const ordered = [...nets.entries()].sort(([a], [b]) => a.localeCompare(b));
    let debit = Money.zero();
    let credit = Money.zero();
    for (const [key, net] of ordered) {
      if (net.isZero()) continue;
      const [accountId, party] = key.split("|") as [string, string];
      const thirdPartyId = party === "" ? null : party;
      if (net.isPositive()) {
        lines.push({ accountId, thirdPartyId, debit: net.toString(), credit: "0.00" });
        debit = debit.add(net);
      } else {
        const positive = Money.zero().subtract(net);
        lines.push({ accountId, thirdPartyId, debit: "0.00", credit: positive.toString() });
        credit = credit.add(positive);
      }
    }
    if (!debit.equals(credit)) {
      throw new AccountingConflictError(
        "Les soldes à reporter ne s'équilibrent pas (compte hors des classes 1 à 7 non soldé ?). Aucun report n'a été fait.",
      );
    }
    return lines;
  }

  /** Refus d'un déclencheur SQL traduit en message lisible ; toute autre erreur est relancée telle quelle. */
  private rethrow(error: unknown): never {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
    const text = `${(error as Error)?.message ?? ""}\n${String((error as { cause?: unknown })?.cause ?? "")}`;
    const line = text
      .split("\n")
      .find((candidate) => /Des brouillons subsistent|exercice précédent|à-nouveaux|déjà|Unique constraint|déséquilibrée|désactivé/i.test(candidate));
    if (/P2002|Unique constraint/i.test(text)) throw new AccountingConflictError("Les soldes de cet exercice ont déjà été reportés.");
    if (line) throw new AccountingConflictError(line.replace(/^.*?ERROR:\s*/, "").trim());
    throw error;
  }
}
