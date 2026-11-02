import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { ProjectAccess } from "../auth/auth.guard.js";
import type { Project } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import { parse } from "./schemas.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Date inexistante.");
const name = z.string().trim().min(1, "Nom obligatoire.").max(120, "Nom trop long (120 caractères).");
const status = z.enum(["PREPARATION", "ACTIVE", "FINISHED", "ARCHIVED"]);

const projectInput = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{1,20}$/, "Code en majuscules, chiffres et tirets (20 caractères au plus)."),
    name,
    description: z.string().trim().max(2000).default(""),
    status: status.default("PREPARATION"),
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
    managerId: z.uuid().nullish(),
  })
  .strict();

const projectPatch = z
  .object({
    name: name.optional(),
    description: z.string().trim().max(2000).optional(),
    status: status.optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    managerId: z.uuid().nullable().optional(),
  })
  .strict();

const summaryQuery = z.object({ fiscalYearId: z.uuid().optional() }).strict();

export interface ProjectView {
  id: string;
  code: string;
  name: string;
  description: string;
  status: Project["status"];
  permanent: boolean;
  startDate: string | null;
  endDate: string | null;
  managerId: string | null;
}

export interface ProjectTotals {
  charges: string;
  produits: string;
  result: string;
}

export interface ProjectSummary {
  /** Total sur tous les exercices (vue globale), ou sur l'exercice demandé. */
  total: ProjectTotals;
  /** Vue annuelle : un total par exercice ayant des mouvements. */
  years: ({ fiscalYearId: string; label: string } & ProjectTotals)[];
}

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const asDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);

const view = (project: Project): ProjectView => ({
  id: project.id,
  code: project.code,
  name: project.name,
  description: project.description,
  status: project.status,
  permanent: project.permanent,
  startDate: day(project.startDate),
  endDate: day(project.endDate),
  managerId: project.managerId,
});

/** Retire les clés non fournies : Prisma les lit comme « ne pas modifier » (exactOptionalPropertyTypes). */
function provided<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}

