import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { ProjectAccess } from "../auth/auth.guard.js";
import type { Grant, GrantPayment, GrantSchedule } from "../generated/prisma/client.js";
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

const scheduleInput = z.object({ dueOn: isoDate, amount, condition: z.string().trim().max(500).default("") }).strict();
const schedulePatch = z.object({ dueOn: isoDate.optional(), amount: amount.optional(), condition: z.string().trim().max(500).optional() }).strict();
const paymentInput = z
  .object({ transactionId: z.uuid("Transaction invalide."), amount, scheduleId: z.uuid("Échéance invalide.").nullish(), note: z.string().trim().max(500).nullish() })
  .strict();
const cancelInput = z.object({ reason: z.string().trim().min(3, "Indiquez pourquoi ce versement est annulé.").max(500) }).strict();

export type ScheduleState = "PENDING" | "PARTIAL" | "RECEIVED";

export interface ScheduleView {
  id: string;
  dueOn: string;
  amount: string;
  condition: string;
  /** Somme des versements reçus rattachés à cette échéance. */
  received: string;
  state: ScheduleState;
  /** Vrai si la date est passée et que l'échéance n'est pas entièrement reçue. */
  overdue: boolean;
}

export interface PaymentView {
  id: string;
  transactionId: string;
  /** Date du mouvement bancaire. Le libellé de la banque n'est volontairement pas exposé ici. */
  operationDate: string;
  amount: string;
  scheduleId: string | null;
  note: string | null;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface GrantFinance {
  grantId: string;
  /** Montant accordé ; `null` tant que la subvention n'est pas accordée. */
  granted: string | null;
  /** Somme des échéances prévues. */
  planned: string;
  /** Somme des versements reçus (hors annulés). */
  received: string;
  /** Accordé − reçu : ce qu'il reste à recevoir (négatif si le financeur a versé plus que prévu). */
  remaining: string | null;
  /** Accordé − prévu : la part du montant accordé qui n'est pas encore planifiée. */
  unplanned: string | null;
  /** Vrai si les versements dépassent le montant accordé : signalé, jamais masqué. */
  overReceived: boolean;
  /** Dépenses affectées à la subvention (comptabilisées, non annulées). */
  spent: string;
  /** Reçu − dépenses affectées : ce qui n'a pas été dépensé. Suivi de gestion, aucune écriture. */
  residual: string;
  schedule: ScheduleView[];
  payments: PaymentView[];
}

export interface PaymentCandidate {
  id: string;
  operationDate: string;
  label: string;
  accountName: string;
  amount: string;
  /** Part de l'encaissement qui n'est encore affectée ni à une cotisation ni à une subvention. */
  remaining: string;
  /** L'encaissement n'est pas encore dans les comptes (ni en brouillon, ni dans un virement) : on peut l'y enregistrer d'un même geste. */
  canBook: boolean;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const dec = (value: { toFixed(places: number): string }) => Money.parse(value.toFixed(2)).toString();

function rethrow(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const message = triggerMessage(error);
  if (message) throw new AccountingConflictError(message);
  throw error;
}

/**
 * Échéancier et versements reçus d'une subvention (ADR 0024, tranche 4.3b). L'attribution et le versement ne se confondent
 * pas : le montant accordé est une décision, un versement est de l'argent arrivé sur un compte, rattaché ici à une
 * transaction (un encaissement). Aucune écriture comptable n'est créée. Les garanties (plafond des échéances, plafond de la
 * transaction partagé avec les cotisations, versements jamais supprimés) sont dans la base.
 */
@Injectable()
export class GrantFinanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Vue financière d'une subvention, soumise à la même portée de lecture que la subvention elle-même. */
  async finance(grantId: string, access?: ProjectAccess): Promise<GrantFinance> {
    const grant = await this.prisma.grant.findFirst({ where: { AND: [{ id: grantId }, grantScope(access)] } });
    if (!grant) throw new AccountingNotFoundError("Subvention");
    return this.compute(grant);
  }

  async addSchedule(grantId: string, body: unknown, actorId: string): Promise<GrantFinance> {
    const input = parse(scheduleInput, body);
    const grant = await this.requireGranted(grantId, "L'échéancier ne se prépare que pour une subvention accordée.");
    await this.assertPlanFits(grant, input.amount, null);
    const row = await this.prisma.grantSchedule
      .create({ data: { grantId, dueOn: new Date(`${input.dueOn}T00:00:00Z`), amount: input.amount, condition: input.condition, createdBy: actorId } })
      .catch(rethrow);
    await this.audit.record({ action: "grant.schedule.added", objectType: "Grant", objectId: grantId, actorId, details: { scheduleId: row.id } });
    return this.finance(grantId);
  }

