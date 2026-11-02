import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { MemberStatus, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");

const name = (label: string) => z.string().trim().min(1, `${label} obligatoire.`).max(80, `${label} trop long (80 caractères).`);
const optionalText = (max: number) => z.string().trim().max(max, `Texte trop long (${max} caractères).`).nullish();

const memberFields = {
  firstName: name("Prénom"),
  lastName: name("Nom"),
  email: z.string().trim().toLowerCase().email("Adresse email invalide.").max(200).nullish(),
  phone: optionalText(30),
  addressLine: optionalText(200),
  postalCode: optionalText(10),
  city: optionalText(80),
  categoryId: z.uuid().nullish(),
  joinedOn: isoDate.nullish(),
  note: optionalText(500),
};

const memberInput = z.object(memberFields).strict();

const memberPatch = z
  .object(memberFields)
  .partial()
  .extend({ version: z.number().int().min(1), status: z.enum(["ACTIVE", "FORMER"]).optional(), leftOn: isoDate.nullish() })
  .strict();

const anonymizeInput = z.object({ reason: z.string().trim().min(5, "Indiquez le motif de l'anonymisation (5 caractères au moins).").max(200) }).strict();

const listQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(["ACTIVE", "FORMER"]).optional(),
    categoryId: z.uuid().optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const categoryInput = z.object({ name: z.string().trim().min(1, "Nom obligatoire.").max(60, "Nom trop long (60 caractères).") }).strict();
const categoryPatch = z
  .object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() })
  .strict();

const officeInput = z
  .object({
    title: z.string().trim().min(1, "Intitulé obligatoire.").max(80, "Intitulé trop long (80 caractères)."),
    startsOn: isoDate,
    endsOn: isoDate.nullish(),
    note: optionalText(200),
  })
  .strict()
  .refine((office) => !office.endsOn || office.endsOn >= office.startsOn, { message: "La fin précède le début.", path: ["endsOn"] });
const officePatch = z
  .object({ title: z.string().trim().min(1).max(80).optional(), startsOn: isoDate.optional(), endsOn: isoDate.nullable().optional(), note: optionalText(200) })
  .strict();

export interface CategoryView {
  id: string;
  name: string;
  active: boolean;
  memberCount: number;
}

export interface OfficeView {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
  current: boolean;
}

export interface MemberView {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: MemberStatus;
  joinedOn: string | null;
  leftOn: string | null;
  /** Un compte de connexion est lié à ce membre. */
  hasAccount: boolean;
  note: string | null;
  anonymized: boolean;
  /** Fonctions en cours (Président, Trésorier…). */
  currentOffices: string[];
  version: number;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);

const include = {
  category: { select: { name: true } },
  offices: { select: { title: true, startsOn: true, endsOn: true } },
} satisfies Prisma.MemberInclude;
type Loaded = Prisma.MemberGetPayload<{ include: typeof include }>;

const isCurrent = (office: { startsOn: Date; endsOn: Date | null }, today: string) => day(office.startsOn) <= today && (office.endsOn === null || day(office.endsOn) >= today);

function view(member: Loaded, today = day(new Date())): MemberView {
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    phone: member.phone,
    addressLine: member.addressLine,
    postalCode: member.postalCode,
    city: member.city,
    categoryId: member.categoryId,
    categoryName: member.category?.name ?? null,
    status: member.status,
    joinedOn: member.joinedOn ? day(member.joinedOn) : null,
    leftOn: member.leftOn ? day(member.leftOn) : null,
    hasAccount: member.userId !== null,
    note: member.note,
    anonymized: member.anonymizedAt !== null,
    currentOffices: member.offices.filter((o) => isCurrent(o, today)).map((o) => o.title),
    version: member.version,
  };
}

function rethrow(error: unknown): never {
  if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError) throw error;
  const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  if (/Member_email_unique|email/i.test(text) && /P2002|Unique constraint|23505|duplicate key/i.test(text)) {
    throw new AccountingConflictError("Un membre a déjà cette adresse email : vérifiez qu'il ne s'agit pas d'un doublon.");
  }
  if (/MemberCategory_name_key|name/i.test(text) && /P2002|Unique constraint|23505|duplicate key/i.test(text)) {
    throw new AccountingConflictError("Une catégorie porte déjà ce nom.");
  }
  if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Catégorie inexistante.");
  const message = triggerMessage(error);
  if (message) throw new AccountingConflictError(message);
  throw error;
}

