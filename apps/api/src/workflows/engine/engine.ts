import { linearPath, type Circuit, type CircuitNode } from "./circuit.js";

/**
 * Cœur du moteur de circuits (ADR 0035) : des fonctions pures, sans HTTP ni base. Elles reçoivent le circuit figé
 * de la demande, l'état courant et une décision, et rendent le nouvel état avec les décisions à enregistrer.
 * Le moteur ne connaît pas la nature de la demande (remboursement ou autre).
 */

export type InstanceStatus = "RUNNING" | "RETURNED" | "COMPLETED" | "REFUSED" | "CANCELLED";

export type Outcome = "APPROVED" | "AUTO_APPROVED" | "REFUSED" | "RETURNED" | "PROCESSED" | "CANCELLED";

export interface EngineState {
  status: InstanceStatus;
  /** Étape en attente de décision ; `null` quand la demande est terminée. */
  currentNodeId: string | null;
  /** Étape qui a renvoyé la demande pour correction. */
  returnedFromNodeId: string | null;
}

/** Décision à enregistrer (ajout seul). */
export interface DecisionRecord {
  nodeId: string | null;
  outcome: Outcome;
  actorId: string;
  message: string | null;
}

export interface Transition {
  state: EngineState;
  decisions: DecisionRecord[];
}

/** Ce que le moteur demande au monde extérieur : qui est désigné pour une étape. */
export interface Directory {
  isDesignated(node: CircuitNode, userId: string): boolean;
}

export interface SubmissionDirectory extends Directory {
  /** Une personne autre que `userId` peut-elle décider de cette étape ? */
  hasOtherDesignated(node: CircuitNode, userId: string): boolean;
}

export type EngineErrorCode =
  | "NOT_ACTIVE"
  | "NOT_CURRENT_STEP"
  | "NOT_DESIGNATED"
  | "SELF_APPROVAL"
  | "SELF_PROCESSING"
  | "MESSAGE_REQUIRED"
  | "NOT_REQUESTER"
  | "NOT_RETURNED"
  | "INVALID_CIRCUIT"
  | "UNSUPPORTED_DECISION";

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export type DecisionType = "APPROVE" | "REFUSE" | "RETURN" | "PROCESS" | "CANCEL";

export interface Decision {
  type: DecisionType;
  actorId: string;
  message?: string | null;
}

export interface SubmissionProblem {
  nodeId: string;
  code: "NO_VALIDATOR" | "NO_PROCESSOR";
  message: string;
}

export const MESSAGE_MIN = 3;

function pathOf(circuit: Circuit): CircuitNode[] {
  const ids = linearPath(circuit);
  if (!ids) throw new EngineError("INVALID_CIRCUIT", "Ce circuit n'est pas un enchaînement simple d'étapes.");
  return ids.map((id) => circuit.nodes.find((n) => n.id === id)!);
}

/**
 * Avance depuis `fromIndex` (inclus) jusqu'à la première étape qui attend vraiment quelqu'un. Une étape de
 * validation dont le demandeur est lui-même désigné est validée d'office (si elle l'autorise) : la décision est
 * enregistrée, jamais passée sous silence. Le traitement n'est jamais sauté.
 */
function settle(path: CircuitNode[], fromIndex: number, requesterId: string, dir: Directory): Transition {
  const decisions: DecisionRecord[] = [];
  for (let i = fromIndex; i < path.length; i++) {
    const node = path[i]!;
    if (node.type === "APPROVAL") {
      if (node.requesterExempt && dir.isDesignated(node, requesterId)) {
        decisions.push({ nodeId: node.id, outcome: "AUTO_APPROVED", actorId: requesterId, message: "Validée d'office : le demandeur est habilité pour cette étape." });
        continue;
      }
      return { state: { status: "RUNNING", currentNodeId: node.id, returnedFromNodeId: null }, decisions };
    }
    if (node.type === "PROCESSING") return { state: { status: "RUNNING", currentNodeId: node.id, returnedFromNodeId: null }, decisions };
  }
  throw new EngineError("INVALID_CIRCUIT", "Ce circuit n'a pas d'étape de traitement.");
}

/** Démarre une demande : dépose et passe les étapes que le demandeur est habilité à valider lui-même. */
export function startCircuit(circuit: Circuit, requesterId: string, dir: Directory): Transition {
  return settle(pathOf(circuit), 1, requesterId, dir);
}

/**
 * Repère, avant le dépôt, ce qui bloquerait la demande : une étape que personne d'autre que le demandeur ne peut
 * décider. Rien n'est déposé dans ce cas, et le message dit quelle étape pose problème.
 */
export function submissionProblems(circuit: Circuit, requesterId: string, dir: SubmissionDirectory): SubmissionProblem[] {
  const problems: SubmissionProblem[] = [];
  for (const node of pathOf(circuit)) {
    if (node.type === "APPROVAL") {
      const skipped = node.requesterExempt && dir.isDesignated(node, requesterId);
      if (!skipped && !dir.hasOtherDesignated(node, requesterId)) {
        problems.push({
          nodeId: node.id,
          code: "NO_VALIDATOR",
          message: `Personne d'autre que vous ne peut donner son accord à l'étape « ${node.label} ». Demandez à un administrateur de désigner une autre personne pour cette étape.`,
        });
      }
    } else if (node.type === "PROCESSING") {
      const ok = circuit.allowSelfProcessing ? dir.isDesignated(node, requesterId) || dir.hasOtherDesignated(node, requesterId) : dir.hasOtherDesignated(node, requesterId);
      if (!ok) {
        problems.push({
          nodeId: node.id,
          code: "NO_PROCESSOR",
          message: `Personne d'autre que vous ne peut traiter l'étape « ${node.label} » (on ne rembourse pas sa propre demande). Demandez à un administrateur de désigner une autre personne.`,
        });
      }
    }
  }
  return problems;
}

