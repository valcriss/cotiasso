import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { ProjectAccess } from "../auth/auth.guard.js";
import type { Grant } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { grantScope } from "./grants.service.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Date inexistante.");
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (12 chiffres et 2 décimales au plus).")
  .refine((value) => Number(value) > 0, "Le montant doit être positif.");

const attachInput = z
  .object({ allocationId: z.uuid("Dépense invalide."), amount, coFinancingReason: z.string().trim().min(1).max(500).nullish() })
  .strict();
const cancelInput = z.object({ reason: z.string().trim().min(3, "Indiquez pourquoi cette affectation est annulée.").max(500) }).strict();
const reportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict();

export interface ExpenseView {
  id: string;
  /** Part de la dépense affectée à cette subvention. */
  amount: string;
  coFinancingReason: string | null;
  cancelled: boolean;
  cancelReason: string | null;
  /** Compte pour la subvention : ni annulée, ni écriture contrepassée. */
  counted: boolean;
  /** Vrai si l'écriture de la dépense a été contrepassée depuis : l'affectation ne compte plus. */
  reversed: boolean;
  /** Vrai si la date de la dépense est hors de la période financée de la subvention. */
  outOfPeriod: boolean;
  entry: { id: string; number: number | null; journalCode: string; date: string; label: string | null };
  account: { number: string; label: string };
  project: { id: string; code: string; name: string };
  /** Montant de la part de dépense ventilée sur ce projet, dont celle-ci est une partie. */
  expenseAmount: string;
}

export interface GrantExpenses {
  grantId: string;
  granted: string | null;
  /** Somme des dépenses affectées qui comptent (comptabilisées, non annulées). */
  spent: string;
  /** Vrai si les dépenses affectées dépassent le montant accordé : signalé, jamais bloqué. */
  overGranted: boolean;
  overBy: string | null;
  expenses: ExpenseView[];
  warnings: string[];
}

export interface ExpenseCandidate {
  allocationId: string;
  entry: { id: string; number: number | null; journalCode: string; date: string; label: string };
  account: { number: string; label: string };
  project: { id: string; code: string; name: string };
  amount: string;
  /** Part de la dépense qui n'est encore affectée à aucune subvention. */
  remaining: string;
  outOfPeriod: boolean;
}

export interface ReportGroup {
  accountNumber: string;
  accountLabel: string;
  count: number;
  amount: string;
}

export interface GrantReport {
  grant: { id: string; title: string; funder: string; reference: string | null; periodStart: string | null; periodEnd: string | null };
  /** Période du compte rendu (bornes incluses) ; `null` = sans borne. */
  period: { from: string | null; to: string | null };
  granted: string | null;
  groups: ReportGroup[];
  /** Dépenses affectées sur la période. */
  spent: string;
  payments: { operationDate: string; amount: string }[];
  /** Versements reçus sur la période. */
  received: string;
  /** Reçu − dépenses affectées, sur la période : ce qui n'a pas été dépensé. Suivi de gestion, sans écriture. */
  residual: string;
  overGranted: boolean;
  coFinancingReasons: string[];
  warnings: string[];
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const dec = (value: { toFixed(places: number): string }) => Money.parse(value.toFixed(2)).toString();

function rethrow(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const message = triggerMessage(error);
  if (message) throw new AccountingConflictError(message);
  throw error;
}

const insidePeriod = (grant: Pick<Grant, "periodStart" | "periodEnd">, date: string): boolean =>
  (!grant.periodStart || date >= day(grant.periodStart)) && (!grant.periodEnd || date <= day(grant.periodEnd));

/**
 * Affectation des dépenses aux subventions et compte rendu pour le financeur (ADR 0024, tranche 4.4). On affecte une part
 * d'une dépense comptabilisée (une charge ventilée sur un projet que la subvention finance). Suivi de gestion : aucune écriture
 * comptable. Le total affecté peut dépasser le montant accordé et une dépense peut être hors période : c'est signalé, jamais
 * bloqué ; en revanche une dépense ne peut pas être affectée pour plus que son montant (garanti par la base).
 */
@Injectable()
export class GrantExpensesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async expenses(grantId: string, access?: ProjectAccess): Promise<GrantExpenses> {
    const grant = await this.visible(grantId, access);
    return this.compute(grant, access);
  }

