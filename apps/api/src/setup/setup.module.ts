import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuthzModule } from "../authz/authz.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SetupController } from "./setup.controller.js";
import { SetupService } from "./setup.service.js";

@Module({
  imports: [PrismaModule, AuthModule, AuthzModule, AuditModule],
  controllers: [SetupController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