  async updateSchedule(id: string, body: unknown, actorId: string): Promise<GrantFinance> {
    const patch = parse(schedulePatch, body);
    const line = await this.requireSchedule(id);
    const grant = await this.requireGranted(line.grantId, "L'échéancier ne change plus : la subvention est clôturée.");
    if (patch.amount !== undefined) await this.assertPlanFits(grant, patch.amount, id);
    await this.prisma.grantSchedule
      .update({
        where: { id },
        data: {
          ...(patch.dueOn !== undefined && { dueOn: new Date(`${patch.dueOn}T00:00:00Z`) }),
          ...(patch.amount !== undefined && { amount: patch.amount }),
          ...(patch.condition !== undefined && { condition: patch.condition }),
        },
      })
      .catch(rethrow);
    await this.audit.record({ action: "grant.schedule.updated", objectType: "Grant", objectId: line.grantId, actorId, details: { scheduleId: id, fields: Object.keys(patch) } });
    return this.finance(line.grantId);
  }

  /** Retire une échéance qui n'a reçu aucun versement. Une échéance déjà réglée garde sa trace. */
  async removeSchedule(id: string, actorId: string): Promise<GrantFinance> {
    const line = await this.requireSchedule(id);
    await this.requireGranted(line.grantId, "L'échéancier ne change plus : la subvention est clôturée.");
    if ((await this.prisma.grantPayment.count({ where: { scheduleId: id } })) > 0) {
      throw new AccountingConflictError("Cette échéance a des versements rattachés : elle ne peut plus être retirée.");
    }
    await this.prisma.grantSchedule.delete({ where: { id } }).catch(rethrow);
    await this.audit.record({ action: "grant.schedule.removed", objectType: "Grant", objectId: line.grantId, actorId, details: { scheduleId: id } });
    return this.finance(line.grantId);
  }

  /** Rattache une part d'un encaissement à la subvention (et, si on le souhaite, à l'échéance qu'elle règle). */
  async recordPayment(grantId: string, body: unknown, actorId: string): Promise<GrantFinance> {
    const input = parse(paymentInput, body);
    await this.requireGranted(grantId, "Seule une subvention accordée, pas encore clôturée, reçoit des versements.");
    const tx = await this.prisma.transaction.findUnique({ where: { id: input.transactionId }, select: { id: true, amount: true } });
    if (!tx) throw new AccountingNotFoundError("Transaction");
    if (tx.amount.lte(0)) throw new AccountingConflictError("Un versement de subvention se rattache à un encaissement (une somme reçue), pas à une dépense.");
    const rows = await this.prisma.$queryRaw<{ remaining: string }[]>`
      SELECT (t."amount" - transaction_allocated_total(t."id"))::text AS "remaining" FROM "Transaction" t WHERE t."id" = ${input.transactionId}::uuid`;
    const remaining = rows[0]?.remaining ?? "0.00";
    if (Money.parse(input.amount).compare(Money.parse(remaining)) > 0) {
      throw new AccountingConflictError(
        `Cet encaissement n'a plus que ${Money.parse(remaining).toString()} € disponibles : le reste est déjà affecté (cotisations ou autre subvention). Réduisez le montant du versement.`,
      );
    }
    const row = await this.prisma.grantPayment
      .create({ data: { grantId, transactionId: input.transactionId, amount: input.amount, scheduleId: input.scheduleId ?? null, note: input.note ?? null, createdBy: actorId } })
      .catch(rethrow);
    await this.audit.record({
      action: "grant.payment.recorded",
      objectType: "Grant",
      objectId: grantId,
      actorId,
      details: { paymentId: row.id, ...(input.scheduleId && { scheduleId: input.scheduleId }) },
    });
    return this.finance(grantId);
  }

