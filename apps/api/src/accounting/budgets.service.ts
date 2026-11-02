import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { ProjectAccess } from "../auth/auth.guard.js";
import type { BudgetLine, BudgetVersion } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import { assertProjectAccess } from "./project-access.js";
import { parse } from "./schemas.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Date inexistante.");
const label = z.string().trim().min(1, "Libellé obligatoire.").max(120, "Libellé trop long (120 caractères).");

const lineInput = z
  .object({
    kind: z.enum(["CHARGE", "PRODUCT"]),
    label,
    accountId: z.uuid("Compte invalide.").nullish(),
    periodStart: isoDate,
    periodEnd: isoDate,
    amount: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (12 chiffres et 2 décimales au plus).")
      .refine((value) => Number(value) > 0, "Le montant doit être positif."),
  })
  .strict()
  .refine((line) => line.periodStart <= line.periodEnd, {
    path: ["periodEnd"],
    message: "La fin de la période précède son début.",
  });

const createInput = z.object({ label, fromBudgetId: z.uuid().optional() }).strict();
const updateInput = z.object({ label: label.optional(), lines: z.array(lineInput).max(500, "500 lignes au plus.").optional() }).strict();

export interface BudgetLineView {
  id: string;
  kind: BudgetLine["kind"];
  label: string;
  accountId: string | null;
  periodStart: string;
  periodEnd: string;
  amount: string;
}

export interface BudgetSummary {
  id: string;
  projectId: string;
  number: number;
  label: string;
  status: BudgetVersion["status"];
  approvedAt: string | null;
  createdAt: string;
  lineCount: number;
  /** Total des charges prévues. */
  charges: string;
  /** Total des produits prévus. */
  products: string;
  /** Produits moins charges : le résultat prévu. */
  result: string;
}

export interface BudgetView extends BudgetSummary {
  lines: BudgetLineView[];
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);

function totals(lines: { kind: BudgetLine["kind"]; amount: { toString(): string } }[]) {
  let charges = Money.zero();
  let products = Money.zero();
  for (const line of lines) {
    const amount = Money.parse(line.amount.toString());
    if (line.kind === "CHARGE") charges = charges.add(amount);
    else products = products.add(amount);
  }
  return { charges: charges.toString(), products: products.toString(), result: products.subtract(charges).toString() };
}

const summary = (budget: BudgetVersion, lines: BudgetLine[]): BudgetSummary => ({
  id: budget.id,
  projectId: budget.projectId,
  number: budget.number,
  label: budget.label,
  status: budget.status,
  approvedAt: budget.approvedAt ? budget.approvedAt.toISOString() : null,
  createdAt: budget.createdAt.toISOString(),
  lineCount: lines.length,
  ...totals(lines),
});

const lineView = (line: BudgetLine): BudgetLineView => ({
  id: line.id,
  kind: line.kind,
  label: line.label,
  accountId: line.accountId,
  periodStart: day(line.periodStart),
  periodEnd: day(line.periodEnd),
  amount: line.amount.toFixed(2),
});

const orderLines = (lines: BudgetLine[]) =>
  [...lines].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) || a.periodStart.getTime() - b.periodStart.getTime() || a.label.localeCompare(b.label, "fr"),
  );

/**
 * Budgets de projet (ADR 0024, tranche 4.1) : versions successives, un brouillon à la fois, une seule version
 * approuvée. Un budget est de la prévision : il ne crée aucune écriture comptable. Les garanties (version approuvée
 * immuable, statut qui n'avance que dans un sens) sont dans la base ; le service ajoute les messages lisibles.
 */
