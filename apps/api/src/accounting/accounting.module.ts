import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AccountingController } from "./accounting.controller.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { ClosingController } from "./closing.controller.js";
import { ClosingService } from "./closing.service.js";
import { EntriesController } from "./entries.controller.js";
import { EntriesService } from "./entries.service.js";
import { AccountingService } from "./accounting.service.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AccountingController, EntriesController, ClosingController, ReportsController],
  providers: [AccountingService, EntriesService, ClosingService, ReportsService],
  exports: [AccountingService],
})
export class AccountingModule {}
