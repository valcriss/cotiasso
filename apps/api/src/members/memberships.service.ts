import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Money } from "@cotiasso/accounting-domain";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { MembershipMode, MembershipOrigin, MembershipStatus, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Montant positif attendu, avec au plus deux décimales (0 pour une exonération).");
const mode = z.enum(["PAYMENT", "VALIDATION", "START_DATE"]);

const campaignInput = z
  .object({ name: z.string().trim().min(3, "Donnez un nom d'au moins 3 caractères.").max(80), startsOn: isoDate, endsOn: isoDate, effectiveMode: mode.optional() })
  .strict()
  .refine((c) => c.startsOn <= c.endsOn, { message: "La fin précède le début.", path: ["endsOn"] });
const campaignPatch = z.object({ name: z.string().trim().min(3).max(80).optional(), startsOn: isoDate.optional(), endsOn: isoDate.optional(), effectiveMode: mode.optional() }).strict();

const tariffInput = z.object({ label: z.string().trim().min(1, "Libellé obligatoire.").max(80), amount, categoryId: z.uuid().nullish() }).strict();
const tariffPatch = z.object({ label: z.string().trim().min(1).max(80).optional(), amount: amount.optional(), categoryId: z.uuid().nullable().optional() }).strict();

const membershipInput = z
  .object({
    memberId: z.uuid(),
    tariffId: z.uuid(),
    /** Montant différent du tarif (exonération, remise) : la raison est alors obligatoire. */
    expectedAmount: amount.optional(),
    exemptionReason: z.string().trim().min(3, "Indiquez la raison (3 caractères au moins).").max(200).optional(),
    effectiveOn: isoDate.optional(),
  })
  .strict();
const cancelInput = z.object({ reason: z.string().trim().min(3, "Indiquez le motif de l'annulation (3 caractères au moins).").max(200) }).strict();

export interface TariffView {
  id: string;
  label: string;
  amount: string;
  categoryId: string | null;
  categoryName: string | null;
  membershipCount: number;
}

export interface CampaignView {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  effectiveMode: MembershipMode;
  tariffs: TariffView[];
  membershipCount: number;
  /** Les dates et le mode ne changent plus dès qu'une adhésion existe. */
  locked: boolean;
}

export interface MembershipView {
  id: string;
  campaignId: string;
  campaignName: string;
  memberId: string;
  memberName: string;
  tariffId: string | null;
  tariffLabel: string | null;
  expectedAmount: string;
  exemptionReason: string | null;
  status: MembershipStatus;
  effectiveOn: string | null;
  effectiveOrigin: MembershipOrigin | null;
  cancelReason: string | null;
  version: number;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const dec = (value: { toFixed(places: number): string }) => Money.parse(value.toFixed(2)).toString();

function rethrow(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  if (/Campaign_no_overlap|exclusion|23P01/i.test(text)) {
    throw new AccountingConflictError("Cette campagne chevauche une autre campagne : les périodes ne se recouvrent pas.");
  }
  if (/P2002|Unique constraint|23505|duplicate key/i.test(text)) {
    throw new AccountingConflictError(/Tariff|label/i.test(text) ? "Un tarif porte déjà ce libellé dans cette campagne." : "Ce membre a déjà une adhésion non annulée dans cette campagne.");
  }
  if (/P2003|Foreign key/i.test(text)) {
    throw new AccountingConflictError("Ce tarif est utilisé par des adhésions : il ne se supprime pas (modifiez-le pour les adhésions à venir).");
  }
  const message = triggerMessage(error);
  if (message) throw new AccountingConflictError(message);
  throw error;
}

const membershipInclude = {
  campaign: { select: { name: true, effectiveMode: true } },
  member: { select: { firstName: true, lastName: true } },
  tariff: { select: { label: true } },
} satisfies Prisma.MembershipInclude;
type LoadedMembership = Prisma.MembershipGetPayload<{ include: typeof membershipInclude }>;

const membershipView = (m: LoadedMembership): MembershipView => ({
  id: m.id,
  campaignId: m.campaignId,
  campaignName: m.campaign.name,
  memberId: m.memberId,
  memberName: `${m.member.lastName} ${m.member.firstName}`,
  tariffId: m.tariffId,
  tariffLabel: m.tariff?.label ?? null,
  expectedAmount: dec(m.expectedAmount),
  exemptionReason: m.exemptionReason,
  status: m.status,
  effectiveOn: m.effectiveOn ? day(m.effectiveOn) : null,
  effectiveOrigin: m.effectiveOrigin,
  cancelReason: m.cancelReason,
  version: m.version,
});

/** Campagnes, tarifs et adhésions (ADR 0023, tranche 3.2). Aucune écriture comptable ni créance n'est créée ici (CA-11). */
@Injectable()
export class MembershipsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  // --- Campagnes ---

  async listCampaigns(): Promise<CampaignView[]> {
    const rows = await this.prisma.campaign.findMany({
      orderBy: { startsOn: "desc" },
      include: { tariffs: { include: { category: { select: { name: true } }, _count: { select: { memberships: true } } }, orderBy: { label: "asc" } }, _count: { select: { memberships: true } } },
    });
    return rows.map((row) => this.campaignView(row));
  }

  async getCampaign(id: string): Promise<CampaignView> {
    return (await this.listCampaigns()).find((c) => c.id === id) ?? (() => { throw new AccountingNotFoundError("Campagne"); })();
  }

  async createCampaign(body: unknown, actorId: string): Promise<CampaignView> {
    const input = parse(campaignInput, body);
    const effectiveMode = input.effectiveMode ?? ((await this.settings.current("membership")).effectiveMode as MembershipMode);
    const created = await this.prisma.campaign
      .create({ data: { name: input.name, startsOn: asDate(input.startsOn), endsOn: asDate(input.endsOn), effectiveMode, createdBy: actorId } })
      .catch(rethrow);
    await this.audit.record({ action: "campaign.created", objectType: "Campaign", objectId: created.id, actorId, details: { effectiveMode } });
    return this.getCampaign(created.id);
  }

  async updateCampaign(id: string, body: unknown, actorId: string): Promise<CampaignView> {
    const patch = parse(campaignPatch, body);
    const current = await this.prisma.campaign.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Campagne");
    const startsOn = patch.startsOn ?? day(current.startsOn);
    const endsOn = patch.endsOn ?? day(current.endsOn);
    if (startsOn > endsOn) throw new AccountingConflictError("La fin précède le début.");
    await this.prisma.campaign
      .update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.startsOn !== undefined && { startsOn: asDate(patch.startsOn) }),
          ...(patch.endsOn !== undefined && { endsOn: asDate(patch.endsOn) }),
          ...(patch.effectiveMode !== undefined && { effectiveMode: patch.effectiveMode }),
        },
      })
      .catch(rethrow);
    await this.audit.record({ action: "campaign.updated", objectType: "Campaign", objectId: id, actorId, details: { fields: Object.keys(patch) } });
    return this.getCampaign(id);
  }

  // --- Tarifs ---

  async addTariff(campaignId: string, body: unknown, actorId: string): Promise<CampaignView> {
    const input = parse(tariffInput, body);
    if (!(await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } }))) throw new AccountingNotFoundError("Campagne");
    await this.prisma.tariff.create({ data: { campaignId, label: input.label, amount: input.amount, categoryId: input.categoryId ?? null } }).catch(rethrow);
    await this.audit.record({ action: "campaign.tariff.added", objectType: "Campaign", objectId: campaignId, actorId, details: { label: input.label } });
    return this.getCampaign(campaignId);
  }

  /** Modifie un tarif : les adhésions existantes gardent leur montant attendu (figé à la création). */
  async updateTariff(id: string, body: unknown, actorId: string): Promise<CampaignView> {
    const patch = parse(tariffPatch, body);
    const current = await this.prisma.tariff.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Tarif");
    await this.prisma.tariff
      .update({
        where: { id },
        data: {
          ...(patch.label !== undefined && { label: patch.label }),
          ...(patch.amount !== undefined && { amount: patch.amount }),
          ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
        },
      })
      .catch(rethrow);
    await this.audit.record({ action: "campaign.tariff.updated", objectType: "Campaign", objectId: current.campaignId, actorId, details: { fields: Object.keys(patch) } });
    return this.getCampaign(current.campaignId);
  }

  async removeTariff(id: string, actorId: string): Promise<CampaignView> {
    const current = await this.prisma.tariff.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Tarif");
    await this.prisma.tariff.delete({ where: { id } }).catch(rethrow);
    await this.audit.record({ action: "campaign.tariff.removed", objectType: "Campaign", objectId: current.campaignId, actorId, details: { label: current.label } });
    return this.getCampaign(current.campaignId);
  }

  // --- Adhésions ---

  async listMemberships(campaignId: string): Promise<MembershipView[]> {
    if (!(await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } }))) throw new AccountingNotFoundError("Campagne");
    const rows = await this.prisma.membership.findMany({
      where: { campaignId },
      include: membershipInclude,
      orderBy: [{ member: { lastName: "asc" } }, { member: { firstName: "asc" } }],
    });
    return rows.map(membershipView);
  }

  async listForMember(memberId: string): Promise<MembershipView[]> {
    const rows = await this.prisma.membership.findMany({ where: { memberId }, include: membershipInclude, orderBy: { campaign: { startsOn: "desc" } } });
    return rows.map(membershipView);
  }

  /** Inscrit un membre à une campagne : montant attendu figé, état selon le mode de la campagne ; aucune écriture comptable. */
  async createMembership(campaignId: string, body: unknown, actorId: string): Promise<MembershipView> {
    const input = parse(membershipInput, body);
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new AccountingNotFoundError("Campagne");
    const tariff = await this.prisma.tariff.findUnique({ where: { id: input.tariffId } });
    if (!tariff || tariff.campaignId !== campaignId) throw new AccountingNotFoundError("Tarif de cette campagne");
    const member = await this.prisma.member.findUnique({ where: { id: input.memberId }, select: { id: true, status: true, anonymizedAt: true, categoryId: true } });
    if (!member) throw new AccountingNotFoundError("Membre");

    const expected = input.expectedAmount ?? dec(tariff.amount);
    if (Money.parse(expected).equals(Money.parse(dec(tariff.amount))) === false && !input.exemptionReason) {
      throw new AccountingConflictError("Le montant diffère du tarif : indiquez la raison (exonération, remise…).");
    }

    const today = day(new Date());
    let effective: { effectiveOn: string; origin: MembershipOrigin } | null = null;
    if (Money.parse(expected).isZero()) {
      effective = { effectiveOn: this.clamp(today, campaign), origin: "EXEMPTION" };
    } else if (campaign.effectiveMode === "START_DATE") {
      const wanted = input.effectiveOn && input.effectiveOn > day(campaign.startsOn) ? input.effectiveOn : day(campaign.startsOn);
      if (wanted > day(campaign.endsOn)) throw new AccountingConflictError("La date d'effet doit tomber dans la campagne.");
      effective = { effectiveOn: wanted, origin: "START_DATE" };
    }

    const created = await this.prisma.membership
      .create({
        data: {
          campaignId,
          memberId: input.memberId,
          tariffId: tariff.id,
          expectedAmount: expected,
          exemptionReason: input.exemptionReason ?? null,
          createdBy: actorId,
          ...(effective && { status: "EFFECTIVE", effectiveOn: asDate(effective.effectiveOn), effectiveOrigin: effective.origin }),
        },
        include: membershipInclude,
      })
      .catch(rethrow);
    await this.audit.record({ action: "membership.created", objectType: "Membership", objectId: created.id, actorId, details: { campaignId, status: created.status } });
    return membershipView(created);
  }

  /** Validation par le bureau (mode « à la validation ») : l'adhésion devient effective, la validation en est l'origine. */
  async validate(id: string, actorId: string): Promise<MembershipView> {
    const current = await this.loadMembership(id);
    if (current.campaign.effectiveMode !== "VALIDATION") {
      throw new AccountingConflictError("Cette campagne ne fonctionne pas par validation : l'adhésion devient effective selon le mode choisi (règlement ou date de début).");
    }
    if (current.status !== "PENDING") throw new AccountingConflictError("Seule une adhésion en attente se valide.");
    const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id: current.campaignId } });
    await this.prisma.membership
      .update({ where: { id }, data: { status: "EFFECTIVE", effectiveOn: asDate(this.clamp(day(new Date()), campaign)), effectiveOrigin: "VALIDATION", version: { increment: 1 } } })
      .catch(rethrow);
    await this.audit.record({ action: "membership.validated", objectType: "Membership", objectId: id, actorId });
    return membershipView(await this.loadMembership(id));
  }

  async cancel(id: string, body: unknown, actorId: string): Promise<MembershipView> {
    const { reason } = parse(cancelInput, body);
    const current = await this.loadMembership(id);
    if (current.status === "CANCELLED") throw new AccountingConflictError("Cette adhésion est déjà annulée.");
    await this.prisma.membership
      .update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, effectiveOn: null, effectiveOrigin: null, version: { increment: 1 } } })
      .catch(rethrow);
    await this.audit.record({ action: "membership.cancelled", objectType: "Membership", objectId: id, actorId, justification: reason });
    return membershipView(await this.loadMembership(id));
  }

  /** Une date d'effet reste dans la campagne : avant le début elle devient le début, après la fin la fin. */
  private clamp(date: string, campaign: { startsOn: Date; endsOn: Date }): string {
    const start = day(campaign.startsOn);
    const end = day(campaign.endsOn);
    return date < start ? start : date > end ? end : date;
  }

  private async loadMembership(id: string): Promise<LoadedMembership> {
    const row = await this.prisma.membership.findUnique({ where: { id }, include: membershipInclude });
    if (!row) throw new AccountingNotFoundError("Adhésion");
    return row;
  }

  private campaignView(row: {
    id: string;
    name: string;
    startsOn: Date;
    endsOn: Date;
    effectiveMode: MembershipMode;
    tariffs: { id: string; label: string; amount: { toFixed(places: number): string }; categoryId: string | null; category: { name: string } | null; _count: { memberships: number } }[];
    _count: { memberships: number };
  }): CampaignView {
    return {
      id: row.id,
      name: row.name,
      startsOn: day(row.startsOn),
      endsOn: day(row.endsOn),
      effectiveMode: row.effectiveMode,
      tariffs: row.tariffs.map((t) => ({ id: t.id, label: t.label, amount: dec(t.amount), categoryId: t.categoryId, categoryName: t.category?.name ?? null, membershipCount: t._count.memberships })),
      membershipCount: row._count.memberships,
      locked: row._count.memberships > 0,
    };
  }
}
