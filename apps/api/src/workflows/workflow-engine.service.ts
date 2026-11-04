import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import type { ApprovalOutcome, Prisma, WorkflowInstanceStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { DesignationResolver } from "./designation-resolver.js";
import { parseCircuit, type Circuit, type Designation } from "./engine/circuit.js";
import {
  decide,
  EngineError,
  resume,
  startCircuit,
  submissionProblems,
  type Decision,
  type DecisionRecord,
  type EngineState,
  type SubmissionDirectory,
  type Transition,
} from "./engine/engine.js";
import { WorkflowSubjectRegistry, type SubjectEvent } from "./subject-handlers.js";
import { WorkflowsService } from "./workflows.service.js";

type Tx = Prisma.TransactionClient;

const designationInput = z.object({ kind: z.enum(["USER", "ROLE", "OFFICE"]), id: z.uuid() }).strict();
const reassignInput = z.object({ nodeId: z.string().min(1), designation: designationInput, reason: z.string().trim().min(5, "Indiquez le motif (5 caractères au moins).").max(300) }).strict();

export interface InstanceStep {
  nodeId: string;
  label: string;
  type: "APPROVAL" | "PROCESSING";
  /** `DONE` : décidée ; `AUTO` : validée d'office ; `CURRENT` : en attente ; `PENDING` : à venir ; `RETURNED` : a renvoyé la demande. */
  state: "DONE" | "AUTO" | "CURRENT" | "PENDING" | "RETURNED";
}

export interface InstanceView {
  id: string;
  subjectType: string;
  subjectId: string;
  requesterUserId: string;
  status: WorkflowInstanceStatus;
  currentNodeId: string | null;
  round: number;
  versionNumber: number;
  steps: InstanceStep[];
  decisions: { nodeId: string | null; outcome: ApprovalOutcome; actorUserId: string; actorName?: string; message: string | null; round: number; createdAt: string }[];
}

export interface StartResult {
  instanceId: string;
  status: WorkflowInstanceStatus;
  currentNodeId: string | null;
}

/** Traduit une erreur du moteur en conflit lisible (409), sans jargon. */
function asConflict(error: unknown): never {
  if (error instanceof EngineError) throw new AccountingConflictError(error.message);
  throw error;
}

/**
 * Exécution des circuits : démarre une demande sur la version en vigueur, enregistre les décisions et fait
 * avancer l'état (ADR 0035). Toute la logique d'avancement est dans le moteur pur ; ce service ajoute le verrou
 * de la demande (une seule décision effective par étape malgré des clics concurrents), l'historique en ajout seul
 * et la notification du type de demande dans la même transaction.
 */
@Injectable()
export class WorkflowEngineService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DesignationResolver) private readonly resolver: DesignationResolver,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
    @Inject(WorkflowSubjectRegistry) private readonly subjects: WorkflowSubjectRegistry,
  ) {}

  /** Y a-t-il un circuit en vigueur pour ce type de demande ? Sans lui, le traitement direct s'applique (CA-08). */
  async isEnabled(subjectType: string): Promise<boolean> {
    return (await this.workflows.activeVersion(subjectType)) !== null;
  }

  /**
   * Soumet une demande à la version en vigueur. Refuse, sans rien créer, si une étape resterait sans personne
   * pour décider. À appeler dans la transaction de la demande (`tx`).
   */
  async start(params: { subjectType: string; subjectId: string; requesterUserId: string }, tx: Tx): Promise<StartResult> {
    const active = await this.workflows.activeVersion(params.subjectType, tx);
    if (!active) throw new AccountingConflictError("Aucun circuit de validation n’est en vigueur pour ce type de demande.");
    const { directory } = await this.resolver.directoryFor(active.circuit, new Map(), tx);
    const problems = submissionProblems(active.circuit, params.requesterUserId, directory);
    if (problems.length > 0) throw new AccountingConflictError(problems.map((p) => p.message).join(" "));

    let transition: Transition;
    try {
      transition = startCircuit(active.circuit, params.requesterUserId, directory);
    } catch (error) {
      return asConflict(error);
    }
    const instance = await tx.workflowInstance
      .create({
        data: {
          definitionVersionId: active.id,
          subjectType: params.subjectType,
          subjectId: params.subjectId,
          requesterUserId: params.requesterUserId,
          currentNodeId: transition.state.currentNodeId,
        },
      })
      .catch((error: unknown) => {
        if (/one_open|23505|P2002/i.test(`${(error as { code?: string })?.code ?? ''} ${(error as Error)?.message ?? ''} ${String((error as { cause?: unknown })?.cause ?? '')}`)) {
          throw new AccountingConflictError('Cette demande est déjà soumise à un circuit de validation.');
        }
        return this.rethrow(error);
      });
    await this.record(tx, instance.id, 1, transition.decisions);
    await this.subjects.notify(params.subjectType, this.event("STARTED", instance, transition.state), tx);
    await this.subjects.notify(params.subjectType, this.event("STEP_ACTIVATED", instance, transition.state, null, transition.decisions), tx);
    return { instanceId: instance.id, status: transition.state.status, currentNodeId: transition.state.currentNodeId };
  }

  /** Applique la décision d'une personne (accord, refus, renvoi, traitement, annulation). */
  async decide(instanceId: string, decision: Decision, tx?: Tx): Promise<InstanceView> {
    return this.within(tx, async (db) => {
      const locked = await this.lock(db, instanceId);
      const circuit = await this.circuitOf(db, locked.definitionVersionId);
      const extra = await this.extraDesignations(db, instanceId);
      const { directory } = await this.resolver.directoryFor(circuit, extra, db);
      let transition: Transition;
      try {
        transition = decide(circuit, this.stateOf(locked), locked.requesterUserId, decision, directory);
      } catch (error) {
        return asConflict(error);
      }
      await this.apply(db, locked, transition, locked.round);
      return this.view(instanceId, db);
    });
  }

  /**
   * Reprise après un renvoi pour correction. `restartFromFirst` : le montant, la date ou le projet ont changé,
   * le circuit repart de la première étape.
   */
  async resume(instanceId: string, actorId: string, options: { restartFromFirst: boolean }, tx?: Tx): Promise<InstanceView> {
    return this.within(tx, async (db) => {
      const locked = await this.lock(db, instanceId);
      if (locked.requesterUserId !== actorId) throw new AccountingConflictError("Seule la personne qui a fait la demande peut la renvoyer après correction.");
      const circuit = await this.circuitOf(db, locked.definitionVersionId);
      const extra = await this.extraDesignations(db, instanceId);
      const { directory } = await this.resolver.directoryFor(circuit, extra, db);
      let transition: Transition;
      try {
        transition = resume(circuit, this.stateOf(locked), locked.requesterUserId, directory, options);
      } catch (error) {
        return asConflict(error);
      }
      // Nouvelle passe : une décision effective par étape et par passe.
      const round = locked.round + 1;
      await this.apply(db, locked, transition, round, round);
      return this.view(instanceId, db);
    });
  }

  /**
   * Ajoute des personnes habilitées à une étape pour UNE demande (par exemple un validateur parti). Décision
   * explicite d'un administrateur, motivée et auditée ; jamais de reprise automatique.
   */
  async reassign(instanceId: string, body: unknown, actorId: string): Promise<InstanceView> {
    const input = parse(reassignInput, body);
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, instanceId);
      if (locked.status !== "RUNNING" && locked.status !== "RETURNED") throw new AccountingConflictError("Cette demande est terminée : on n’y ajoute plus de personne.");
      const circuit = await this.circuitOf(tx, locked.definitionVersionId);
      const node = circuit.nodes.find((n) => n.id === input.nodeId);
      if (!node || (node.type !== "APPROVAL" && node.type !== "PROCESSING")) throw new AccountingNotFoundError("Étape");
      await tx.workflowReassignment.create({ data: { instanceId, nodeId: input.nodeId, designation: input.designation, reason: input.reason, createdBy: actorId } });
    });
    await this.audit.record({ action: "workflow.step.reassigned", objectType: "WorkflowInstance", objectId: instanceId, actorId, justification: input.reason, details: { nodeId: input.nodeId, kind: input.designation.kind } });
    return this.view(instanceId);
  }

  async view(instanceId: string, db: Tx | PrismaService = this.prisma): Promise<InstanceView> {
    const instance = await db.workflowInstance.findUnique({
      where: { id: instanceId },
      include: { definitionVersion: true, decisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!instance) throw new AccountingNotFoundError("Demande");
    const { circuit } = parseCircuit(instance.definitionVersion.document);
    if (!circuit) throw new AccountingConflictError("Le circuit de cette demande est illisible : contactez l’administrateur.");
    const effective = new Map<string, ApprovalOutcome>();
    for (const d of instance.decisions) if (d.nodeId && d.round === instance.round && d.outcome !== "CANCELLED") effective.set(d.nodeId, d.outcome);
    const steps: InstanceStep[] = circuit.nodes
      .filter((n): n is typeof n & { type: "APPROVAL" | "PROCESSING" } => n.type === "APPROVAL" || n.type === "PROCESSING")
      .map((n) => {
        const outcome = effective.get(n.id);
        let state: InstanceStep["state"] = "PENDING";
        if (outcome === "AUTO_APPROVED") state = "AUTO";
        else if (outcome === "APPROVED" || outcome === "PROCESSED") state = "DONE";
        else if (outcome === "RETURNED") state = "RETURNED";
        else if (instance.status === "RUNNING" && instance.currentNodeId === n.id) state = "CURRENT";
        return { nodeId: n.id, label: n.label, type: n.type, state };
      });
    return {
      id: instance.id,
      subjectType: instance.subjectType,
      subjectId: instance.subjectId,
      requesterUserId: instance.requesterUserId,
      status: instance.status,
      currentNodeId: instance.currentNodeId,
      round: instance.round,
      versionNumber: instance.definitionVersion.number,
      steps,
      decisions: instance.decisions.map((d) => ({ nodeId: d.nodeId, outcome: d.outcome, actorUserId: d.actorUserId, message: d.message, round: d.round, createdAt: d.createdAt.toISOString() })),
    };
  }

  /** Demandes qu'une personne peut décider maintenant (étape en cours, personne désignée, pas sa propre demande). */
  async awaiting(userId: string, subjectType?: string): Promise<{ instanceId: string; subjectType: string; subjectId: string; nodeId: string; label: string; stepType: "APPROVAL" | "PROCESSING" }[]> {
    const open = await this.prisma.workflowInstance.findMany({
      where: { status: "RUNNING", currentNodeId: { not: null }, ...(subjectType && { subjectType }) },
      include: { definitionVersion: true },
      orderBy: { createdAt: "asc" },
    });
    const result: Awaited<ReturnType<WorkflowEngineService["awaiting"]>> = [];
    for (const instance of open) {
      const step = await this.stepFor(instance, userId);
      if (step) result.push({ instanceId: instance.id, subjectType: instance.subjectType, subjectId: instance.subjectId, ...step });
    }
    return result;
  }

  /** Les comptes actifs qui peuvent décider d'une étape de cette demande (désignations du circuit et ajouts décidés pour elle). */
  async designatedUsers(instanceId: string, nodeId: string, db: Tx | PrismaService = this.prisma): Promise<{ users: Set<string>; stepType: "APPROVAL" | "PROCESSING" } | null> {
    const instance = await db.workflowInstance.findUnique({ where: { id: instanceId }, include: { definitionVersion: true } });
    if (!instance) return null;
    const { circuit } = parseCircuit(instance.definitionVersion.document);
    const node = circuit?.nodes.find((n) => n.id === nodeId);
    if (!circuit || !node || (node.type !== "APPROVAL" && node.type !== "PROCESSING")) return null;
    const extra = await this.extraDesignations(db, instanceId);
    return { users: await this.resolver.eligibleUsers([...node.approvers, ...(extra.get(node.id) ?? [])], db), stepType: node.type };
  }

  /** L'étape que cette personne peut décider maintenant sur cette demande, ou `null`. */
  async decisionFor(instanceId: string, userId: string): Promise<{ nodeId: string; label: string; stepType: "APPROVAL" | "PROCESSING" } | null> {
    const instance = await this.prisma.workflowInstance.findUnique({ where: { id: instanceId }, include: { definitionVersion: true } });
    if (!instance || instance.status !== "RUNNING") return null;
    return this.stepFor(instance, userId);
  }

  private async stepFor(
    instance: { id: string; requesterUserId: string; currentNodeId: string | null; definitionVersion: { document: Prisma.JsonValue } },
    userId: string,
  ): Promise<{ nodeId: string; label: string; stepType: "APPROVAL" | "PROCESSING" } | null> {
    const { circuit } = parseCircuit(instance.definitionVersion.document);
    const node = circuit?.nodes.find((n) => n.id === instance.currentNodeId);
    if (!circuit || !node || (node.type !== "APPROVAL" && node.type !== "PROCESSING")) return null;
    const extra = await this.extraDesignations(this.prisma, instance.id);
    const people = await this.resolver.eligibleUsers([...node.approvers, ...(extra.get(node.id) ?? [])]);
    const self = instance.requesterUserId === userId && !(node.type === "PROCESSING" && circuit.allowSelfProcessing);
    return people.has(userId) && !self ? { nodeId: node.id, label: node.label, stepType: node.type } : null;
  }

  // --- interne ---

  private async within<T>(tx: Tx | undefined, work: (db: Tx) => Promise<T>): Promise<T> {
    if (tx) return work(tx);
    return this.prisma.$transaction((db) => work(db)).catch((error: unknown) => this.rethrow(error));
  }

  private rethrow(error: unknown): never {
    if (error instanceof AccountingConflictError || error instanceof AccountingNotFoundError || error instanceof AccountingValidationError) throw error;
    const message = triggerMessage(error);
    if (message) throw new AccountingConflictError(message);
    const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
    if (/one_per_step|one_open|23505|P2002/i.test(text)) throw new AccountingConflictError("Cette demande vient d’être traitée par quelqu’un d’autre : rechargez la page pour voir son état.");
    throw error;
  }

  /** Verrouille la demande pour la durée de la transaction : les décisions concurrentes se suivent au lieu de se croiser. */
  private async lock(db: Tx, instanceId: string) {
    await db.$queryRaw`SELECT "id" FROM "WorkflowInstance" WHERE "id" = ${instanceId}::uuid FOR UPDATE`;
    const instance = await db.workflowInstance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new AccountingNotFoundError("Demande");
    return instance;
  }

  private stateOf(instance: { status: WorkflowInstanceStatus; currentNodeId: string | null; returnedFromNodeId: string | null }): EngineState {
    return { status: instance.status, currentNodeId: instance.currentNodeId, returnedFromNodeId: instance.returnedFromNodeId };
  }

  private async circuitOf(db: Tx, versionId: string): Promise<Circuit> {
    const version = await db.workflowDefinitionVersion.findUniqueOrThrow({ where: { id: versionId } });
    const { circuit } = parseCircuit(version.document);
    if (!circuit) throw new AccountingConflictError("Le circuit de cette demande est illisible : contactez l’administrateur.");
    return circuit;
  }

  private async extraDesignations(db: Tx | PrismaService, instanceId: string): Promise<Map<string, Designation[]>> {
    const rows = await db.workflowReassignment.findMany({ where: { instanceId } });
    const extra = new Map<string, Designation[]>();
    for (const row of rows) extra.set(row.nodeId, [...(extra.get(row.nodeId) ?? []), row.designation as unknown as Designation]);
    return extra;
  }

  private async record(db: Tx, instanceId: string, round: number, decisions: readonly DecisionRecord[]): Promise<void> {
    for (const d of decisions) {
      await db.approvalDecision.create({ data: { instanceId, nodeId: d.nodeId, outcome: d.outcome, actorUserId: d.actorId, message: d.message, round } });
    }
  }

  /** Enregistre les décisions, met à jour la demande et prévient son type (même transaction). */
  private async apply(
    db: Tx,
    before: { id: string; subjectType: string; status: WorkflowInstanceStatus },
    transition: Transition,
    decisionRound: number,
    newRound?: number,
  ): Promise<void> {
    await this.record(db, before.id, decisionRound, transition.decisions);
    const status = transition.state.status;
    const updated = await db.workflowInstance.update({
      where: { id: before.id },
      data: {
        status,
        currentNodeId: transition.state.currentNodeId,
        returnedFromNodeId: transition.state.returnedFromNodeId,
        ...(newRound !== undefined && { round: newRound }),
        ...(["COMPLETED", "REFUSED", "CANCELLED"].includes(status) && { finishedAt: new Date() }),
      },
    });
    const type: SubjectEvent["type"] =
      status === "COMPLETED" || status === "REFUSED" || status === "CANCELLED" || status === "RETURNED" ? status : before.status === "RETURNED" ? "RESUMED" : "STEP_ACTIVATED";
    await this.subjects.notify(before.subjectType, this.event(type, updated, transition.state, transition.decisions.at(-1)?.message ?? null, transition.decisions), db);
  }

  private event(
    type: SubjectEvent["type"],
    instance: { id: string; subjectId: string; requesterUserId: string },
    state: EngineState,
    message: string | null = null,
    decisions: readonly DecisionRecord[] = [],
  ): SubjectEvent {
    return {
      type,
      instanceId: instance.id,
      subjectId: instance.subjectId,
      requesterUserId: instance.requesterUserId,
      nodeId: state.currentNodeId ?? state.returnedFromNodeId,
      message,
      decisions: decisions.map((d) => ({ outcome: d.outcome, actorUserId: d.actorId })),
    };
  }
}