  async attach(grantId: string, body: unknown, actorId: string): Promise<GrantExpenses> {
    const input = parse(attachInput, body);
    const grant = await this.prisma.grant.findUnique({ where: { id: grantId } });
    if (!grant) throw new AccountingNotFoundError("Subvention");
    if (grant.status !== "GRANTED") {
      throw new AccountingConflictError("Seule une subvention accordée, pas encore clôturée, reçoit des dépenses.");
    }
    const rows = await this.prisma.$queryRaw<{ remaining: string }[]>`
      SELECT (al."amount" - COALESCE((SELECT SUM(f."amount") FROM "FundingExpenseAllocation" f WHERE f."allocationId" = al."id" AND f."cancelledAt" IS NULL), 0))::text AS "remaining"
      FROM "AnalyticalAllocation" al WHERE al."id" = ${input.allocationId}::uuid`;
    if (rows.length === 0) throw new AccountingNotFoundError("Dépense");
    const remaining = Money.parse(rows[0]!.remaining);
    if (Money.parse(input.amount).compare(remaining) > 0) {
      throw new AccountingConflictError(
        `Il ne reste que ${remaining.toString()} € de cette dépense à affecter : le reste est déjà affecté à une subvention. Réduisez le montant.`,
      );
    }
    const row = await this.prisma.fundingExpenseAllocation
      .create({ data: { grantId, allocationId: input.allocationId, amount: input.amount, coFinancingReason: input.coFinancingReason ?? null, createdBy: actorId } })
      .catch(rethrow);
    await this.audit.record({
      action: "grant.expense.attached",
      objectType: "Grant",
      objectId: grantId,
      actorId,
      details: { expenseId: row.id, ...(input.coFinancingReason && { coFinanced: true }) },
    });
    return this.compute(grant);
  }

