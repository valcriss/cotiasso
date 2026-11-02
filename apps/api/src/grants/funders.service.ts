import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { Funder, FunderType } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

const FUNDER_TYPES = ["LOCAL_AUTHORITY", "STATE", "FOUNDATION", "COMPANY", "OTHER"] as const;
const name = z.string().trim().min(1, "Nom obligatoire.").max(160, "Nom trop long (160 caractères).");
const email = z.union([z.literal(""), z.string().trim().email("Adresse email invalide.").max(200)]);
const text = (max: number) => z.string().trim().max(max);

const funderInput = z
  .object({
    name,
    type: z.enum(FUNDER_TYPES),
    contactName: text(160).default(""),
    email: email.default(""),
    phone: text(40).default(""),
    note: text(1000).default(""),
  })
  .strict();
const funderPatch = funderInput.partial().strict();

export interface FunderView {
  id: string;
  name: string;
  type: FunderType;
  contactName: string;
  email: string;
  phone: string;
  note: string;
  archived: boolean;
  grantCount: number;
}

const view = (funder: Funder & { _count: { grants: number } }): FunderView => ({
  id: funder.id,
  name: funder.name,
  type: funder.type,
  contactName: funder.contactName,
  email: funder.email,
  phone: funder.phone,
  note: funder.note,
  archived: funder.archivedAt !== null,
  grantCount: funder._count.grants,
});

/** Retire les clés non fournies : Prisma les lit comme « ne pas modifier » (exactOptionalPropertyTypes). */
function provided<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}

const include = { _count: { select: { grants: true } } } as const;

/**
 * Financeurs (ADR 0024, tranche 4.3a) : qui finance. Un financeur ne se supprime jamais : archivé, il ne reçoit plus de
 * nouvelle demande, mais ses subventions restent consultables.
 */
@Injectable()
export class FundersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<FunderView[]> {
    const funders = await this.prisma.funder.findMany({ include, orderBy: { name: "asc" } });
    return funders.map(view);
  }

  async create(body: unknown, actorId: string): Promise<FunderView> {
    const input = parse(funderInput, body);
    const funder = await this.guard(() => this.prisma.funder.create({ data: { ...input, createdBy: actorId }, include }));
    await this.audit.record({ action: "funder.created", objectType: "Funder", objectId: funder.id, actorId, details: { type: funder.type } });
    return view(funder);
  }

  async update(id: string, body: unknown, actorId: string): Promise<FunderView> {
    const patch = parse(funderPatch, body);
    await this.require(id);
    const funder = await this.guard(() => this.prisma.funder.update({ where: { id }, data: provided(patch), include }));
    await this.audit.record({ action: "funder.updated", objectType: "Funder", objectId: id, actorId, details: { fields: Object.keys(patch) } });
    return view(funder);
  }

  /** Archive un financeur : plus de nouvelle demande, l'historique reste. Définitif. */
  async archive(id: string, actorId: string): Promise<FunderView> {
    const current = await this.require(id);
    if (current.archivedAt) throw new AccountingConflictError("Ce financeur est déjà archivé.");
    const funder = await this.prisma.funder.update({ where: { id }, data: { archivedAt: new Date() }, include });
    await this.audit.record({ action: "funder.archived", objectType: "Funder", objectId: id, actorId, details: {} });
    return view(funder);
  }

  private async require(id: string): Promise<Funder> {
    const funder = await this.prisma.funder.findUnique({ where: { id } });
    if (!funder) throw new AccountingNotFoundError("Financeur");
    return funder;
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
      if (/Funder_name_unique|P2002|duplicate key|Unique constraint/i.test(text)) {
        throw new AccountingConflictError("Un financeur porte déjà ce nom. Ouvrez-le dans la liste plutôt que d'en créer un second.");
      }
      throw error;
    }
  }
}
