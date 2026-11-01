import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AuthorizationService } from "./authorization.service.js";
import { PermissionsGuard } from "./permissions.guard.js";
import { RolesController } from "./roles.controller.js";
import { RolesService } from "./roles.service.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [RolesController],
  providers: [AuthorizationService, RolesService, PermissionsGuard],
  exports: [AuthorizationService, RolesService, PermissionsGuard],
})
export class AuthzModule {}
