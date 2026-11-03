import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthzModule } from "../authz/authz.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { DocumentStorage } from "./document-storage.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({
  imports: [PrismaModule, AuditModule, AuthzModule],
  controllers: [DocumentsController],
  providers: [DocumentStorage, DocumentsService],
  exports: [DocumentsService, DocumentStorage],
})
export class DocumentsModule {}
