import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Money } from "@cotiasso/accounting-domain";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { Prisma, type AllocationKind } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { MembershipsService, type MembershipView } from "./memberships.service.js";

const allocateInput = z
  .object({
    transactionId: z.uuid(),
    amount: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Montant positif attendu, avec au plus deux décimales.")
      .refine((value) => Number(value) > 0, "Le montant doit être supérieur à zéro."),
    kind: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT"),
    note: z.string().trim().max(200).nullish(),
  })
  .strict();
const cancelInput = z.object({ reason: z.string().trim().min(3, "Indiquez le motif de l'annulation (3 caractères au moins).").max(200) }).strict();
const candidatesQuery = z.object({ kind: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT") }).strict();

export interface AllocationView {
  id: string;
  transactionId: string;
  transactionDate: string;
  accountName: string;
  amount: string;
  kind: AllocationKind;
  note: string | null;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface PaymentCandidate {
  id: string;
  operationDate: string;
  label: string;
  accountName: string;
  /** Montant de la transaction (valeur absolue). */
  amount: string;
  /** Part pas encore affectée à une adhésion. */
  remaining: string;
}

export interface ReminderItem {
  membership: MembershipView;
  email: string | null;
  phone: string | null;
}

export interface Receipt {
  association: { name: string; address: string; postalCode: string; city: string };
  member: string;
  campaign: { name: string; startsOn: string; endsOn: string };
  expectedAmount: string;
  payments: { date: string; amount: string; kind: AllocationKind }[];
  paid: string;
  balance: string;
  issuedOn: string;
  /** Mention obligatoire : ce reçu n'ouvre aucun droit fiscal. */
  notice: string;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const dec = (value: { toFixed(places: number): string }) => Money.parse(value.toFixed(2)).toString();

function rethrow(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const message = triggerMessage(error);
  if (message) throw new AccountingConflictError(message);
  throw error;
}

/** Affectations de règlement, rappels et reçus simples (ADR 0023, tranches 3.3 et 3.4). Aucune écriture comptable n'est créée. */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MembershipsService) private readonly memberships: MembershipsService,
  ) {}

  /** Affecte une part d'une transaction à une adhésion ; l'adhésion peut en devenir effective (mode « à l'encaissement »). */
  async allocate(membershipId: string, body: unknown, actorId: string): Promise<{ allocation: AllocationView; membership: MembershipView }> {
    const input = parse(allocateInput, body);
    const membership = await this.prisma.membership.findUnique({ where: { id: membershipId }, select: { id: true } });
    if (!membership) throw new AccountingNotFoundError("Adhésion");
    const tx = await this.prisma.transaction.findUnique({ where: { id: input.transactionId }, select: { id: true } });
    if (!tx) throw new AccountingNotFoundError("Transaction");
    const created = await this.prisma
      .$transaction(async (db) => {
        const row = await db.paymentAllocation.create({
          data: { transactionId: input.transactionId, membershipId, amount: input.amount, kind: input.kind, note: input.note ?? null, createdBy: actorId },
        });
        await this.syncEffective(db, membershipId);
        return row;
      })
      .catch(rethrow);
    await this.audit.record({ action: "payment.allocated", objectType: "Membership", objectId: membershipId, actorId, details: { allocationId: created.id, kind: input.kind } });
    return { allocation: (await this.allocations(membershipId)).find((a) => a.id === created.id)!, membership: await this.membership(membershipId) };
  }

  /** Annule une affectation avec un motif (elle reste dans l'historique) ; l'adhésion peut redevenir en attente. */
  async cancelAllocation(id: string, body: unknown, actorId: string): Promise<MembershipView> {
    const { reason } = parse(cancelInput, body);
    const current = await this.prisma.paymentAllocation.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Affectation");
    if (current.cancelledAt) throw new AccountingConflictError("Cette affectation est déjà annulée.");
    await this.prisma
      .$transaction(async (db) => {
        await db.paymentAllocation.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: actorId, cancelReason: reason } });
        await this.syncEffective(db, current.membershipId);
      })
      .catch(rethrow);
    await this.audit.record({ action: "payment.allocation-cancelled", objectType: "Membership", objectId: current.membershipId, actorId, justification: reason });
    return this.membership(current.membershipId);
  }

  async allocations(membershipId: string): Promise<AllocationView[]> {
    if (!(await this.prisma.membership.findUnique({ where: { id: membershipId }, select: { id: true } }))) throw new AccountingNotFoundError("Adhésion");
    const rows = await this.prisma.paymentAllocation.findMany({
      where: { membershipId },
      orderBy: { createdAt: "desc" },
      include: { transaction: { select: { operationDate: true, financialAccount: { select: { name: true } } } } },
    });
    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      transactionDate: day(row.transaction.operationDate),
      accountName: row.transaction.financialAccount.name,
      amount: dec(row.amount),
      kind: row.kind,
      note: row.note,
      cancelled: row.cancelledAt !== null,
      cancelReason: row.cancelReason,
    }));
  }

  /** Transactions auxquelles on peut affecter : encaissements pour un règlement, décaissements pour un remboursement. */
  async candidates(membershipId: string, query: unknown): Promise<PaymentCandidate[]> {
    const { kind } = parse(candidatesQuery, query);
    if (!(await this.prisma.membership.findUnique({ where: { id: membershipId }, select: { id: true } }))) throw new AccountingNotFoundError("Adhésion");
    const rows = await this.prisma.$queryRaw<{ id: string; operationDate: Date; label: string; accountName: string; amount: string; remaining: string }[]>`
      SELECT t."id", t."operationDate", t."label", f."name" AS "accountName", abs(t."amount")::text AS "amount",
             (abs(t."amount") - transaction_allocated_total(t."id"))::text AS "remaining"
      FROM "Transaction" t JOIN "FinancialAccount" f ON f."id" = t."financialAccountId"
      WHERE ${kind === "PAYMENT" ? Prisma.sql`t."amount" > 0` : Prisma.sql`t."amount" < 0`}
        AND abs(t."amount") > transaction_allocated_total(t."id")
      ORDER BY t."operationDate" DESC, t."id" DESC
      LIMIT 50`;
    return rows.map((r) => ({ id: r.id, operationDate: day(r.operationDate), label: r.label, accountName: r.accountName, amount: Money.parse(r.amount).toString(), remaining: Money.parse(r.remaining).toString() }));
  }

  /** Cotisations restant dues d'une campagne (adhésions non annulées dont le reste dû est positif), avec de quoi contacter. */
  async reminders(campaignId: string): Promise<{ campaignName: string; items: ReminderItem[]; totalDue: string }> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } });
    if (!campaign) throw new AccountingNotFoundError("Campagne");
    const all = await this.memberships.listMemberships(campaignId);
    const due = all.filter((m) => m.status !== "CANCELLED" && Money.parse(m.balance).isPositive());
    const contacts = await this.prisma.member.findMany({ where: { id: { in: due.map((m) => m.memberId) } }, select: { id: true, email: true, phone: true } });
    const items = due.map((membership) => {
      const contact = contacts.find((c) => c.id === membership.memberId);
      return { membership, email: contact?.email ?? null, phone: contact?.phone ?? null };
    });
    return { campaignName: campaign.name, items, totalDue: items.reduce((sum, i) => sum.add(Money.parse(i.membership.balance)), Money.zero()).toString() };
  }

  /** Reçu simple d'une adhésion : récapitule les règlements, jamais un reçu fiscal. */
  async receipt(membershipId: string): Promise<Receipt> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { campaign: true, member: { select: { firstName: true, lastName: true } } },
    });
    if (!membership) throw new AccountingNotFoundError("Adhésion");
    const view = await this.membership(membershipId);
    if (!Money.parse(view.paid).isPositive()) throw new AccountingConflictError("Aucun règlement n'est enregistré pour cette adhésion : il n'y a pas de reçu à établir.");
    const allocations = (await this.allocations(membershipId)).filter((a) => !a.cancelled);
    const identity = (await this.settings.current("identity")) as { name: string; address: string; postalCode: string; city: string };
    return {
      association: { name: identity.name, address: identity.address, postalCode: identity.postalCode, city: identity.city },
      member: `${membership.member.firstName} ${membership.member.lastName}`,
      campaign: { name: membership.campaign.name, startsOn: day(membership.campaign.startsOn), endsOn: day(membership.campaign.endsOn) },
      expectedAmount: view.expectedAmount,
      payments: allocations.map((a) => ({ date: a.transactionDate, amount: a.amount, kind: a.kind })),
      paid: view.paid,
      balance: view.balance,
      issuedOn: day(new Date()),
      notice: "Ce reçu simple atteste des sommes reçues pour une cotisation. Il n'est pas un reçu fiscal et n'ouvre droit à aucune réduction d'impôt.",
    };
  }

  /** Adhésion effective à l'encaissement (ADR 0004) : quand les règlements nets couvrent l'attendu ; elle redevient en attente si un règlement est annulé. */
  private async syncEffective(db: Prisma.TransactionClient, membershipId: string): Promise<void> {
    const membership = await db.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { campaign: true } });
    if (membership.campaign.effectiveMode !== "PAYMENT") return;
    const rows = await db.paymentAllocation.findMany({ where: { membershipId, cancelledAt: null }, include: { transaction: { select: { operationDate: true } } } });
    let net = Money.zero();
    let last = "";
    for (const row of rows) {
      const value = Money.parse(dec(row.amount));
      net = row.kind === "PAYMENT" ? net.add(value) : net.subtract(value);
      const date = day(row.transaction.operationDate);
      if (row.kind === "PAYMENT" && date > last) last = date;
    }
    const expected = Money.parse(dec(membership.expectedAmount));
    if (membership.status === "PENDING" && expected.isPositive() && net.compare(expected) >= 0) {
      const start = day(membership.campaign.startsOn);
      const end = day(membership.campaign.endsOn);
      const effectiveOn = last < start ? start : last > end ? end : last;
      await db.membership.update({ where: { id: membershipId }, data: { status: "EFFECTIVE", effectiveOn: new Date(`${effectiveOn}T00:00:00Z`), effectiveOrigin: "PAYMENT", version: { increment: 1 } } });
    } else if (membership.status === "EFFECTIVE" && membership.effectiveOrigin === "PAYMENT" && net.compare(expected) < 0) {
      await db.membership.update({ where: { id: membershipId }, data: { status: "PENDING", effectiveOn: null, effectiveOrigin: null, version: { increment: 1 } } });
    }
  }

  private async membership(id: string): Promise<MembershipView> {
    const row = await this.prisma.membership.findUniqueOrThrow({ where: { id }, select: { campaignId: true } });
    return (await this.memberships.listMemberships(row.campaignId)).find((m) => m.id === id)!;
  }
}
