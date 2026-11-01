import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AccountingController } from "./accounting.controller.js";
import { EntriesController } from "./entries.controller.js";
import { EntriesService } from "./entries.service.js";
import { AccountingService } from "./accounting.service.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AccountingController, EntriesController],
  providers: [AccountingService, EntriesService],
  exports: [AccountingService],
})
export class AccountingModule {}
