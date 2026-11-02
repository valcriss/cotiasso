import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { assertProjectAccess } from "../accounting/project-access.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { ProjectAccess } from "../auth/auth.guard.js";
import type { Funder, Grant, GrantProjectAllocation, GrantResidual, GrantStatus, Prisma, Project } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Date inexistante.");
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (12 chiffres et 2 décimales au plus).")
  .refine((value) => Number(value) > 0, "Le montant doit être positif.");
const title = z.string().trim().min(1, "Objet obligatoire.").max(200, "Objet trop long (200 caractères).");
const reference = z.string().trim().min(1, "Référence vide.").max(80, "Référence trop longue (80 caractères).");
const reason = z.string().trim().min(1, "Indiquez le motif.").max(500, "Motif trop long (500 caractères).");

const allocationsSchema = z
  .array(z.object({ projectId: z.uuid("Projet invalide."), amount }).strict())
  .max(50, "50 projets au plus.")
  .refine((list) => new Set(list.map((a) => a.projectId)).size === list.length, "Un projet ne peut figurer qu'une fois.");

const periodOrder = (value: { periodStart?: string | null | undefined; periodEnd?: string | null | undefined }) =>
  !value.periodStart || !value.periodEnd || value.periodStart <= value.periodEnd;

const createInput = z
  .object({
    funderId: z.uuid("Financeur invalide."),
    title,
    reference: reference.nullish(),
    requestedAmount: amount,
    requestedOn: isoDate.nullish(),
    periodStart: isoDate.nullish(),
    periodEnd: isoDate.nullish(),
    conditions: z.string().trim().max(4000).default(""),
    note: z.string().trim().max(2000).default(""),
    allocations: allocationsSchema.default([]),
  })
  .strict()
  .refine(periodOrder, { path: ["periodEnd"], message: "La fin de la période précède son début." });

