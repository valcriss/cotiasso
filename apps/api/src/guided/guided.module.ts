import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthzModule } from "../authz/authz.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { CategoriesService } from "./categories.service.js";
import { GuidedController } from "./guided.controller.js";
import { OpeningSituationService } from "./opening-situation.service.js";
import { OperationsService } from "./operations.service.js";
import { OverviewService } from "./overview.service.js";

@Module({
  imports: [PrismaModule, AuditModule, AuthzModule, SettingsModule],
  controllers: [GuidedController],
  providers: [CategoriesService, OperationsService, OverviewService, OpeningSituationService],
})
export class GuidedModule {}
