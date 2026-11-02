import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AccountingController } from "./accounting.controller.js";
import { SettingsModule } from "../settings/settings.module.js";
import { BudgetReportController } from "./budget-report.controller.js";
import { BudgetReportService } from "./budget-report.service.js";
import { CommitmentsController } from "./commitments.controller.js";
import { CommitmentsService } from "./commitments.service.js";
import { BudgetsController } from "./budgets.controller.js";
import { BudgetsService } from "./budgets.service.js";
import { ParticipantsService } from "./participants.service.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { StatementsService } from "./statements.service.js";
import { ClosingController } from "./closing.controller.js";
import { ClosingService } from "./closing.service.js";
import { EntriesController } from "./entries.controller.js";
import { EntriesService } from "./entries.service.js";
import { FrozenReportsController } from "./frozen-reports.controller.js";
import { FrozenReportsService } from "./frozen-reports.service.js";
import { ThirdPartiesController } from "./third-parties.controller.js";
import { ThirdPartiesService } from "./third-parties.service.js";
import { AccountingService } from "./accounting.service.js";

@Module({
  imports: [PrismaModule, AuditModule, SettingsModule],
  controllers: [AccountingController, EntriesController, ClosingController, ReportsController, ProjectsController, BudgetsController, CommitmentsController, BudgetReportController, ThirdPartiesController, FrozenReportsController],
  providers: [AccountingService, EntriesService, ClosingService, ReportsService, StatementsService, ProjectsService, BudgetsService, ParticipantsService, CommitmentsService, BudgetReportService, ThirdPartiesService, FrozenReportsService],
  exports: [AccountingService, EntriesService, ThirdPartiesService],
})
export class AccountingModule {}
