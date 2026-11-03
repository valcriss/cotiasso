import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { BrandLogoService } from "./brand-logo.service.js";
import { DEFAULT_MODULES, MODULE_CATALOG } from "./modules-catalog.js";
import { ModulesService } from "./modules.service.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SettingsController],
  providers: [{ provide: MODULE_CATALOG, useValue: DEFAULT_MODULES }, SettingsService, ModulesService, BrandLogoService],
  exports: [SettingsService, ModulesService, BrandLogoService],
})
export class SettingsModule {}
