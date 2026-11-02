import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { Prisma, ThirdPartyKind } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import { parse } from "./schemas.js";

const name = z.string().trim().min(1, "Nom obligatoire.").max(120, "Nom trop long (120 caractères).");
const note = z.string().trim().max(500, "Note trop longue (500 caractères).");

const createInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MEMBER"), memberId: z.uuid("Adhérent invalide.") }).strict(),
  z.object({ kind: z.literal("FUNDER"), funderId: z.uuid("Financeur invalide.") }).strict(),
  z.object({ kind: z.enum(["SUPPLIER", "OTHER"]), name, note: note.optional() }).strict(),
]);
const patchInput = z.object({ name: name.optional(), note: note.optional() }).strict();
const balancesQuery = z.object({ fiscalYearId: z.uuid().optional() }).strict();

export interface ThirdPartyView {
  id: string;
  kind: ThirdPartyKind;
  /** Nom lu en direct pour un adhérent ou un financeur (un membre anonymisé n'est plus nommé). */
  name: string;
  memberId: string | null;
  funderId: string | null;
  note: string;
  archived: boolean;
}

export interface ThirdPartyRef {
  id: string;
  name: string;
  kind: ThirdPartyKind;
}

export interface ThirdPartyBalanceRow extends ThirdPartyRef {
  /** Solde net (débit − crédit) des comptes de tiers de l'exercice : positif = on vous doit, négatif = vous devez. */
  net: string;
  owedToYou: string;
  youOwe: string;
  accounts: { number: string; label: string; net: string }[];
}

export interface ThirdPartyBalances {
  fiscalYear: { id: string; label: string; start: string; end: string; status: "OPEN" | "CLOSING" | "CLOSED" };
  rows: ThirdPartyBalanceRow[];
  totals: { owedToYou: string; youOwe: string };
  /** Lignes des comptes de tiers sans tiers renseigné : à compléter si l'on veut suivre ces sommes par personne. */
  untracked: { lines: number; net: string };
  carryWarning: string | null;
}

export const thirdPartyInclude = { member: { select: { firstName: true, lastName: true, anonymizedAt: true } }, funder: { select: { name: true } } } satisfies Prisma.ThirdPartyInclude;
type Loaded = Prisma.ThirdPartyGetPayload<{ include: typeof thirdPartyInclude }>;

/** Nom affiché d'un tiers : lu en direct sur l'adhérent ou le financeur lié, pour que l'anonymisation d'un membre s'y répercute. */
export function thirdPartyName(tp: Loaded): string {
  if (tp.kind === "MEMBER" && tp.member) return tp.member.anonymizedAt ? "Ancien membre" : `${tp.member.firstName} ${tp.member.lastName}`.trim();
  if (tp.kind === "FUNDER" && tp.funder) return tp.funder.name;
  return tp.name;
}

const view = (tp: Loaded): ThirdPartyView => ({
  id: tp.id,
  kind: tp.kind,
  name: thirdPartyName(tp),
  memberId: tp.memberId,
  funderId: tp.funderId,
  note: tp.note,
  archived: tp.archivedAt !== null,
});

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Tiers (ADR 0030) : qui est concerné par une ligne d'écriture (adhérent, financeur, fournisseur, autre). Facultatif sur
 * une ligne, jamais supprimé. Aucun solde n'est stocké : les soldes par tiers se lisent dans les écritures.
 */
@Injectable()
export class ThirdPartiesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(includeArchived = false): Promise<ThirdPartyView[]> {
    const rows = await this.prisma.thirdParty.findMany({ where: includeArchived ? {} : { archivedAt: null }, include: thirdPartyInclude });
    return rows.map(view).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  async create(body: unknown, actorId: string): Promise<ThirdPartyView> {
    const input = parse(createInput, body);
    if (input.kind === "MEMBER") {
      const member = await this.prisma.member.findUnique({ where: { id: input.memberId }, include: { thirdParty: { include: thirdPartyInclude } } });
      if (!member) throw new AccountingNotFoundError("Adhérent");
      if (member.anonymizedAt) throw new AccountingConflictError("Cet adhérent est anonymisé : il ne peut plus être désigné comme tiers.");
      if (member.thirdParty) return view(member.thirdParty);
      return this.insert({ kind: "MEMBER", name: `${member.firstName} ${member.lastName}`.trim(), memberId: member.id }, actorId);
    }
    if (input.kind === "FUNDER") {
      const funder = await this.prisma.funder.findUnique({ where: { id: input.funderId }, include: { thirdParty: { include: thirdPartyInclude } } });
      if (!funder) throw new AccountingNotFoundError("Financeur");
      if (funder.thirdParty) return view(funder.thirdParty);
      return this.insert({ kind: "FUNDER", name: funder.name, funderId: funder.id }, actorId);
    }
    const existing = await this.findByName(this.prisma, input.name);
    if (existing) throw new AccountingConflictError(`« ${thirdPartyName(existing)} » existe déjà dans vos tiers : choisissez-le plutôt que d'en créer un second.`);
    return this.insert({ kind: input.kind, name: input.name, note: input.note ?? "" }, actorId);
  }