/** Membres, catégories, fonctions et mandats (ADR 0023, tranche 3.1). */
@Injectable()
export class MembersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(query: unknown): Promise<{ members: MemberView[]; next: string | null }> {
    const q = parse(listQuery, query);
    const rows = await this.prisma.member.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(q.categoryId && { categoryId: q.categoryId }),
        ...(q.q && {
          OR: [
            { firstName: { contains: q.q, mode: "insensitive" } },
            { lastName: { contains: q.q, mode: "insensitive" } },
            { email: { contains: q.q, mode: "insensitive" } },
          ],
        }),
      },
      include,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      take: q.limit + 1,
      ...(q.after && { cursor: { id: q.after }, skip: 1 }),
    });
    const page = rows.slice(0, q.limit);
    return { members: page.map((m) => view(m)), next: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async get(id: string): Promise<{ member: MemberView; offices: OfficeView[] }> {
    const member = await this.load(id);
    const offices = await this.prisma.memberOffice.findMany({ where: { memberId: id }, orderBy: [{ startsOn: "desc" }, { id: "asc" }] });
    const today = day(new Date());
    return {
      member: view(member, today),
      offices: offices.map((o) => ({ id: o.id, title: o.title, startsOn: day(o.startsOn), endsOn: o.endsOn ? day(o.endsOn) : null, note: o.note, current: isCurrent(o, today) })),
    };
  }

  async create(body: unknown, actorId: string): Promise<MemberView> {
    const input = parse(memberInput, body);
    const created = await this.prisma.member
      .create({ data: this.data(input), include })
      .catch(rethrow);
    await this.audit.record({ action: "member.created", objectType: "Member", objectId: created.id, actorId });
    return view(created);
  }

  async update(id: string, body: unknown, actorId: string): Promise<MemberView> {
    const { version, status, leftOn, ...fields } = parse(memberPatch, body) as { version: number; status?: MemberStatus; leftOn?: string | null } & Record<string, unknown>;
    const current = await this.load(id);
    if (current.anonymizedAt && Object.keys(fields).length > 0) {
      throw new AccountingConflictError("Ce membre est anonymisé : ses données personnelles ne changent plus.");
    }
    const today = day(new Date());
    const data: Prisma.MemberUncheckedUpdateManyInput = { ...this.data(fields as never), version: { increment: 1 } };
    if (status === "FORMER") {
      data.status = "FORMER";
      data.leftOn = asDate(leftOn ?? today);
    } else if (status === "ACTIVE") {
      data.status = "ACTIVE";
      data.leftOn = null;
    } else if (leftOn !== undefined) {
      data.leftOn = asDate(leftOn);
    }
    const changed = await this.prisma.member.updateMany({ where: { id, version }, data }).catch(rethrow);
    if (changed.count !== 1) {
      throw new AccountingConflictError("Cette fiche a été modifiée entre-temps. Rechargez-la avant de l'enregistrer.");
    }
    await this.audit.record({
      action: "member.updated",
      objectType: "Member",
      objectId: id,
      actorId,
      details: { fields: [...Object.keys(fields), ...(status ? ["status"] : []), ...(leftOn !== undefined ? ["leftOn"] : [])] },
    });
    return view(await this.load(id));
  }

  /** Oubli : remplace les données personnelles d'un membre sorti ; irréversible, l'historique est conservé. */
  async anonymize(id: string, body: unknown, actorId: string): Promise<MemberView> {
    const { reason } = parse(anonymizeInput, body);
    const current = await this.load(id);
    if (current.anonymizedAt) throw new AccountingConflictError("Ce membre est déjà anonymisé.");
    if (current.status !== "FORMER") {
      throw new AccountingConflictError("Seul un membre sorti peut être anonymisé : marquez-le d'abord comme sorti.");
    }
    await this.prisma.member
      .update({
        where: { id },
        data: { firstName: "Ancien", lastName: "membre", email: null, phone: null, addressLine: null, postalCode: null, city: null, note: null, userId: null, anonymizedAt: new Date(), version: { increment: 1 } },
      })
      .catch(rethrow);
    await this.audit.record({ action: "member.anonymized", objectType: "Member", objectId: id, actorId, justification: reason });
    return view(await this.load(id));
  }

  // --- Catégories ---

  async listCategories(): Promise<CategoryView[]> {
    const rows = await this.prisma.memberCategory.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { members: true } } } });
    return rows.map((c) => ({ id: c.id, name: c.name, active: c.active, memberCount: c._count.members }));
  }

  async createCategory(body: unknown, actorId: string): Promise<CategoryView> {
    const input = parse(categoryInput, body);
    const created = await this.prisma.memberCategory.create({ data: { name: input.name, createdBy: actorId } }).catch(rethrow);
    await this.audit.record({ action: "member.category.created", objectType: "MemberCategory", objectId: created.id, actorId });
    return { id: created.id, name: created.name, active: created.active, memberCount: 0 };
  }

  async updateCategory(id: string, body: unknown, actorId: string): Promise<CategoryView> {
    const patch = parse(categoryPatch, body);
    if (!(await this.prisma.memberCategory.findUnique({ where: { id }, select: { id: true } }))) throw new AccountingNotFoundError("Catégorie");
    await this.prisma.memberCategory
      .update({ where: { id }, data: { ...(patch.name !== undefined && { name: patch.name }), ...(patch.active !== undefined && { active: patch.active }) } })
      .catch(rethrow);
    await this.audit.record({ action: "member.category.updated", objectType: "MemberCategory", objectId: id, actorId, details: { fields: Object.keys(patch) } });
    return (await this.listCategories()).find((c) => c.id === id)!;
  }

  // --- Fonctions et mandats ---

  async addOffice(memberId: string, body: unknown, actorId: string): Promise<OfficeView> {
    const input = parse(officeInput, body);
    const member = await this.load(memberId);
    if (member.anonymizedAt) throw new AccountingConflictError("Ce membre est anonymisé : on n'y ajoute plus de fonction.");
    const created = await this.prisma.memberOffice
      .create({ data: { memberId, title: input.title, startsOn: asDate(input.startsOn)!, endsOn: asDate(input.endsOn), note: input.note ?? null, createdBy: actorId } })
      .catch(rethrow);
    await this.audit.record({ action: "member.office.added", objectType: "Member", objectId: memberId, actorId, details: { title: input.title } });
    return this.officeView(created);
  }

  async updateOffice(id: string, body: unknown, actorId: string): Promise<OfficeView> {
    const patch = parse(officePatch, body);
    const current = await this.prisma.memberOffice.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Fonction");
    const updated = await this.prisma.memberOffice
      .update({
        where: { id },
        data: {
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.startsOn !== undefined && { startsOn: asDate(patch.startsOn)! }),
          ...(patch.endsOn !== undefined && { endsOn: asDate(patch.endsOn) }),
          ...(patch.note !== undefined && { note: patch.note ?? null }),
        },
      })
      .catch(rethrow);
    await this.audit.record({ action: "member.office.updated", objectType: "Member", objectId: current.memberId, actorId, details: { fields: Object.keys(patch) } });
    return this.officeView(updated);
  }

  async removeOffice(id: string, actorId: string): Promise<void> {
    const current = await this.prisma.memberOffice.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Fonction");
    await this.prisma.memberOffice.delete({ where: { id } });
    await this.audit.record({ action: "member.office.removed", objectType: "Member", objectId: current.memberId, actorId, details: { title: current.title } });
  }

  private officeView(o: { id: string; title: string; startsOn: Date; endsOn: Date | null; note: string | null }): OfficeView {
    return { id: o.id, title: o.title, startsOn: day(o.startsOn), endsOn: o.endsOn ? day(o.endsOn) : null, note: o.note, current: isCurrent(o, day(new Date())) };
  }

  private data(input: Partial<z.infer<typeof memberInput>>): Prisma.MemberUncheckedCreateInput {
    return {
      ...(input.firstName !== undefined && { firstName: input.firstName }),
      ...(input.lastName !== undefined && { lastName: input.lastName }),
      ...(input.email !== undefined && { email: input.email ?? null }),
      ...(input.phone !== undefined && { phone: input.phone ?? null }),
      ...(input.addressLine !== undefined && { addressLine: input.addressLine ?? null }),
      ...(input.postalCode !== undefined && { postalCode: input.postalCode ?? null }),
      ...(input.city !== undefined && { city: input.city ?? null }),
      ...(input.categoryId !== undefined && { categoryId: input.categoryId ?? null }),
      ...(input.joinedOn !== undefined && { joinedOn: asDate(input.joinedOn) }),
      ...(input.note !== undefined && { note: input.note ?? null }),
    } as Prisma.MemberUncheckedCreateInput;
  }

  private async load(id: string): Promise<Loaded> {
    const member = await this.prisma.member.findUnique({ where: { id }, include });
    if (!member) throw new AccountingNotFoundError("Membre");
    return member;
  }
}
