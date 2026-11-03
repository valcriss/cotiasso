import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthzModule } from "../authz/authz.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { GuidedModule } from "../guided/guided.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { WorkflowsModule } from "../workflows/workflows.module.js";
import { ReimbursementSubjectHandler } from "./reimbursement-subject.handler.js";
import { ReimbursementsController } from "./reimbursements.controller.js";
import { ReimbursementsService } from "./reimbursements.service.js";

/** Demandes de remboursement soumises à un circuit de validation (ADR 0035). */
@Module({
  imports: [PrismaModule, AuditModule, AuthzModule, DocumentsModule, GuidedModule, WorkflowsModule],
  controllers: [ReimbursementsController],
  providers: [ReimbursementsService, ReimbursementSubjectHandler],
  exports: [ReimbursementsService],
})
export class ReimbursementsModule {}