/**
 * Projets : axe analytique des charges et produits. Un projet utilisé n'est pas supprimé, il s'archive ; le projet
 * permanent « Fonctionnement » existe toujours et reste actif. Ces garanties sont dans la base.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Un projet hors de la portée de l'utilisateur est introuvable : on ne révèle pas son existence (ADR 0022). */
  private assertAccess(id: string, access?: ProjectAccess): void {
    if (access && !access.all && !access.ids.has(id)) throw new AccountingNotFoundError("Projet");
  }

  async list(access?: ProjectAccess): Promise<ProjectView[]> {
    const projects = await this.prisma.project.findMany({
      ...(access && !access.all && { where: { id: { in: [...access.ids] } } }),
      orderBy: [{ permanent: "desc" }, { code: "asc" }],
    });
    return projects.map(view);
  }

  async get(id: string, access?: ProjectAccess): Promise<ProjectView> {
    this.assertAccess(id, access);
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new AccountingNotFoundError("Projet");
    return view(project);
  }

  async create(body: unknown, actorId: string): Promise<ProjectView> {
    const input = parse(projectInput, body);
    if (await this.prisma.project.findUnique({ where: { code: input.code } })) {
      throw new AccountingConflictError(`Le code de projet « ${input.code} » existe déjà.`);
    }
    this.assertDates(input.startDate ?? null, input.endDate ?? null);
    const project = await this.guard(() =>
      this.prisma.project.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          status: input.status,
          startDate: asDate(input.startDate),
          endDate: asDate(input.endDate),
          managerId: input.managerId ?? null,
          createdBy: actorId,
        },
      }),
    );
    await this.audit.record({
      action: "project.created",
      objectType: "Project",
      objectId: project.id,
      actorId,
      details: { code: project.code },
    });
    return view(project);
  }

  async update(id: string, body: unknown, actorId: string, access?: ProjectAccess): Promise<ProjectView> {
    this.assertAccess(id, access);
    const patch = parse(projectPatch, body);
    const current = await this.prisma.project.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Projet");
    if (current.permanent && patch.status !== undefined && patch.status !== "ACTIVE") {
      throw new AccountingConflictError("Le projet permanent reste actif.");
    }
    this.assertDates(
      patch.startDate === undefined ? day(current.startDate) : patch.startDate,
      patch.endDate === undefined ? day(current.endDate) : patch.endDate,
    );
    const { startDate, endDate, ...rest } = patch;
    const updated = await this.guard(() =>
      this.prisma.project.update({
        where: { id },
        data: {
          ...provided(rest),
          ...(startDate !== undefined && { startDate: asDate(startDate) }),
          ...(endDate !== undefined && { endDate: asDate(endDate) }),
        },
      }),
    );
    await this.audit.record({
      action: "project.updated",
      objectType: "Project",
      objectId: id,
      actorId,
      details: { code: updated.code, fields: Object.keys(patch) },
    });
    return view(updated);
  }

  /**
   * Synthèse analytique : charges et produits ventilés sur le projet, sur les écritures comptabilisées ou contrepassées.
   * Une contrepassation reprend la ventilation de l'originale dans l'autre sens : les deux s'annulent.
   */
  async summary(id: string, query: unknown, access?: ProjectAccess): Promise<ProjectSummary> {
    this.assertAccess(id, access);
    const q = parse(summaryQuery, query);
    if (!(await this.prisma.project.findUnique({ where: { id }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Projet");
    }
    const rows = await this.prisma.$queryRaw<
      { fiscalYearId: string; label: string; class: string; side: string; total: string }[]
    >`
      SELECT e."fiscalYearId" AS "fiscalYearId", f."label" AS "label", substr(a."number", 1, 1) AS "class",
             CASE WHEN l."debit" > 0 THEN 'D' ELSE 'C' END AS "side", sum(al."amount")::text AS "total"
      FROM "AnalyticalAllocation" al
      JOIN "JournalLine" l ON l."id" = al."lineId"
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "FiscalYear" f ON f."id" = e."fiscalYearId"
      JOIN "Account" a ON a."id" = l."accountId"
      WHERE al."projectId" = ${id}::uuid AND e."status" IN ('POSTED', 'REVERSED')
      GROUP BY e."fiscalYearId", f."label", f."start", substr(a."number", 1, 1), CASE WHEN l."debit" > 0 THEN 'D' ELSE 'C' END
      ORDER BY f."start"`;

    const years = new Map<string, { label: string; charges: Money; produits: Money }>();
    for (const row of rows) {
      const entry = years.get(row.fiscalYearId) ?? { label: row.label, charges: Money.zero(), produits: Money.zero() };
      const total = Money.parse(row.total);
      // Charges (classe 6) : débits moins crédits. Produits (classe 7) : crédits moins débits.
      if (row.class === "6") entry.charges = row.side === "D" ? entry.charges.add(total) : entry.charges.subtract(total);
      if (row.class === "7") entry.produits = row.side === "C" ? entry.produits.add(total) : entry.produits.subtract(total);
      years.set(row.fiscalYearId, entry);
    }

    const totals = (charges: Money, produits: Money): ProjectTotals => ({
      charges: charges.toString(),
      produits: produits.toString(),
      result: produits.subtract(charges).toString(),
    });
    const selected = [...years.entries()].filter(([fiscalYearId]) => !q.fiscalYearId || fiscalYearId === q.fiscalYearId);
    let charges = Money.zero();
    let produits = Money.zero();
    for (const [, entry] of selected) {
      charges = charges.add(entry.charges);
      produits = produits.add(entry.produits);
    }
    return {
      total: totals(charges, produits),
      years: selected.map(([fiscalYearId, entry]) => ({ fiscalYearId, label: entry.label, ...totals(entry.charges, entry.produits) })),
    };
  }

  private assertDates(start: string | null, end: string | null): void {
    if (start && end && start > end) throw new AccountingConflictError("La fin du projet précède son début.");
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
      if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Le responsable désigné n'existe pas.");
      if (/P2002|duplicate key|Unique constraint/i.test(text)) {
        throw new AccountingConflictError("Ce code de projet existe déjà.");
      }
      if (/projet permanent/i.test(text)) throw new AccountingConflictError("Le projet permanent reste actif.");
      throw error;
    }
  }
}
