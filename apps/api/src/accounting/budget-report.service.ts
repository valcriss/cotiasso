import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ProjectAccess } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { prorate } from "./budget-proration.js";
import { commitmentState } from "./commitments.service.js";
import { AccountingNotFoundError } from "./errors.js";
import { loadProjectActuals } from "./project-actuals.js";
import { assertProjectAccess } from "./project-access.js";
import { parse } from "./schemas.js";

const query = z.object({ fiscalYearId: z.uuid().optional() }).strict();

export interface ReportRow {
  key: string;
  label: string;
  accountNumber: string | null;
  /** Budget prévu ; `null` s'il n'y a pas de budget en vigueur, ou pour un compte absent du budget. */
  budget: string | null;
  /** Engagements non soldés (dépenses seulement). */
  engaged: string | null;
  /** Réalisé comptable ; `null` pour un poste sans compte (son réalisé est dans la ligne « hors budget »). */
  actual: string | null;
  /** Budget − réalisé − engagé non soldé ; `null` quand la comparaison n'a pas de sens pour cette ligne. */
  remaining: string | null;
  outOfBudget: boolean;
  note: string | null;
}

export interface ReportSection {
  rows: ReportRow[];
  total: { budget: string | null; engaged: string | null; actual: string; remaining: string | null };
}

export interface BudgetReport {
  project: { id: string; code: string; name: string };
  scope: { kind: "GLOBAL" | "YEAR"; fiscalYear: { id: string; label: string; start: string; end: string } | null };
  fiscalYears: { id: string; label: string; start: string; end: string }[];
  budget: { id: string; number: number; label: string; approvedAt: string | null } | null;
  /** La formule du « reste disponible » et son périmètre, affichées avec les chiffres (cadrage §14.3). */
  formula: string;
  charges: ReportSection;
  products: ReportSection;
  warnings: string[];
}

type Kind = "CHARGE" | "PRODUCT";

const day = (date: Date) => date.toISOString().slice(0, 10);
const NO_ACCOUNT = "none";

/**
 * Rapport budgétaire d'un projet (ADR 0024, tranche 4.2) : budget en vigueur, engagements non soldés, réalisé comptable et
 * reste disponible, sur toute la vie du projet ou sur un exercice. Le réalisé vient de la **même source** que la synthèse du
 * projet (`loadProjectActuals`, CA-13). Le reste disponible des dépenses = budget − réalisé − engagé non soldé : un
 * engagement soldé ne compte plus (c'est le réalisé qui le remplace), jamais les deux (CA-14).
 */