@Injectable()
export class BudgetsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(projectId: string, access?: ProjectAccess): Promise<BudgetSummary[]> {
    assertProjectAccess(projectId, access);
    await this.requireProject(projectId);
    const budgets = await this.prisma.budgetVersion.findMany({
      where: { projectId },
      include: { lines: true },
      orderBy: { number: "desc" },
    });
    return budgets.map((budget) => summary(budget, budget.lines));
  }

  async get(id: string, access?: ProjectAccess): Promise<BudgetView> {
    const budget = await this.prisma.budgetVersion.findUnique({ where: { id }, include: { lines: true } });
    if (!budget) throw new AccountingNotFoundError("Budget");
    assertProjectAccess(budget.projectId, access);
    return { ...summary(budget, budget.lines), lines: orderLines(budget.lines).map(lineView) };
  }

  /** Crée un brouillon, repris par défaut de la dernière version (ou de celle demandée). */
  async create(projectId: string, body: unknown, actorId: string): Promise<BudgetView> {
    const input = parse(createInput, body);
    const id = await this.guard(() =>
      this.prisma.$transaction(async (tx) => {
        // Le verrou du projet sérialise les créations et les approbations : numéros sans trou ni doublon.
        const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw new AccountingNotFoundError("Projet");
        if (locked[0]!.status === "ARCHIVED") {
          throw new AccountingConflictError("Ce projet est archivé : on ne prépare plus de budget pour lui.");
        }
        if (await tx.budgetVersion.findFirst({ where: { projectId, status: "DRAFT" }, select: { id: true } })) {
          throw new AccountingConflictError(
            "Un budget est déjà en préparation pour ce projet. Terminez-le (approuvez-le ou supprimez-le) avant d'en commencer un autre.",
          );
        }
        const previous = input.fromBudgetId
          ? await tx.budgetVersion.findFirst({ where: { id: input.fromBudgetId, projectId }, include: { lines: true } })
          : await tx.budgetVersion.findFirst({ where: { projectId }, orderBy: { number: "desc" }, include: { lines: true } });
        if (input.fromBudgetId && !previous) throw new AccountingNotFoundError("Budget à reprendre");
        const last = await tx.budgetVersion.aggregate({ where: { projectId }, _max: { number: true } });
        const created = await tx.budgetVersion.create({
          data: { projectId, number: (last._max.number ?? 0) + 1, label: input.label, createdBy: actorId },
        });
        if (previous && previous.lines.length > 0) {
          await tx.budgetLine.createMany({
            data: previous.lines.map((line) => ({
              budgetId: created.id,
              kind: line.kind,
              label: line.label,
              accountId: line.accountId,
              periodStart: line.periodStart,
              periodEnd: line.periodEnd,
              amount: line.amount,
            })),
          });
        }
        return created.id;
      }),
    );
    await this.audit.record({
      action: "budget.created",
      objectType: "BudgetVersion",
      objectId: id,
      actorId,
      details: { projectId, ...(input.fromBudgetId && { fromBudgetId: input.fromBudgetId }) },
    });
    return this.get(id);
  }

  /** Modifie le libellé et/ou remplace toutes les lignes d'un brouillon. */
  async update(id: string, body: unknown, actorId: string): Promise<BudgetView> {
    const patch = parse(updateInput, body);
    const current = await this.prisma.budgetVersion.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Budget");
    if (current.status !== "DRAFT") {
      throw new AccountingConflictError("Ce budget est approuvé : il ne se modifie plus. Créez une nouvelle version pour le changer.");
    }
    await this.guard(() =>
      this.prisma.$transaction(async (tx) => {
        if (patch.label !== undefined) await tx.budgetVersion.update({ where: { id }, data: { label: patch.label } });
        if (patch.lines !== undefined) {
          await tx.budgetLine.deleteMany({ where: { budgetId: id } });
          await tx.budgetLine.createMany({
            data: patch.lines.map((line) => ({
              budgetId: id,
              kind: line.kind,
              label: line.label,
              accountId: line.accountId ?? null,
              periodStart: asDate(line.periodStart),
              periodEnd: asDate(line.periodEnd),
              amount: line.amount,
            })),
          });
        }
      }),
    );
    await this.audit.record({
      action: "budget.updated",
      objectType: "BudgetVersion",
      objectId: id,
      actorId,
      details: { projectId: current.projectId, fields: Object.keys(patch), ...(patch.lines && { lineCount: patch.lines.length }) },
    });
    return this.get(id);
  }

  /** Approuve le brouillon : il devient le budget en vigueur et remplace l'ancien. */
  async approve(id: string, actorId: string): Promise<BudgetView> {
    const found = await this.prisma.budgetVersion.findUnique({ where: { id }, select: { projectId: true } });
    if (!found) throw new AccountingNotFoundError("Budget");
    const replaced = await this.guard(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${found.projectId}::uuid FOR UPDATE`;
        const budget = await tx.budgetVersion.findUniqueOrThrow({ where: { id }, include: { lines: { select: { id: true } } } });
        if (budget.status !== "DRAFT") throw new AccountingConflictError("Ce budget est déjà approuvé.");
        if (budget.lines.length === 0) {
          throw new AccountingConflictError("Ce budget est vide. Ajoutez au moins une ligne avant de l'approuver.");
        }
        const previous = await tx.budgetVersion.findFirst({ where: { projectId: found.projectId, status: "APPROVED" } });
        if (previous) await tx.budgetVersion.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
        await tx.budgetVersion.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: actorId } });
        return previous?.id ?? null;
      }),
    );
    await this.audit.record({
      action: "budget.approved",
      objectType: "BudgetVersion",
      objectId: id,
      actorId,
      details: { projectId: found.projectId, ...(replaced && { supersedes: replaced }) },
    });
    return this.get(id);
  }

  /** Supprime un brouillon. Une version approuvée ou remplacée est conservée. */
  async remove(id: string, actorId: string): Promise<void> {
    const budget = await this.prisma.budgetVersion.findUnique({ where: { id } });
    if (!budget) throw new AccountingNotFoundError("Budget");
    if (budget.status !== "DRAFT") {
      throw new AccountingConflictError("Un budget approuvé est conservé pour l'historique : il ne se supprime pas.");
    }
    await this.guard(() => this.prisma.budgetVersion.delete({ where: { id } }));
    await this.audit.record({
      action: "budget.deleted",
      objectType: "BudgetVersion",
      objectId: id,
      actorId,
      details: { projectId: budget.projectId, number: budget.number },
    });
  }

  private async requireProject(projectId: string): Promise<void> {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Projet");
    }
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
      if (/classe 6/i.test(text)) {
        throw new AccountingConflictError("Une charge se rattache à un compte de classe 6, un produit à un compte de classe 7.");
      }
      if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Un compte indiqué dans le budget n'existe pas.");
      if (/BudgetVersion_one_draft/i.test(text)) throw new AccountingConflictError("Un budget est déjà en préparation pour ce projet.");
      if (/ne se modifie plus|ne se supprime pas/i.test(text)) {
        throw new AccountingConflictError("Ce budget est approuvé : il ne se modifie plus. Créez une nouvelle version.");
      }
      throw error;
    }
  }
}