  async cancel(id: string, body: unknown, actorId: string): Promise<GrantExpenses> {
    const { reason } = parse(cancelInput, body);
    const current = await this.prisma.fundingExpenseAllocation.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Affectation");
    if (current.cancelledAt) throw new AccountingConflictError("Cette affectation est déjà annulée.");
    await this.prisma.fundingExpenseAllocation.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: actorId, cancelReason: reason } }).catch(rethrow);
    await this.audit.record({ action: "grant.expense.cancelled", objectType: "Grant", objectId: current.grantId, actorId, justification: reason, details: { expenseId: id } });
    const grant = await this.prisma.grant.findUniqueOrThrow({ where: { id: current.grantId } });
    return this.compute(grant);
  }

  /** Dépenses qu'on peut affecter : charges comptabilisées des projets que la subvention finance, dont une part est libre. */
  async candidates(grantId: string): Promise<ExpenseCandidate[]> {
    const grant = await this.prisma.grant.findUnique({ where: { id: grantId } });
    if (!grant) throw new AccountingNotFoundError("Subvention");
    const rows = await this.prisma.$queryRaw<
      {
        allocationId: string;
        entryId: string;
        number: number | null;
        journalCode: string;
        date: Date;
        label: string;
        accountNumber: string;
        accountLabel: string;
        projectId: string;
        projectCode: string;
        projectName: string;
        amount: string;
        remaining: string;
      }[]
    >`
      SELECT al."id" AS "allocationId", e."id" AS "entryId", e."number", j."code" AS "journalCode", e."date", e."label",
             a."number" AS "accountNumber", a."label" AS "accountLabel", p."id" AS "projectId", p."code" AS "projectCode", p."name" AS "projectName",
             al."amount"::text AS "amount",
             (al."amount" - COALESCE((SELECT SUM(f."amount") FROM "FundingExpenseAllocation" f WHERE f."allocationId" = al."id" AND f."cancelledAt" IS NULL), 0))::text AS "remaining"
      FROM "AnalyticalAllocation" al
      JOIN "JournalLine" l ON l."id" = al."lineId"
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "Journal" j ON j."id" = e."journalId"
      JOIN "Account" a ON a."id" = l."accountId"
      JOIN "Project" p ON p."id" = al."projectId"
      WHERE e."status" = 'POSTED' AND l."debit" > 0 AND left(a."number", 1) = '6'
        AND al."projectId" IN (SELECT g."projectId" FROM "GrantProjectAllocation" g WHERE g."grantId" = ${grantId}::uuid)
        AND al."amount" > COALESCE((SELECT SUM(f."amount") FROM "FundingExpenseAllocation" f WHERE f."allocationId" = al."id" AND f."cancelledAt" IS NULL), 0)
      ORDER BY e."date" DESC, e."number" DESC NULLS LAST
      LIMIT 100`;
    return rows.map((r) => ({
      allocationId: r.allocationId,
      entry: { id: r.entryId, number: r.number, journalCode: r.journalCode, date: day(r.date), label: r.label },
      account: { number: r.accountNumber, label: r.accountLabel },
      project: { id: r.projectId, code: r.projectCode, name: r.projectName },
      amount: Money.parse(r.amount).toString(),
      remaining: Money.parse(r.remaining).toString(),
      outOfPeriod: !insidePeriod(grant, day(r.date)),
    }));
  }

  /** Compte rendu pour le financeur : dépenses affectées par poste (compte), versements reçus et reliquat, sur une période. */
  async report(grantId: string, rawQuery: unknown, access?: ProjectAccess): Promise<GrantReport> {
    const q = parse(reportQuery, rawQuery);
    if (q.from && q.to && q.from > q.to) throw new AccountingConflictError("La fin de la période précède son début.");
    const grant = await this.visible(grantId, access);
    const all = await this.compute(grant, access);
    const inRange = (date: string) => (!q.from || date >= q.from) && (!q.to || date <= q.to);

    const counted = all.expenses.filter((e) => e.counted && inRange(e.entry.date));
    const byAccount = new Map<string, ReportGroup>();
    for (const e of counted) {
      const group = byAccount.get(e.account.number) ?? { accountNumber: e.account.number, accountLabel: e.account.label, count: 0, amount: "0.00" };
      group.count += 1;
      group.amount = Money.parse(group.amount).add(Money.parse(e.amount)).toString();
      byAccount.set(e.account.number, group);
    }
    const spent = counted.reduce((total, e) => total.add(Money.parse(e.amount)), Money.zero());

    const payments = (
      await this.prisma.grantPayment.findMany({
        where: { grantId, cancelledAt: null },
        include: { transaction: { select: { operationDate: true } } },
        orderBy: { createdAt: "asc" },
      })
    )
      .map((p) => ({ operationDate: day(p.transaction.operationDate), amount: dec(p.amount) }))
      .filter((p) => inRange(p.operationDate));
    const received = payments.reduce((total, p) => total.add(Money.parse(p.amount)), Money.zero());

    return {
      grant: {
        id: grant.id,
        title: grant.title,
        funder: (await this.prisma.funder.findUniqueOrThrow({ where: { id: grant.funderId }, select: { name: true } })).name,
        reference: grant.reference,
        periodStart: grant.periodStart ? day(grant.periodStart) : null,
        periodEnd: grant.periodEnd ? day(grant.periodEnd) : null,
      },
      period: { from: q.from ?? null, to: q.to ?? null },
      granted: all.granted,
      groups: [...byAccount.values()].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)),
      spent: spent.toString(),
      payments,
      received: received.toString(),
      residual: received.subtract(spent).toString(),
      overGranted: all.overGranted,
      coFinancingReasons: all.expenses.filter((e) => e.counted && e.coFinancingReason).map((e) => e.coFinancingReason!),
      warnings: all.warnings,
    };
  }

  private async visible(grantId: string, access?: ProjectAccess): Promise<Grant> {
    const grant = await this.prisma.grant.findFirst({ where: { AND: [{ id: grantId }, grantScope(access)] } });
    if (!grant) throw new AccountingNotFoundError("Subvention");
    return grant;
  }

  /**
   * Libellé de l'écriture : visible pour un droit global, ou pour une dépense d'un projet de la portée de l'utilisateur.
   * Une dépense d'un autre projet reste visible par son montant et son poste, sans le détail de l'écriture.
   */
  private canSeeLabel(access: ProjectAccess | undefined, projectId: string): boolean {
    return !access || access.all || access.ids.has(projectId);
  }

  private async compute(grant: Grant, access?: ProjectAccess): Promise<GrantExpenses> {
    const rows = await this.prisma.fundingExpenseAllocation.findMany({
      where: { grantId: grant.id },
      include: {
        allocation: {
          include: {
            project: { select: { id: true, code: true, name: true } },
            line: { include: { account: { select: { number: true, label: true } }, entry: { select: { id: true, number: true, date: true, label: true, status: true, journal: { select: { code: true } } } } } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });
    const expenses: ExpenseView[] = rows.map((r) => {
      const entry = r.allocation.line.entry;
      const cancelled = r.cancelledAt !== null;
      return {
        id: r.id,
        amount: dec(r.amount),
        coFinancingReason: r.coFinancingReason,
        cancelled,
        cancelReason: r.cancelReason,
        counted: !cancelled && entry.status === "POSTED",
        reversed: entry.status === "REVERSED",
        outOfPeriod: !insidePeriod(grant, day(entry.date)),
        entry: { id: entry.id, number: entry.number, journalCode: entry.journal.code, date: day(entry.date), label: this.canSeeLabel(access, r.allocation.project.id) ? entry.label : null },
        account: { number: r.allocation.line.account.number, label: r.allocation.line.account.label },
        project: { id: r.allocation.project.id, code: r.allocation.project.code, name: r.allocation.project.name },
        expenseAmount: dec(r.allocation.amount),
      };
    });
    const spent = expenses.filter((e) => e.counted).reduce((total, e) => total.add(Money.parse(e.amount)), Money.zero());
    const granted = grant.grantedAmount ? Money.parse(dec(grant.grantedAmount)) : null;
    const overGranted = granted !== null && spent.compare(granted) > 0;
    const warnings: string[] = [];
    if (overGranted) {
      warnings.push(
        `Les dépenses affectées (${spent.toString()} €) dépassent le montant accordé (${granted!.toString()} €) de ${spent.subtract(granted!).toString()} €. Cet écart n'est pas financé par la subvention : précisez-le au financeur.`,
      );
    }
    const outOfPeriod = expenses.filter((e) => e.counted && e.outOfPeriod).length;
    if (outOfPeriod > 0) {
      warnings.push(`${outOfPeriod} dépense(s) affectée(s) sont datées hors de la période financée : certains financeurs les écartent.`);
    }
    const reversed = expenses.filter((e) => !e.cancelled && e.reversed).length;
    if (reversed > 0) {
      warnings.push(`${reversed} affectation(s) concernent une écriture annulée depuis : elles ne comptent plus. Annulez-les ou affectez la dépense corrigée.`);
    }
    return {
      grantId: grant.id,
      granted: granted ? granted.toString() : null,
      spent: spent.toString(),
      overGranted,
      overBy: overGranted ? spent.subtract(granted!).toString() : null,
      expenses,
      warnings,
    };
  }
}
