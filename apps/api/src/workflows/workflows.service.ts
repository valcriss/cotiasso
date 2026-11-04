import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { Prisma, WorkflowVersionStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { DesignationResolver } from "./designation-resolver.js";
import { CIRCUIT_SCHEMA_VERSION, circuitIssues, parseCircuit, type Circuit, type CircuitIssue, type Designation } from "./engine/circuit.js";
import { isKnownSubjectType, WORKFLOW_SUBJECT_TYPES } from "./subject-handlers.js";

const sourceInput = z.object({ source: z.enum(["ACTIVE", "STARTER"]).optional() }).strict();
const updateInput = z.object({ revision: z.number().int().min(1), document: z.unknown() }).strict();

export interface VersionSummary {
  id: string;
  number: number;
  status: WorkflowVersionStatus;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
}

export interface WorkflowSummary {
  subjectType: string;
  label: string;
  active: VersionSummary | null;
  draft: VersionSummary | null;
}

export interface VersionView extends VersionSummary {
  subjectType: string;
  label: string;
  revision: number;
  document: unknown;
  /** Ce qui empêcherait d'activer cette version. Un brouillon peut être incomplet. */
  issues: CircuitIssue[];
  /** Signalements : étape que personne n'occupe aujourd'hui, etc. N'empêchent pas l'activation. */
  warnings: CircuitIssue[];
}

const summary = (v: { id: string; number: number; status: WorkflowVersionStatus; createdAt: Date; activatedAt: Date | null; retiredAt: Date | null }): VersionSummary => ({
  id: v.id,
  number: v.number,
  status: v.status,
  createdAt: v.createdAt.toISOString(),
  activatedAt: v.activatedAt?.toISOString() ?? null,
  retiredAt: v.retiredAt?.toISOString() ?? null,
});

function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

/**
 * Circuits de validation : versions successives, une seule active par type de demande (ADR 0035). Une version
 * active est figée ; pour changer un circuit on prépare une nouvelle version, et les demandes en cours gardent
 * celle de leur soumission (CA-09).
 */
@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DesignationResolver) private readonly resolver: DesignationResolver,
  ) {}

  async list(): Promise<WorkflowSummary[]> {
    const rows = await this.prisma.workflowDefinition.findMany({ include: { versions: { where: { status: { in: ["ACTIVE", "DRAFT"] } } } } });
    return Object.entries(WORKFLOW_SUBJECT_TYPES).map(([subjectType, { label }]) => {
      const versions = rows.find((r) => r.subjectType === subjectType)?.versions ?? [];
      const active = versions.find((v) => v.status === "ACTIVE");
      const draft = versions.find((v) => v.status === "DRAFT");
      return { subjectType, label, active: active ? summary(active) : null, draft: draft ? summary(draft) : null };
    });
  }

  async history(subjectType: string): Promise<{ subjectType: string; label: string; versions: VersionSummary[] }> {
    this.assertKnown(subjectType);
    const definition = await this.prisma.workflowDefinition.findUnique({ where: { subjectType }, include: { versions: { orderBy: { number: "desc" } } } });
    return { subjectType, label: WORKFLOW_SUBJECT_TYPES[subjectType]!.label, versions: (definition?.versions ?? []).map(summary) };
  }

  async get(id: string): Promise<VersionView> {
    const version = await this.prisma.workflowDefinitionVersion.findUnique({ where: { id }, include: { definition: true } });
    if (!version) throw new AccountingNotFoundError("Version du circuit");
    return this.view(version);
  }

  /** Prépare un brouillon : copie de la version active, ou modèle de départ (« membre → président → trésorier »). */
  async createDraft(subjectType: string, body: unknown, actorId: string): Promise<VersionView> {
    this.assertKnown(subjectType);
    const { source } = parse(sourceInput, body ?? {});
    const created = await this.prisma
      .$transaction(async (tx) => {
        const definition = await tx.workflowDefinition.upsert({ where: { subjectType }, create: { subjectType }, update: {} });
        // Le numéro se prend sous verrou de la définition : deux brouillons simultanés ne se partagent pas un numéro.
        await tx.$queryRaw`SELECT "id" FROM "WorkflowDefinition" WHERE "id" = ${definition.id}::uuid FOR UPDATE`;
        const existing = await tx.workflowDefinitionVersion.findFirst({ where: { definitionId: definition.id, status: "DRAFT" } });
        if (existing) throw new AccountingConflictError("Un brouillon de ce circuit existe déjà : modifiez-le ou supprimez-le avant d’en préparer un autre.");
        const active = await tx.workflowDefinitionVersion.findFirst({ where: { definitionId: definition.id, status: "ACTIVE" } });
        if (source === "ACTIVE" && !active) throw new AccountingConflictError("Ce circuit n’a pas encore de version en vigueur à recopier.");
        const document = (source === "STARTER" || !active ? await this.starterDocument(tx) : active.document) as Prisma.InputJsonValue;
        const last = await tx.workflowDefinitionVersion.aggregate({ where: { definitionId: definition.id }, _max: { number: true } });
        return tx.workflowDefinitionVersion.create({
          data: { definitionId: definition.id, number: (last._max.number ?? 0) + 1, document, createdBy: actorId },
          include: { definition: true },
        });
      })
      .catch(this.rethrow);
    await this.audit.record({ action: "workflow.version.created", objectType: "WorkflowDefinitionVersion", objectId: created.id, actorId, details: { subjectType, number: created.number } });
    return this.view(created);
  }

  /** Remplace tout le contenu d'un brouillon. La forme doit être valide ; il peut rester incomplet. */
  async updateDraft(id: string, body: unknown, actorId: string): Promise<VersionView> {
    const { revision, document } = parse(updateInput, body);
    const { circuit, issues } = parseCircuit(document);
    if (!circuit) throw new AccountingValidationError(issues.map((i) => ({ path: i.nodeId ?? "circuit", message: i.message })));
    const current = await this.prisma.workflowDefinitionVersion.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Version du circuit");
    if (current.status !== "DRAFT") throw new AccountingConflictError("Cette version est en vigueur ou retirée : elle ne se modifie plus. Préparez un nouveau brouillon.");
    const changed = await this.prisma.workflowDefinitionVersion
      .updateMany({ where: { id, revision, status: "DRAFT" }, data: { document: circuit as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } })
      .catch(this.rethrow);
    if (changed.count !== 1) throw new AccountingConflictError("Ce brouillon a été modifié entre-temps. Rechargez-le avant de l’enregistrer.");
    await this.audit.record({ action: "workflow.version.updated", objectType: "WorkflowDefinitionVersion", objectId: id, actorId });
    return this.get(id);
  }

  async deleteDraft(id: string, actorId: string): Promise<void> {
    const current = await this.prisma.workflowDefinitionVersion.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Version du circuit");
    if (current.status !== "DRAFT") throw new AccountingConflictError("Seul un brouillon se supprime : une version qui a été en vigueur reste dans l’historique.");
    await this.prisma.workflowDefinitionVersion.delete({ where: { id } }).catch(this.rethrow);
    await this.audit.record({ action: "workflow.version.deleted", objectType: "WorkflowDefinitionVersion", objectId: id, actorId });
  }

  /** Met le brouillon en vigueur et retire la version précédente. Les demandes en cours gardent la leur. */
  async activate(id: string, actorId: string): Promise<VersionView> {
    const result = await this.prisma
      .$transaction(async (tx) => {
        const version = await tx.workflowDefinitionVersion.findUnique({ where: { id }, include: { definition: true } });
        if (!version) throw new AccountingNotFoundError("Version du circuit");
        await tx.$queryRaw`SELECT "id" FROM "WorkflowDefinition" WHERE "id" = ${version.definitionId}::uuid FOR UPDATE`;
        const locked = await tx.workflowDefinitionVersion.findUnique({ where: { id } });
        if (locked?.status !== "DRAFT") throw new AccountingConflictError("Seul un brouillon se met en vigueur.");
        const { circuit, issues } = parseCircuit(locked.document);
        const blocking = circuit ? [...circuitIssues(circuit, { complete: true }), ...(await this.unknownTargets(circuit, tx))] : issues;
        if (blocking.length > 0) {
          throw new AccountingValidationError(blocking.map((i) => ({ path: i.nodeId ?? "circuit", message: i.message })));
        }
        const now = new Date();
        await tx.workflowDefinitionVersion.updateMany({ where: { definitionId: version.definitionId, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: now } });
        await tx.workflowDefinitionVersion.update({ where: { id }, data: { status: "ACTIVE", activatedAt: now, activatedBy: actorId } });
        return version;
      })
      .catch(this.rethrow);
    await this.audit.record({ action: "workflow.version.activated", objectType: "WorkflowDefinitionVersion", objectId: id, actorId, details: { subjectType: result.definition.subjectType, number: result.number } });
    return this.get(id);
  }

  /** Version en vigueur d'un type de demande, ou `null` : sans elle, le circuit est désactivé (CA-08). */
  async activeVersion(subjectType: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<{ id: string; number: number; circuit: Circuit } | null> {
    const version = await db.workflowDefinitionVersion.findFirst({ where: { status: "ACTIVE", definition: { subjectType } } });
    if (!version) return null;
    const { circuit } = parseCircuit(version.document);
    if (!circuit) throw new AccountingConflictError("Le circuit en vigueur est illisible : contactez l’administrateur.");
    return { id: version.id, number: version.number, circuit };
  }

  // --- interne ---

  private assertKnown(subjectType: string): void {
    if (!isKnownSubjectType(subjectType)) throw new AccountingNotFoundError("Type de demande");
  }

  private rethrow = (error: unknown): never => {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError || error instanceof AccountingValidationError) throw error;
    const message = triggerMessage(error);
    if (message) throw new AccountingConflictError(message);
    const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
    if (/one_draft|one_active|23505|P2002/i.test(text)) throw new AccountingConflictError("Un brouillon de ce circuit existe déjà : modifiez-le ou supprimez-le avant d’en préparer un autre.");
    throw error;
  };

  private async view(version: {
    id: string;
    number: number;
    status: WorkflowVersionStatus;
    revision: number;
    document: Prisma.JsonValue;
    createdAt: Date;
    activatedAt: Date | null;
    retiredAt: Date | null;
    definition: { subjectType: string };
  }): Promise<VersionView> {
    const { circuit, issues } = parseCircuit(version.document);
    const blocking: CircuitIssue[] = circuit ? [...circuitIssues(circuit, { complete: true }), ...(await this.unknownTargets(circuit))] : issues;
    return {
      ...summary(version),
      subjectType: version.definition.subjectType,
      label: WORKFLOW_SUBJECT_TYPES[version.definition.subjectType]?.label ?? version.definition.subjectType,
      revision: version.revision,
      document: version.document,
      issues: blocking,
      warnings: circuit ? await this.warnings(circuit) : [],
    };
  }

  /** Désignations qui pointent vers une personne, un rôle ou une fonction qui n'existe pas ou plus. */
  private async unknownTargets(circuit: Circuit, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<CircuitIssue[]> {
    const issues: CircuitIssue[] = [];
    for (const node of circuit.nodes) {
      const designations = unique(node.approvers, (d) => `${d.kind}:${d.id}`);
      for (const designation of designations) {
        const exists = await this.exists(designation, db);
        if (!exists) issues.push({ nodeId: node.id, code: "UNKNOWN_DESIGNATION", message: `Une désignation de l’étape « ${node.label} » n’existe plus ou est archivée : retirez-la ou choisissez-en une autre.` });
      }
    }
    return issues;
  }

  private async exists(designation: Designation, db: Prisma.TransactionClient | PrismaService): Promise<boolean> {
    switch (designation.kind) {
      case "USER":
        return !!(await db.user.findFirst({ where: { id: designation.id, status: "ACTIVE" }, select: { id: true } }));
      case "ROLE":
        return !!(await db.role.findUnique({ where: { id: designation.id }, select: { id: true } }));
      case "OFFICE":
        return !!(await db.officeRole.findFirst({ where: { id: designation.id, active: true }, select: { id: true } }));
    }
  }

  /** Étapes du circuit en vigueur qu'aucune personne ne peut décider aujourd'hui (vide : sans circuit en vigueur, ou circuit utilisable). */
  async activeWarnings(subjectType: string): Promise<CircuitIssue[]> {
    const active = await this.activeVersion(subjectType);
    return active ? this.warnings(active.circuit) : [];
  }

  /** Étapes qu'aucune personne ne peut décider aujourd'hui. N'empêche pas d'activer, mais une demande y resterait bloquée. */
  private async warnings(circuit: Circuit): Promise<CircuitIssue[]> {
    const warnings: CircuitIssue[] = [];
    for (const node of circuit.nodes) {
      if ((node.type !== "APPROVAL" && node.type !== "PROCESSING") || node.approvers.length === 0) continue;
      const people = await this.resolver.eligibleUsers(node.approvers);
      if (people.size === 0) {
        warnings.push({
          nodeId: node.id,
          code: "NOBODY_ELIGIBLE",
          message: `Aujourd’hui, personne ne peut décider de l’étape « ${node.label} » (fonction non occupée, compte désactivé…). Une demande y resterait bloquée.`,
        });
      }
    }
    return warnings;
  }

  /** Modèle de départ « membre → président → trésorier ». Les désignations retrouvées dans l'association sont préremplies. */
  private async starterDocument(db: Prisma.TransactionClient): Promise<Circuit> {
    const president = await db.officeRole.findFirst({ where: { nameKey: { in: ["president", "presidente", "president·e"] }, active: true }, select: { id: true } });
    const treasurer = await db.role.findUnique({ where: { key: "treasurer" }, select: { id: true } });
    return {
      schemaVersion: CIRCUIT_SCHEMA_VERSION,
      allowSelfProcessing: false,
      nodes: [
        { id: "start", type: "START", label: "Dépôt de la demande", approvers: [], requesterExempt: true },
        { id: "president", type: "APPROVAL", label: "Accord du président", approvers: president ? [{ kind: "OFFICE", id: president.id }] : [], requesterExempt: true },
        { id: "treasurer", type: "PROCESSING", label: "Remboursement par le trésorier", approvers: treasurer ? [{ kind: "ROLE", id: treasurer.id }] : [], requesterExempt: false },
        { id: "end", type: "END", label: "Remboursée", approvers: [], requesterExempt: true },
      ],
      edges: [
        { from: "start", to: "president" },
        { from: "president", to: "treasurer" },
        { from: "treasurer", to: "end" },
      ],
    };
  }
}