@Injectable()
export class BudgetReportService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async report(projectId: string, rawQuery: unknown, access?: ProjectAccess): Promise<BudgetReport> {
    assertProjectAccess(projectId, access);
    const q = parse(query, rawQuery);
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, name: true } });
    if (!project) throw new AccountingNotFoundError("Projet");
    const years = (await this.prisma.fiscalYear.findMany({ orderBy: { start: "asc" }, select: { id: true, label: true, start: true, end: true } })).map(
      (y) => ({ id: y.id, label: y.label, start: day(y.start), end: day(y.end) }),
    );
    const year = q.fiscalYearId ? years.find((y) => y.id === q.fiscalYearId) : undefined;
    if (q.fiscalYearId && !year) throw new AccountingNotFoundError("Exercice");

    const [allActuals, budget, rawCommitments] = await Promise.all([
      loadProjectActuals(this.prisma, projectId),
      this.prisma.budgetVersion.findFirst({
        where: { projectId, status: "APPROVED" },
        include: { lines: { include: { account: { select: { number: true, label: true } } } } },
      }),
      this.prisma.commitment.findMany({
        where: { projectId, status: { in: ["OPEN", "SETTLED"] } },
        include: { account: { select: { number: true, label: true } }, settledEntry: { select: { status: true } } },
      }),
    ]);

    const actuals = year ? allActuals.filter((a) => a.fiscalYearId === year.id) : allActuals;
    // Engagements qui pèsent encore : ouverts, ou rouverts parce que leur écriture a été contrepassée. Dans la vue annuelle,
    // un engagement compte dans l'exercice de sa date.
    const engagements = rawCommitments.filter((c) => {
      const state = commitmentState(c);
      if (state !== "OPEN" && state !== "REOPENED") return false;
      return !year || (day(c.committedOn) >= year.start && day(c.committedOn) <= year.end);
    });

    const warnings: string[] = [];
    if (!budget) {
      warnings.push("Aucun budget n'est en vigueur pour ce projet : seul le réalisé est affiché. Faites approuver un budget pour voir ce qu'il reste à dépenser.");
    }
    const labelOnly = budget?.lines.filter((l) => !l.accountId).length ?? 0;
    if (labelOnly > 0) {
      warnings.push(
        `${labelOnly} poste(s) du budget n'ont pas de compte comptable : leur réalisé ne peut pas être rapproché poste par poste. Il apparaît dans les lignes « compte non indiqué dans le budget ». Les totaux restent exacts.`,
      );
    }
    if (year && budget?.lines.some((l) => day(l.periodStart) < year.start || day(l.periodEnd) > year.end)) {
      warnings.push("Les lignes de budget qui dépassent cet exercice sont réparties au prorata du nombre de jours (une différence d'un centime est possible d'un exercice à l'autre).");
    }

    const scopeText = year ? `l'exercice ${year.label} (du ${year.start} au ${year.end})` : "toute la vie du projet";
    const build = (kind: Kind): ReportSection => {
      const lines = (budget?.lines ?? []).filter((l) => l.kind === kind);
      const budgetAmount = (l: (typeof lines)[number]) =>
        year ? prorate(l.amount.toFixed(2), day(l.periodStart), day(l.periodEnd), year.start, year.end) : l.amount.toFixed(2);

      const byAccount = new Map<string, { number: string; label: string; budget: Money }>();
      const byLabel = new Map<string, { label: string; budget: Money }>();
      for (const line of lines) {
        const amount = Money.parse(budgetAmount(line));
        if (line.accountId && line.account) {
          const entry = byAccount.get(line.accountId) ?? { number: line.account.number, label: line.account.label, budget: Money.zero() };
          entry.budget = entry.budget.add(amount);
          byAccount.set(line.accountId, entry);
        } else {
          const key = line.label.trim().toLowerCase();
          const entry = byLabel.get(key) ?? { label: line.label.trim(), budget: Money.zero() };
          entry.budget = entry.budget.add(amount);
          byLabel.set(key, entry);
        }
      }

      const actualByAccount = new Map<string, { number: string; label: string; amount: Money }>();
      for (const a of actuals.filter((x) => x.kind === kind)) {
        const entry = actualByAccount.get(a.accountId) ?? { number: a.accountNumber, label: a.accountLabel, amount: Money.zero() };
        entry.amount = entry.amount.add(a.amount);
        actualByAccount.set(a.accountId, entry);
      }
      const engagedByAccount = new Map<string, { number: string | null; label: string | null; amount: Money }>();
      if (kind === "CHARGE") {
        for (const c of engagements) {
          const key = c.accountId ?? NO_ACCOUNT;
          const entry = engagedByAccount.get(key) ?? { number: c.account?.number ?? null, label: c.account?.label ?? null, amount: Money.zero() };
          entry.amount = entry.amount.add(Money.parse(c.amount.toFixed(2)));
          engagedByAccount.set(key, entry);
        }
      }

      const hasBudget = budget !== null;
      const rows: ReportRow[] = [];
      let budgetTotal = Money.zero();
      let engagedTotal = Money.zero();
      let actualTotal = Money.zero();

      const accountRows = [...byAccount.entries()].sort((a, b) => a[1].number.localeCompare(b[1].number));
      for (const [accountId, entry] of accountRows) {
        const actual = actualByAccount.get(accountId)?.amount ?? Money.zero();
        const engaged = engagedByAccount.get(accountId)?.amount ?? Money.zero();
        budgetTotal = budgetTotal.add(entry.budget);
        actualTotal = actualTotal.add(actual);
        engagedTotal = engagedTotal.add(engaged);
        rows.push({
          key: `account:${accountId}`,
          label: `${entry.number} — ${entry.label}`,
          accountNumber: entry.number,
          budget: entry.budget.toString(),
          engaged: kind === "CHARGE" ? engaged.toString() : null,
          actual: actual.toString(),
          remaining: entry.budget.subtract(actual).subtract(engaged).toString(),
          outOfBudget: false,
          note: null,
        });
      }
      for (const [key, entry] of [...byLabel.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "fr"))) {
        budgetTotal = budgetTotal.add(entry.budget);
        rows.push({
          key: `label:${key}`,
          label: entry.label,
          accountNumber: null,
          budget: entry.budget.toString(),
          engaged: null,
          actual: null,
          remaining: null,
          outOfBudget: false,
          note: "Poste sans compte : son réalisé n'est pas suivi ligne à ligne.",
        });
      }
      // Réalisé et engagements sur des comptes que le budget ne mentionne pas : jamais perdus, jamais cachés.
      const others = new Set<string>([...actualByAccount.keys(), ...[...engagedByAccount.keys()].filter((k) => k !== NO_ACCOUNT)]);
      for (const accountId of [...others].filter((id) => !byAccount.has(id)).sort((a, b) => {
        const left = actualByAccount.get(a)?.number ?? engagedByAccount.get(a)?.number ?? "";
        const right = actualByAccount.get(b)?.number ?? engagedByAccount.get(b)?.number ?? "";
        return left.localeCompare(right);
      })) {
        const actual = actualByAccount.get(accountId);
        const engaged = engagedByAccount.get(accountId);
        const number = actual?.number ?? engaged?.number ?? null;
        const label = actual?.label ?? engaged?.label ?? "";
        actualTotal = actualTotal.add(actual?.amount ?? Money.zero());
        engagedTotal = engagedTotal.add(engaged?.amount ?? Money.zero());
        rows.push({
          key: `other:${accountId}`,
          label: `${number} — ${label}`,
          accountNumber: number,
          budget: null,
          engaged: kind === "CHARGE" ? (engaged?.amount ?? Money.zero()).toString() : null,
          actual: (actual?.amount ?? Money.zero()).toString(),
          remaining: null,
          outOfBudget: true,
          note: "Compte non indiqué dans le budget",
        });
      }
      const noAccount = engagedByAccount.get(NO_ACCOUNT);
      if (noAccount) {
        engagedTotal = engagedTotal.add(noAccount.amount);
        rows.push({
          key: "other:none",
          label: "Engagements sans compte",
          accountNumber: null,
          budget: null,
          engaged: noAccount.amount.toString(),
          actual: "0.00",
          remaining: null,
          outOfBudget: true,
          note: "Engagements sans compte indiqué",
        });
      }

      const remaining = hasBudget ? budgetTotal.subtract(actualTotal).subtract(engagedTotal) : null;
      return {
        rows: hasBudget ? rows : rows.map((r) => ({ ...r, remaining: null })),
        total: {
          budget: hasBudget ? budgetTotal.toString() : null,
          engaged: kind === "CHARGE" ? engagedTotal.toString() : null,
          actual: actualTotal.toString(),
          remaining: remaining ? remaining.toString() : null,
        },
      };
    };

    return {
      project,
      scope: { kind: year ? "YEAR" : "GLOBAL", fiscalYear: year ?? null },
      fiscalYears: years,
      budget: budget ? { id: budget.id, number: budget.number, label: budget.label, approvedAt: budget.approvedAt ? budget.approvedAt.toISOString() : null } : null,
      formula:
        `Reste disponible (dépenses) = budget − dépensé (écritures comptabilisées) − engagé non soldé. Périmètre : ${scopeText}. ` +
        "Un engagement soldé par une écriture comptabilisée ne compte plus comme engagé : seule la dépense réelle compte, jamais les deux. " +
        "Recettes : reste à recevoir = budget − encaissé (écritures comptabilisées).",
      charges: build("CHARGE"),
      products: build("PRODUCT"),
      warnings,
    };
  }
}
