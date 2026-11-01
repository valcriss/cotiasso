import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthzModule } from "../authz/authz.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { SessionService } from "./session.service.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [PrismaModule, AuditModule, AuthzModule],
  controllers: [AuthController],
  providers: [UsersService, SessionService, LoginThrottleService, AuthGuard],
  exports: [UsersService, SessionService, LoginThrottleService, AuthGuard],
})
export class AuthModule {}
