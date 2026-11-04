import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * Types de demande qui peuvent être soumis à un circuit. Un nouveau type s'ajoute ici (et enregistre son
 * gestionnaire) sans toucher au moteur (ADR 0035).
 */
export const WORKFLOW_SUBJECT_TYPES: Readonly<Record<string, { label: string }>> = {
  reimbursement: { label: "Demande de remboursement" },
};

export const isKnownSubjectType = (value: string): boolean => Object.hasOwn(WORKFLOW_SUBJECT_TYPES, value);

export type SubjectEventType = "STARTED" | "STEP_ACTIVATED" | "RETURNED" | "RESUMED" | "COMPLETED" | "REFUSED" | "CANCELLED";

export interface SubjectEvent {
  type: SubjectEventType;
  instanceId: string;
  subjectId: string;
  requesterUserId: string;
  /** Étape concernée (activée, ou à l'origine du renvoi). */
  nodeId?: string | null;
  message?: string | null;
  /** Décisions enregistrées par ce changement (par exemple l'accord qui vient d'être donné). */
  decisions?: { outcome: string; actorUserId: string }[];
}

/**
 * Réaction d'un type de demande aux événements du circuit. Appelé **dans la transaction de la décision** : une
 * erreur défait la décision. Les effets qui ne doivent jamais la défaire (emails) passent par la file d'envoi.
 */
export interface WorkflowSubjectHandler {
  readonly subjectType: string;
  onEvent(event: SubjectEvent, tx: Prisma.TransactionClient): Promise<void>;
}

@Injectable()
export class WorkflowSubjectRegistry {
  private readonly handlers = new Map<string, WorkflowSubjectHandler>();

  register(handler: WorkflowSubjectHandler): void {
    if (!isKnownSubjectType(handler.subjectType)) throw new Error(`Type de demande inconnu : ${handler.subjectType}`);
    this.handlers.set(handler.subjectType, handler);
  }

  async notify(subjectType: string, event: SubjectEvent, tx: Prisma.TransactionClient): Promise<void> {
    await this.handlers.get(subjectType)?.onEvent(event, tx);
  }
}
