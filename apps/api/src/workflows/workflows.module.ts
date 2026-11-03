import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { DesignationResolver } from "./designation-resolver.js";
import { WorkflowSubjectRegistry } from "./subject-handlers.js";
import { WorkflowEngineService } from "./workflow-engine.service.js";
import { WorkflowsController } from "./workflows.controller.js";
import { WorkflowsService } from "./workflows.service.js";

/** Circuits de validation (ADR 0035). Le moteur est exporté pour les types de demande qui s'y branchent. */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowEngineService, DesignationResolver, WorkflowSubjectRegistry],
  exports: [WorkflowsService, WorkflowEngineService, WorkflowSubjectRegistry],
})
export class WorkflowsModule {}
