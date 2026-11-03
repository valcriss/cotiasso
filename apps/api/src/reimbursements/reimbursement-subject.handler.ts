import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Prisma, ReimbursementStatus } from "../generated/prisma/client.js";
import { WorkflowSubjectRegistry, type SubjectEvent, type WorkflowSubjectHandler } from "../workflows/subject-handlers.js";
import { ReimbursementNotifier } from "./reimbursement-notifier.js";
import { REIMBURSEMENT_SUBJECT } from "./reimbursements.service.js";

/** Statut de la demande après chaque événement du circuit. Les autres événements n'y changent rien. */
const STATUS: Partial<Record<SubjectEvent["type"], ReimbursementStatus>> = {
  STARTED: "IN_CIRCUIT",
  RESUMED: "IN_CIRCUIT",
  RETURNED: "RETURNED",
  REFUSED: "REFUSED",
  CANCELLED: "CANCELLED",
  COMPLETED: "PAID",
};
const CLOSING: readonly ReimbursementStatus[] = ["REFUSED", "CANCELLED", "PAID"];

/**
 * Branche les demandes de remboursement sur le moteur de circuits : le moteur décide, la demande en suit l'état dans la
 * même transaction (ADR 0035). Le statut « remboursée » n'est atteint qu'avec son remboursement, vérifié en base.
 */
@Injectable()
export class ReimbursementSubjectHandler implements WorkflowSubjectHandler, OnModuleInit {
  readonly subjectType = REIMBURSEMENT_SUBJECT;

  private readonly logger = new Logger(ReimbursementSubjectHandler.name);

  constructor(
    @Inject(WorkflowSubjectRegistry) private readonly registry: WorkflowSubjectRegistry,
    @Inject(ReimbursementNotifier) private readonly notifier: ReimbursementNotifier,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onEvent(event: SubjectEvent, tx: Prisma.TransactionClient): Promise<void> {
    const status = STATUS[event.type];
    if (status) {
      await tx.reimbursementRequest.update({
        where: { id: event.subjectId },
        data: { status, ...(CLOSING.includes(status) && { closedAt: new Date() }) },
      });
    }
    // Les notifications ne défont jamais une décision : un point de reprise isole leur écriture, et une erreur est simplement journalisée.
    await tx.$executeRawUnsafe("SAVEPOINT notify");
    try {
      await this.notifier.enqueue(event, tx);
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT notify");
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT notify");
      this.logger.warn(`Notification non enregistrée (${error instanceof Error ? error.message : "erreur inconnue"})`);
    }
  }
}
