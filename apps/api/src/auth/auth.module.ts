import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthzModule } from "../authz/authz.module.js";
import { MailModule } from "../mail/mail.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AccountService } from "./account.service.js";
import { AccountsController } from "./accounts.controller.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { MfaController } from "./mfa.controller.js";
import { MfaService } from "./mfa.service.js";
import { PasswordTokenService } from "./password-token.service.js";
import { SessionPresenter } from "./session-presenter.js";
import { SessionService } from "./session.service.js";
import { UsersAdminService } from "./users-admin.service.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [PrismaModule, AuditModule, AuthzModule, MailModule],
  controllers: [AuthController, AccountsController, MfaController],
  providers: [
    UsersService,
    SessionService,
    LoginThrottleService,
    AuthGuard,
    PasswordTokenService,
    UsersAdminService,
    AccountService,
    MfaService,
    SessionPresenter,
  ],
  exports: [
    UsersService,
    SessionService,
    LoginThrottleService,
    AuthGuard,
    PasswordTokenService,
    UsersAdminService,
    MfaService,
    SessionPresenter,
  ],
})
export class AuthModule {}