  /** Annule un versement rattaché par erreur, avec un motif. Il reste dans l'historique. */
  async cancelPayment(id: string, body: unknown, actorId: string): Promise<GrantFinance> {
    const { reason } = parse(cancelInput, body);
    const current = await this.prisma.grantPayment.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Versement");
    if (current.cancelledAt) throw new AccountingConflictError("Ce versement est déjà annulé.");
    await this.prisma.grantPayment.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: actorId, cancelReason: reason } }).catch(rethrow);
    await this.audit.record({ action: "grant.payment.cancelled", objectType: "Grant", objectId: current.grantId, actorId, justification: reason, details: { paymentId: id } });
    return this.finance(current.grantId);
  }

  /** Encaissements qui peuvent recevoir un versement : une somme reçue dont une part n'est encore affectée à rien. */
  async candidates(grantId: string): Promise<PaymentCandidate[]> {
    if (!(await this.prisma.grant.findUnique({ where: { id: grantId }, select: { id: true } }))) throw new AccountingNotFoundError("Subvention");
    const rows = await this.prisma.$queryRaw<{ id: string; operationDate: Date; label: string; accountName: string; amount: string; remaining: string; canBook: boolean }[]>`
      SELECT t."id", t."operationDate", t."label", f."name" AS "accountName", t."amount"::text AS "amount",
             (t."amount" - transaction_allocated_total(t."id"))::text AS "remaining",
             (NOT EXISTS (SELECT 1 FROM "TreasuryMatch" m WHERE m."transactionId" = t."id" AND m."status" = 'ACTIVE')
             AND NOT EXISTS (SELECT 1 FROM "Transfer" tr WHERE tr."outTransactionId" = t."id" OR tr."inTransactionId" = t."id")) AS "canBook"
      FROM "Transaction" t JOIN "FinancialAccount" f ON f."id" = t."financialAccountId"
      WHERE t."amount" > 0 AND t."amount" > transaction_allocated_total(t."id")
      ORDER BY t."operationDate" DESC, t."id" DESC
      LIMIT 50`;
    return rows.map((r) => ({
      id: r.id,
      operationDate: day(r.operationDate),
      label: r.label,
      accountName: r.accountName,
      amount: Money.parse(r.amount).toString(),
      remaining: Money.parse(r.remaining).toString(),
      canBook: r.canBook,
    }));
  }

  private async compute(grant: Grant): Promise<GrantFinance> {
    const [schedule, payments] = await Promise.all([
      this.prisma.grantSchedule.findMany({ where: { grantId: grant.id }, orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }] }),
      this.prisma.grantPayment.findMany({
        where: { grantId: grant.id },
        include: { transaction: { select: { operationDate: true } } },
        orderBy: [{ createdAt: "asc" }],
      }),
    ]);
    const active = payments.filter((p) => !p.cancelledAt);
    const sum = (rows: { amount: { toFixed(places: number): string } }[]) => rows.reduce((total, r) => total.add(Money.parse(dec(r.amount))), Money.zero());
    const received = sum(active);
    const planned = sum(schedule);
    const granted = grant.grantedAmount ? Money.parse(dec(grant.grantedAmount)) : null;
    const today = new Date().toISOString().slice(0, 10);
    const spentRows = await this.prisma.$queryRaw<{ spent: string }[]>`
      SELECT COALESCE(SUM(f."amount"), 0)::text AS "spent"
      FROM "FundingExpenseAllocation" f
      JOIN "AnalyticalAllocation" al ON al."id" = f."allocationId"
      JOIN "JournalLine" l ON l."id" = al."lineId"
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      WHERE f."grantId" = ${grant.id}::uuid AND f."cancelledAt" IS NULL AND e."status" = 'POSTED'`;
    const spent = Money.parse(spentRows[0]?.spent ?? "0.00");
    return {
      grantId: grant.id,
      granted: granted ? granted.toString() : null,
      planned: planned.toString(),
      received: received.toString(),
      remaining: granted ? granted.subtract(received).toString() : null,
      unplanned: granted ? granted.subtract(planned).toString() : null,
      overReceived: granted !== null && received.compare(granted) > 0,
      spent: spent.toString(),
      residual: received.subtract(spent).toString(),
      schedule: schedule.map((line) => this.scheduleView(line, active, grant.status === "GRANTED", today)),
      payments: payments.map((p) => ({
        id: p.id,
        transactionId: p.transactionId,
        operationDate: day(p.transaction.operationDate),
        amount: dec(p.amount),
        scheduleId: p.scheduleId,
        note: p.note,
        cancelled: p.cancelledAt !== null,
        cancelReason: p.cancelReason,
      })),
    };
  }

  private scheduleView(line: GrantSchedule, active: GrantPayment[], open: boolean, today: string): ScheduleView {
    const received = active.filter((p) => p.scheduleId === line.id).reduce((total, p) => total.add(Money.parse(dec(p.amount))), Money.zero());
    const expected = Money.parse(dec(line.amount));
    const state: ScheduleState = received.compare(expected) >= 0 ? "RECEIVED" : received.isPositive() ? "PARTIAL" : "PENDING";
    return {
      id: line.id,
      dueOn: day(line.dueOn),
      amount: expected.toString(),
      condition: line.condition,
      received: received.toString(),
      state,
      overdue: open && state !== "RECEIVED" && day(line.dueOn) < today,
    };
  }

  /** Vérifie que l'échéance tient dans le montant accordé, avec un message qui dit ce qu'il reste à planifier. */
  private async assertPlanFits(grant: Grant, newAmount: string, replacing: string | null): Promise<void> {
    const lines = await this.prisma.grantSchedule.findMany({ where: { grantId: grant.id, ...(replacing && { id: { not: replacing } }) } });
    const planned = lines.reduce((total, l) => total.add(Money.parse(dec(l.amount))), Money.zero());
    const granted = Money.parse(dec(grant.grantedAmount!));
    if (planned.add(Money.parse(newAmount)).compare(granted) > 0) {
      throw new AccountingConflictError(
        `Les échéances prévues dépasseraient le montant accordé (${granted.toString()} €). Il ne reste que ${granted.subtract(planned).toString()} € à planifier.`,
      );
    }
  }

  private async requireGranted(grantId: string, message: string): Promise<Grant> {
    const grant = await this.prisma.grant.findUnique({ where: { id: grantId } });
    if (!grant) throw new AccountingNotFoundError("Subvention");
    if (grant.status !== "GRANTED") throw new AccountingConflictError(message);
    return grant;
  }

  private async requireSchedule(id: string): Promise<GrantSchedule> {
    const line = await this.prisma.grantSchedule.findUnique({ where: { id } });
    if (!line) throw new AccountingNotFoundError("Échéance");
    return line;
  }
}