  async update(id: string, body: unknown, actorId: string): Promise<ThirdPartyView> {
    const patch = parse(patchInput, body);
    const current = await this.load(id);
    if (current.kind === "MEMBER" || current.kind === "FUNDER") {
      if (patch.name !== undefined) throw new AccountingConflictError("Le nom d'un adhérent ou d'un financeur se change dans sa propre fiche.");
    }
    if (current.archivedAt) throw new AccountingConflictError("Ce tiers est archivé : il ne change plus.");
    if (patch.name && patch.name.toLowerCase() !== current.name.toLowerCase()) {
      const clash = await this.findByName(this.prisma, patch.name);
      if (clash && clash.id !== id) throw new AccountingConflictError(`« ${patch.name} » existe déjà dans vos tiers.`);
    }
    const updated = await this.prisma.thirdParty
      .update({ where: { id }, data: { ...(patch.name !== undefined && { name: patch.name }), ...(patch.note !== undefined && { note: patch.note }) }, include: thirdPartyInclude })
      .catch((error) => this.rethrow(error));
    await this.audit.record({ action: "third-party.updated", objectType: "ThirdParty", objectId: id, actorId, details: { fields: Object.keys(patch) } });
    return view(updated);
  }

  async archive(id: string, actorId: string): Promise<ThirdPartyView> {
    const current = await this.load(id);
    if (current.archivedAt) throw new AccountingConflictError("Ce tiers est déjà archivé.");
    const updated = await this.prisma.thirdParty.update({ where: { id }, data: { archivedAt: new Date() }, include: thirdPartyInclude });
    await this.audit.record({ action: "third-party.archived", objectType: "ThirdParty", objectId: id, actorId });
    return view(updated);
  }