const patchInput = z
  .object({
    funderId: z.uuid("Financeur invalide.").optional(),
    title: title.optional(),
    reference: reference.nullable().optional(),
    requestedAmount: amount.optional(),
    requestedOn: isoDate.nullable().optional(),
    periodStart: isoDate.nullable().optional(),
    periodEnd: isoDate.nullable().optional(),
    conditions: z.string().trim().max(4000).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

const allocationsInput = z.object({ allocations: allocationsSchema }).strict();
const grantInput = z.object({ grantedAmount: amount, decidedOn: isoDate, allocations: allocationsSchema.optional() }).strict();
const refuseInput = z.object({ decidedOn: isoDate, reason }).strict();
const cancelInput = z.object({ reason }).strict();
const closeInput = z
  .object({
    closedOn: isoDate,
    residual: z.enum(["REFUND", "KEPT_WITH_AGREEMENT", "NONE"]),
    note: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine((value) => value.residual === "NONE" || value.note.length > 0, {
    path: ["note"],
    message: "Précisez en quelques mots ce qui est prévu pour le reliquat (montant, accord du financeur, échéance).",
  });
const listQuery = z
  .object({
    status: z.enum(["REQUESTED", "UNDER_REVIEW", "GRANTED", "REFUSED", "CLOSED", "CANCELLED"]).optional(),
    funderId: z.uuid().optional(),
    projectId: z.uuid().optional(),
  })
  .strict();

export interface GrantAllocationView {
  projectId: string;
  projectCode: string;
  projectName: string;
  amount: string;
}

export interface GrantView {
  id: string;
  funder: { id: string; name: string; type: Funder["type"]; archived: boolean };
  reference: string | null;
  title: string;
  status: GrantStatus;
  requestedAmount: string;
  grantedAmount: string | null;
  requestedOn: string | null;
  decidedOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  conditions: string;
  note: string;
  /** Motif du refus ou de l'annulation. */
  reason: string | null;
  closedOn: string | null;
  residual: GrantResidual | null;
  residualNote: string | null;
  allocations: GrantAllocationView[];
  /** Somme des parts affectées aux projets. */
  allocatedTotal: string;
}

type Row = Grant & {
  funder: Pick<Funder, "id" | "name" | "type" | "archivedAt">;
  allocations: (GrantProjectAllocation & { project: Pick<Project, "code" | "name"> })[];
};

const include = {
  funder: { select: { id: true, name: true, type: true, archivedAt: true } },
  allocations: { include: { project: { select: { code: true, name: true } } } },
} as const;

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const asDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);

const view = (row: Row): GrantView => {
  const allocations = [...row.allocations]
    .sort((a, b) => a.project.code.localeCompare(b.project.code))
    .map((a) => ({ projectId: a.projectId, projectCode: a.project.code, projectName: a.project.name, amount: a.amount.toFixed(2) }));
  return {
    id: row.id,
    funder: { id: row.funder.id, name: row.funder.name, type: row.funder.type, archived: row.funder.archivedAt !== null },
    reference: row.reference,
    title: row.title,
    status: row.status,
    requestedAmount: row.requestedAmount.toFixed(2),
    grantedAmount: row.grantedAmount ? row.grantedAmount.toFixed(2) : null,
    requestedOn: day(row.requestedOn),
    decidedOn: day(row.decidedOn),
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    conditions: row.conditions,
    note: row.note,
    reason: row.reason,
    closedOn: day(row.closedOn),
    residual: row.residual,
    residualNote: row.residualNote,
    allocations,
    allocatedTotal: allocations.reduce((sum, a) => sum.add(Money.parse(a.amount)), Money.zero()).toString(),
  };
};

const DECIDABLE: GrantStatus[] = ["REQUESTED", "UNDER_REVIEW"];

/**
 * Subventions (ADR 0024, tranche 4.3a) : demandées, instruites, accordées ou refusées, puis clôturées avec le sort du
 * reliquat. C'est un suivi de gestion : aucune écriture comptable. Les garanties (état qui n'avance que dans un sens,
 * somme des parts égale au montant accordé, accord figé) sont dans la base ; le service ajoute les messages lisibles.
 * Lecture filtrée par la portée projet : une subvention n'est visible que si elle finance un projet de la portée.
 */
@Injectable()
export class GrantsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private scope(access?: ProjectAccess): Prisma.GrantWhereInput {
    return !access || access.all ? {} : { allocations: { some: { projectId: { in: [...access.ids] } } } };
  }

  async list(rawQuery: unknown, access?: ProjectAccess): Promise<GrantView[]> {
    const q = parse(listQuery, rawQuery);
    const rows = await this.prisma.grant.findMany({
      where: {
        AND: [
          this.scope(access),
          ...(q.status ? [{ status: q.status }] : []),
          ...(q.funderId ? [{ funderId: q.funderId }] : []),
          ...(q.projectId ? [{ allocations: { some: { projectId: q.projectId } } }] : []),
        ],
      },
      include,
      orderBy: [{ createdAt: "desc" }],
    });
    return rows.map(view);
  }

  async listForProject(projectId: string, access?: ProjectAccess): Promise<GrantView[]> {
    assertProjectAccess(projectId, access);
    if (!(await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Projet");
    }
    const rows = await this.prisma.grant.findMany({ where: { allocations: { some: { projectId } } }, include, orderBy: { createdAt: "desc" } });
    return rows.map(view);
  }

  async get(id: string, access?: ProjectAccess): Promise<GrantView> {
    const row = await this.prisma.grant.findFirst({ where: { AND: [{ id }, this.scope(access)] }, include });
    if (!row) throw new AccountingNotFoundError("Subvention");
    return view(row);
  }

  async create(body: unknown, actorId: string): Promise<GrantView> {
    const input = parse(createInput, body);
    const id = await this.guard(async () => {
      const grant = await this.prisma.grant.create({
        data: {
          funderId: input.funderId,
          title: input.title,
          reference: input.reference ?? null,
          requestedAmount: input.requestedAmount,
          requestedOn: asDate(input.requestedOn),
          periodStart: asDate(input.periodStart),
          periodEnd: asDate(input.periodEnd),
          conditions: input.conditions,
          note: input.note,
          createdBy: actorId,
          allocations: { create: input.allocations.map((a) => ({ projectId: a.projectId, amount: a.amount })) },
        },
        select: { id: true },
      });
      return grant.id;
    });
    await this.audit.record({ action: "grant.created", objectType: "Grant", objectId: id, actorId, details: { funderId: input.funderId } });
    return this.get(id);
  }

  async update(id: string, body: unknown, actorId: string): Promise<GrantView> {
    const patch = parse(patchInput, body);
    const current = await this.require(id);
    const provided = Object.keys(patch);
    const allowed =
      current.status === "REQUESTED" || current.status === "UNDER_REVIEW"
        ? provided
        : current.status === "GRANTED"
          ? ["title", "reference", "conditions", "note", "requestedOn"]
          : ["note"];
    const refused = provided.filter((key) => !allowed.includes(key));
    if (refused.length > 0) {
      throw new AccountingConflictError(
        current.status === "GRANTED"
          ? "Cette subvention est accordée : son montant, ses dates et son financeur ne changent plus. Les avenants ne sont pas encore pris en charge ; vous pouvez compléter l'objet, la référence, les conditions et la note."
          : "Cette subvention est terminée : seule la note peut encore être complétée.",
      );
    }
    const effective = {
      periodStart: patch.periodStart === undefined ? day(current.periodStart) : patch.periodStart,
      periodEnd: patch.periodEnd === undefined ? day(current.periodEnd) : patch.periodEnd,
    };
    if (!periodOrder(effective)) throw new AccountingConflictError("La fin de la période financée précède son début.");
    const requestedOn = patch.requestedOn === undefined ? day(current.requestedOn) : patch.requestedOn;
    if (requestedOn && current.decidedOn && requestedOn > day(current.decidedOn)!) {
      throw new AccountingConflictError("La date de la demande ne peut pas suivre la date de la décision.");
    }
    await this.guard(() =>
      this.prisma.grant.update({
        where: { id },
        data: {
          ...(patch.funderId !== undefined && { funderId: patch.funderId }),
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.reference !== undefined && { reference: patch.reference }),
          ...(patch.requestedAmount !== undefined && { requestedAmount: patch.requestedAmount }),
          ...(patch.requestedOn !== undefined && { requestedOn: asDate(patch.requestedOn) }),
          ...(patch.periodStart !== undefined && { periodStart: asDate(patch.periodStart) }),
          ...(patch.periodEnd !== undefined && { periodEnd: asDate(patch.periodEnd) }),
          ...(patch.conditions !== undefined && { conditions: patch.conditions }),
          ...(patch.note !== undefined && { note: patch.note }),
        },
      }),
    );
    await this.audit.record({ action: "grant.updated", objectType: "Grant", objectId: id, actorId, details: { fields: provided } });
    return this.get(id);
  }

  /** Remplace la répartition entre projets, tant que la subvention n'est pas décidée. */
  async setAllocations(id: string, body: unknown, actorId: string): Promise<GrantView> {
    const input = parse(allocationsInput, body);
    const current = await this.require(id);
    if (!DECIDABLE.includes(current.status)) {
      throw new AccountingConflictError("Cette subvention est décidée : sa répartition entre projets ne change plus.");
    }
    await this.guard(() => this.replaceAllocations(id, input.allocations));
    await this.audit.record({
      action: "grant.allocations-set",
      objectType: "Grant",
      objectId: id,
      actorId,
      details: { projectCount: input.allocations.length },
    });
    return this.get(id);
  }

  /** Passe la demande en instruction. */
  async review(id: string, actorId: string): Promise<GrantView> {
    const current = await this.require(id);
    if (current.status !== "REQUESTED") throw new AccountingConflictError("Seule une demande qui vient d'être déposée peut passer en instruction.");
    await this.guard(() => this.prisma.grant.update({ where: { id }, data: { status: "UNDER_REVIEW" } }));
    await this.audit.record({ action: "grant.reviewed", objectType: "Grant", objectId: id, actorId, details: {} });
    return this.get(id);
  }

  /** Enregistre l'accord. La somme des parts par projet doit égaler le montant accordé ; on peut la corriger au passage. */
  async grant(id: string, body: unknown, actorId: string): Promise<GrantView> {
    const input = parse(grantInput, body);
    const current = await this.require(id);
    if (!DECIDABLE.includes(current.status)) throw new AccountingConflictError("Cette subvention est déjà décidée.");
    if (current.requestedOn && day(current.requestedOn)! > input.decidedOn) {
      throw new AccountingConflictError("La date de la décision précède la date de la demande.");
    }
    const parts = input.allocations ?? current.allocations.map((a) => ({ projectId: a.projectId, amount: a.amount.toFixed(2) }));
    if (parts.length === 0) {
      throw new AccountingConflictError("Indiquez d'abord quels projets cette subvention finance : chaque euro accordé doit être affecté à un projet.");
    }
    const total = parts.reduce((sum, a) => sum.add(Money.parse(a.amount)), Money.zero());
    if (!total.equals(Money.parse(input.grantedAmount))) {
      throw new AccountingConflictError(
        `La somme des parts par projet (${total.toString()} €) ne correspond pas au montant accordé (${Money.parse(input.grantedAmount).toString()} €). Ajustez la répartition pour qu'elle totalise exactement le montant accordé.`,
      );
    }
    await this.guard(() =>
      this.prisma.$transaction(async (tx) => {
        if (input.allocations) await this.replaceAllocations(id, input.allocations, tx);
        await tx.grant.update({ where: { id }, data: { status: "GRANTED", grantedAmount: input.grantedAmount, decidedOn: asDate(input.decidedOn) } });
      }),
    );
    await this.audit.record({ action: "grant.granted", objectType: "Grant", objectId: id, actorId, details: { projectCount: parts.length } });
    return this.get(id);
  }

  async refuse(id: string, body: unknown, actorId: string): Promise<GrantView> {
    const input = parse(refuseInput, body);
    const current = await this.require(id);
    if (!DECIDABLE.includes(current.status)) throw new AccountingConflictError("Cette subvention est déjà décidée.");
    if (current.requestedOn && day(current.requestedOn)! > input.decidedOn) {
      throw new AccountingConflictError("La date de la décision précède la date de la demande.");
    }
    await this.guard(() =>
      this.prisma.grant.update({ where: { id }, data: { status: "REFUSED", decidedOn: asDate(input.decidedOn), reason: input.reason } }),
    );
    await this.audit.record({ action: "grant.refused", objectType: "Grant", objectId: id, actorId, justification: input.reason, details: {} });
    return this.get(id);
  }

  /** Annule une demande abandonnée, avec son motif. Une subvention accordée se clôture, elle ne s'annule pas. */
  async cancel(id: string, body: unknown, actorId: string): Promise<GrantView> {
    const input = parse(cancelInput, body);
    const current = await this.require(id);
    if (!DECIDABLE.includes(current.status)) {
      throw new AccountingConflictError(
        current.status === "GRANTED"
          ? "Cette subvention est accordée : on la clôture (en indiquant le sort du reliquat), on ne l'annule pas."
          : "Cette subvention est déjà terminée.",
      );
    }
    await this.guard(() => this.prisma.grant.update({ where: { id }, data: { status: "CANCELLED", reason: input.reason } }));
    await this.audit.record({ action: "grant.cancelled", objectType: "Grant", objectId: id, actorId, justification: input.reason, details: {} });
    return this.get(id);
  }

  /** Clôture une subvention accordée en choisissant le sort du reliquat. Aucune écriture comptable n'est créée. */
  async close(id: string, body: unknown, actorId: string): Promise<GrantView> {
    const input = parse(closeInput, body);
    const current = await this.require(id);
    if (current.status !== "GRANTED") throw new AccountingConflictError("Seule une subvention accordée peut être clôturée.");
    if (current.decidedOn && input.closedOn < day(current.decidedOn)!) {
      throw new AccountingConflictError("La date de clôture précède la date de la décision.");
    }
    await this.guard(() =>
      this.prisma.grant.update({
        where: { id },
        data: { status: "CLOSED", closedOn: asDate(input.closedOn), residual: input.residual, residualNote: input.note || null },
      }),
    );
    await this.audit.record({ action: "grant.closed", objectType: "Grant", objectId: id, actorId, details: { residual: input.residual } });
    return this.get(id);
  }

  private async replaceAllocations(id: string, allocations: { projectId: string; amount: string }[], client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<void> {
    const run = async (tx: Prisma.TransactionClient) => {
      await tx.grantProjectAllocation.deleteMany({ where: { grantId: id } });
      if (allocations.length > 0) {
        await tx.grantProjectAllocation.createMany({ data: allocations.map((a) => ({ grantId: id, projectId: a.projectId, amount: a.amount })) });
      }
    };
    if ("$transaction" in client) await client.$transaction(run);
    else await run(client);
  }

  private async require(id: string): Promise<Row> {
    const row = await this.prisma.grant.findUnique({ where: { id }, include });
    if (!row) throw new AccountingNotFoundError("Subvention");
    return row;
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
      if (/Ce financeur est archivé/i.test(text)) {
        throw new AccountingConflictError("Ce financeur est archivé : il ne reçoit plus de nouvelle demande. Choisissez un autre financeur.");
      }
      if (/somme des parts/i.test(text)) {
        throw new AccountingConflictError("La somme des parts par projet doit être égale au montant accordé.");
      }
      if (/au moins un projet financé/i.test(text)) {
        throw new AccountingConflictError("Indiquez d'abord quels projets cette subvention finance.");
      }
      if (/ne change plus|ne peut pas passer|commence toujours|décidée/i.test(text)) {
        throw new AccountingConflictError("Cette subvention ne peut plus être modifiée dans cet état.");
      }
      if (/Grant_funder_reference_unique|P2002|duplicate key|Unique constraint/i.test(text)) {
        throw new AccountingConflictError("Ce financeur a déjà une subvention avec cette référence. Vérifiez qu'il ne s'agit pas de la même.");
      }
      if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Le financeur ou le projet indiqué n'existe pas.");
      throw error;
    }
  }
}
