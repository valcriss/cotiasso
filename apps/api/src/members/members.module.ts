import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { MembersController } from "./members.controller.js";
import { MembershipsController } from "./memberships.controller.js";
import { MembershipsService } from "./memberships.service.js";
import { MembersService } from "./members.service.js";

@Module({
  imports: [PrismaModule, AuditModule, SettingsModule],
  controllers: [MembersController, MembershipsController],
  providers: [MembersService, MembershipsService],
  exports: [MembersService, MembershipsService],
})
export class MembersModule {}
