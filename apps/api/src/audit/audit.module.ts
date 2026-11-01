import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AuditController } from "./audit.controller.js";
import { AuditQueryService } from "./audit-query.service.js";
import { AuditService } from "./audit.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