const needsMessage = (message: string | null | undefined): string => {
  const text = (message ?? "").trim();
  if (text.length < MESSAGE_MIN) throw new EngineError("MESSAGE_REQUIRED", `Écrivez quelques mots (${MESSAGE_MIN} caractères au moins) pour expliquer votre décision.`);
  return text;
};

/** Applique une décision à l'état courant. Ne modifie rien : rend le nouvel état et ce qu'il faut enregistrer. */
export function decide(circuit: Circuit, state: EngineState, requesterId: string, decision: Decision, dir: Directory): Transition {
  const active = state.status === "RUNNING" || state.status === "RETURNED";
  if (!active) throw new EngineError("NOT_ACTIVE", "Cette demande est terminée : elle ne peut plus changer.");

  if (decision.type === "CANCEL") {
    if (decision.actorId !== requesterId) throw new EngineError("NOT_REQUESTER", "Seule la personne qui a fait la demande peut l'annuler.");
    const message = needsMessage(decision.message);
    return {
      state: { status: "CANCELLED", currentNodeId: null, returnedFromNodeId: null },
      decisions: [{ nodeId: state.currentNodeId, outcome: "CANCELLED", actorId: decision.actorId, message }],
    };
  }

  if (state.status !== "RUNNING" || !state.currentNodeId) {
    throw new EngineError("NOT_CURRENT_STEP", "Cette demande attend d'abord une correction de la personne qui l'a faite.");
  }
  const path = pathOf(circuit);
  const index = path.findIndex((n) => n.id === state.currentNodeId);
  const node = path[index];
  if (!node) throw new EngineError("INVALID_CIRCUIT", "L'étape en cours n'existe plus dans le circuit de cette demande.");

  if (!dir.isDesignated(node, decision.actorId)) {
    throw new EngineError("NOT_DESIGNATED", `Vous ne faites pas partie des personnes qui peuvent décider de l'étape « ${node.label} ».`);
  }
  const self = decision.actorId === requesterId;
  const asProcessing = node.type === "PROCESSING";
  if (self && !(asProcessing && circuit.allowSelfProcessing)) {
    throw new EngineError(
      asProcessing ? "SELF_PROCESSING" : "SELF_APPROVAL",
      asProcessing ? "Vous ne pouvez pas traiter votre propre demande : une autre personne doit le faire." : "Vous ne pouvez pas donner votre propre accord : une autre personne doit le faire.",
    );
  }

  switch (decision.type) {
    case "APPROVE": {
      if (node.type !== "APPROVAL") throw new EngineError("UNSUPPORTED_DECISION", "Cette étape est un traitement : remboursez la demande ou renvoyez-la pour correction.");
      const approved: DecisionRecord = { nodeId: node.id, outcome: "APPROVED", actorId: decision.actorId, message: decision.message?.trim() || null };
      const next = settle(path, index + 1, requesterId, dir);
      return { state: next.state, decisions: [approved, ...next.decisions] };
    }
    case "REFUSE": {
      if (node.type !== "APPROVAL") throw new EngineError("UNSUPPORTED_DECISION", "On refuse une demande à une étape de validation ; au traitement, renvoyez-la pour correction.");
      const message = needsMessage(decision.message);
      return {
        state: { status: "REFUSED", currentNodeId: null, returnedFromNodeId: null },
        decisions: [{ nodeId: node.id, outcome: "REFUSED", actorId: decision.actorId, message }],
      };
    }
    case "RETURN": {
      const message = needsMessage(decision.message);
      return {
        state: { status: "RETURNED", currentNodeId: node.id, returnedFromNodeId: node.id },
        decisions: [{ nodeId: node.id, outcome: "RETURNED", actorId: decision.actorId, message }],
      };
    }
    case "PROCESS": {
      if (node.type !== "PROCESSING") throw new EngineError("UNSUPPORTED_DECISION", "Cette étape est une validation : acceptez, refusez ou renvoyez la demande.");
      return {
        state: { status: "COMPLETED", currentNodeId: null, returnedFromNodeId: null },
        decisions: [{ nodeId: node.id, outcome: "PROCESSED", actorId: decision.actorId, message: decision.message?.trim() || null }],
      };
    }
  }
}

/**
 * Reprise d'une demande renvoyée pour correction. Si montant, date ou projet ont changé, le circuit repart de la
 * première étape (les décisions précédentes restent dans l'historique) ; sinon elle reprend à l'étape qui l'avait
 * renvoyée.
 */
export function resume(circuit: Circuit, state: EngineState, requesterId: string, dir: Directory, options: { restartFromFirst: boolean }): Transition {
  if (state.status !== "RETURNED" || !state.returnedFromNodeId) throw new EngineError("NOT_RETURNED", "Cette demande n'est pas en attente de correction.");
  const path = pathOf(circuit);
  if (options.restartFromFirst) return settle(path, 1, requesterId, dir);
  if (!path.some((n) => n.id === state.returnedFromNodeId)) throw new EngineError("INVALID_CIRCUIT", "L'étape qui avait renvoyé la demande n'existe plus dans son circuit.");
  return { state: { status: "RUNNING", currentNodeId: state.returnedFromNodeId, returnedFromNodeId: null }, decisions: [] };
}