  /** Vérifie que les tiers désignés existent et ne sont pas archivés (brouillons et situation d'ouverture). */
  async assertUsable(ids: string[], db: Pick<PrismaService, "thirdParty"> = this.prisma): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await db.thirdParty.findMany({ where: { id: { in: unique } }, select: { id: true, archivedAt: true } });
    const byId = new Map(found.map((tp) => [tp.id, tp]));
    for (const id of unique) {
      const tp = byId.get(id);
      if (!tp) throw new AccountingConflictError("Un tiers choisi n'existe pas. Rechargez la liste des tiers et choisissez-en un autre.");
      if (tp.archivedAt) throw new AccountingConflictError("Un tiers choisi est archivé : choisissez-en un autre, ou créez-le à nouveau.");
    }
  }

  /** Tiers « fournisseur » ou « autre » de ce nom (sans tenir compte de la casse), créé s'il n'existe pas ; sert à la situation d'ouverture. */
  async ensureNamed(db: Prisma.TransactionClient, wanted: string, kind: "SUPPLIER" | "OTHER", actorId: string): Promise<{ id: string; created: boolean }> {
    const existing = await this.findByName(db, wanted);
    if (existing) {
      if (existing.archivedAt) throw new AccountingConflictError(`« ${thirdPartyName(existing)} » est archivé dans vos tiers : choisissez un autre nom.`);
      return { id: existing.id, created: false };
    }
    const created = await db.thirdParty.create({ data: { kind, name: wanted, createdBy: actorId }, select: { id: true } });
    return { id: created.id, created: true };
  }

  async balances(rawQuery: unknown): Promise<ThirdPartyBalances> {
    const { fiscalYearId } = parse(balancesQuery, rawQuery ?? {});
    const year = fiscalYearId
      ? await this.prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } })
      : ((await this.prisma.fiscalYear.findFirst({ where: { status: "OPEN" }, orderBy: { start: "desc" } })) ?? (await this.prisma.fiscalYear.findFirst({ orderBy: { start: "desc" } })));
    if (!year) throw new AccountingNotFoundError("Exercice");

    const rows = await this.prisma.$queryRaw<{ thirdPartyId: string; number: string; label: string; net: string }[]>`
      SELECT l."thirdPartyId" AS "thirdPartyId", a."number" AS number, a."label" AS label, (sum(l."debit") - sum(l."credit"))::text AS net
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "Account" a ON a."id" = l."accountId"
      WHERE e."fiscalYearId" = ${year.id}::uuid AND e."status" IN ('POSTED', 'REVERSED')
        AND l."thirdPartyId" IS NOT NULL AND a."number" LIKE '4%'
      GROUP BY l."thirdPartyId", a."number", a."label"
      ORDER BY a."number"`;
    const untracked = await this.prisma.$queryRaw<{ lines: bigint; net: string | null }[]>`
      SELECT count(*) AS lines, (sum(l."debit") - sum(l."credit"))::text AS net
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "Account" a ON a."id" = l."accountId"
      WHERE e."fiscalYearId" = ${year.id}::uuid AND e."status" = 'POSTED'
        AND l."thirdPartyId" IS NULL AND a."number" LIKE '4%'`;

    const parties = await this.prisma.thirdParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.thirdPartyId))] } }, include: thirdPartyInclude });
    const byId = new Map(parties.map((tp) => [tp.id, tp]));
    const grouped = new Map<string, ThirdPartyBalanceRow & { sum: Money }>();
    for (const row of rows) {
      const tp = byId.get(row.thirdPartyId);
      if (!tp) continue;
      const net = Money.parse(row.net);
      const entry = grouped.get(tp.id) ?? { id: tp.id, name: thirdPartyName(tp), kind: tp.kind, net: "0.00", owedToYou: "0.00", youOwe: "0.00", accounts: [], sum: Money.zero() };
      entry.sum = entry.sum.add(net);
      entry.accounts.push({ number: row.number, label: row.label, net: net.toString() });
      grouped.set(tp.id, entry);
    }
    let owed = Money.zero();
    let due = Money.zero();
    const result: ThirdPartyBalanceRow[] = [];
    for (const { sum, ...entry } of grouped.values()) {
      if (sum.isZero()) continue;
      const positive = sum.isPositive();
      const abs = positive ? sum : Money.zero().subtract(sum);
      if (positive) owed = owed.add(abs);
      else due = due.add(abs);
      result.push({ ...entry, net: sum.toString(), owedToYou: positive ? abs.toString() : "0.00", youOwe: positive ? "0.00" : abs.toString() });
    }
    result.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    const previous = await this.prisma.fiscalYear.findFirst({ where: { end: { lt: year.start } }, orderBy: { end: "desc" } });
    const carryWarning =
      previous && previous.status !== "CLOSED"
        ? `L'exercice précédent (« ${previous.label} ») n'est pas clôturé : ses sommes à recevoir et à payer ne sont pas encore reportées ici.`
        : null;
    return {
      fiscalYear: { id: year.id, label: year.label, start: day(year.start), end: day(year.end), status: year.status },
      rows: result,
      totals: { owedToYou: owed.toString(), youOwe: due.toString() },
      untracked: { lines: Number(untracked[0]?.lines ?? 0), net: Money.parse(untracked[0]?.net ?? "0").toString() },
      carryWarning,
    };
  }

  private async insert(data: { kind: ThirdPartyKind; name: string; memberId?: string; funderId?: string; note?: string }, actorId: string): Promise<ThirdPartyView> {
    const created = await this.prisma.thirdParty.create({ data: { ...data, createdBy: actorId }, include: thirdPartyInclude }).catch((error) => this.rethrow(error));
    await this.audit.record({ action: "third-party.created", objectType: "ThirdParty", objectId: created.id, actorId, details: { kind: created.kind } });
    return view(created);
  }

  private findByName(db: Pick<PrismaService, "thirdParty">, wanted: string) {
    return db.thirdParty.findFirst({ where: { kind: { in: ["SUPPLIER", "OTHER"] }, name: { equals: wanted, mode: "insensitive" } }, include: thirdPartyInclude });
  }

  private async load(id: string): Promise<Loaded> {
    const found = await this.prisma.thirdParty.findUnique({ where: { id }, include: thirdPartyInclude });
    if (!found) throw new AccountingNotFoundError("Tiers");
    return found;
  }

  private rethrow(error: unknown): never {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
    if (/P2002|Unique constraint|23505|duplicate key/i.test(`${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`)) {
      throw new AccountingConflictError("Ce tiers existe déjà. Rechargez la liste et choisissez-le.");
    }
    throw error;
  }
}
