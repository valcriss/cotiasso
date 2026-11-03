import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Authenticated, RequirePermission } from "../authz/decorators.js";
import { LastAdministratorError, RoleNotFoundError } from "../authz/errors.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { AccountService } from "./account.service.js";
import {
  DuplicateEmailError,
  InvalidEmailError,
  InvalidPasswordTokenError,
  SelfDisableError,
  UserNotFoundError,
  WeakPasswordError,
  WrongCurrentPasswordError,
} from "./errors.js";
import { AccountMailService, type MailOutcome } from "../mail/account-mail.service.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { PASSWORD_ISSUE_MESSAGES } from "./password-policy.js";
import { PasswordTokenService } from "./password-token.service.js";
import { Public } from "./public.decorator.js";
import { UsersAdminService } from "./users-admin.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD_LENGTH = 1024;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new NotFoundException();
  return value;
}

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) throw new BadRequestException("Corps de requête invalide.");
  return body as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_FIELD_LENGTH) {
    throw new BadRequestException(`Champ invalide : ${field}.`);
  }
  return value;
}

/** Traduit les erreurs métier en réponses HTTP, sans exposer de détail interne. */
function translate(error: unknown): never {
  if (error instanceof UserNotFoundError) throw new NotFoundException(error.message);
  if (error instanceof RoleNotFoundError || error instanceof InvalidEmailError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof InvalidPasswordTokenError) throw new BadRequestException(error.message);
  if (error instanceof DuplicateEmailError || error instanceof LastAdministratorError || error instanceof SelfDisableError) {
    throw new ConflictException(error.message);
  }
  if (error instanceof WrongCurrentPasswordError) throw new BadRequestException(error.message);
  if (error instanceof WeakPasswordError) {
    throw new BadRequestException({
      message: "Mot de passe refusé.",
      issues: error.issues.map((issue) => PASSWORD_ISSUE_MESSAGES[issue]),
    });
  }
  throw error;
}

@Controller()
export class AccountsController {
  constructor(
    @Inject(UsersAdminService) private readonly admin: UsersAdminService,
    @Inject(PasswordTokenService) private readonly tokens: PasswordTokenService,
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(AccountMailService) private readonly mails: AccountMailService,
  ) {}

  @RequirePermission("users:admin")
  @Post("users")
  async createUser(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = record(body);
    const roleIds = input.roleIds ?? [];
    if (!Array.isArray(roleIds) || roleIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
      throw new BadRequestException("Champ invalide : roleIds.");
    }
    try {
      const created = await this.admin.createUser(
        { email: string(input.email, "email"), displayName: string(input.displayName, "displayName"), roleIds: roleIds as string[] },
        request.auth!.user.id,
      );
      // Un email qui échoue ne défait pas le compte : le lien reste affiché à l'administrateur.
      const mail: MailOutcome = await this.mails.sendLink(created.user.id, created.invitation, request.auth!.user.id);
      return { ...created, mail };
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("users:admin")
  @Post("users/:id/password-reset")
  async issueReset(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    try {
      const issued = await this.admin.issueReset(uuid(id), request.auth!.user.id);
      const mail: MailOutcome = await this.mails.sendLink(uuid(id), issued, request.auth!.user.id);
      return { ...issued, mail };
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("users:admin")
  @Post("users/:id/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    try {
      await this.admin.disable(uuid(id), request.auth!.user.id);
    } catch (error) {
      translate(error);
    }
  }

  @RequirePermission("users:admin")
  @Post("users/:id/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async enable(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    try {
      await this.admin.enable(uuid(id), request.auth!.user.id);
    } catch (error) {
      translate(error);
    }
  }

  @RequirePermission("users:admin")
  @Post("users/:id/sessions/revoke")
  @HttpCode(HttpStatus.OK)
  async revokeSessions(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<{ revoked: number }> {
    return { revoked: await this.admin.revokeSessions(uuid(id), request.auth!.user.id) };
  }

  /** Définit un mot de passe avec un jeton d'invitation ou de réinitialisation. Ralenti par IP, comme la connexion. */
  @Public()
  @Post("auth/password-reset")
  @HttpCode(HttpStatus.NO_CONTENT)
  async redeem(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const input = record(body);
    const token = string(input.token, "token");
    const password = string(input.password, "password");
    const ipAddress = request.ip;

    const decision = await this.throttle.check(null, ipAddress);
    if (!decision.allowed) {
      reply.header("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(
        `Trop de tentatives. Réessayez dans ${decision.retryAfterSeconds} secondes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      await this.tokens.redeem(token, password);
      await this.throttle.record(null, ipAddress, true);
    } catch (error) {
      if (error instanceof InvalidPasswordTokenError) await this.throttle.record(null, ipAddress, false);
      translate(error);
    }
  }

  @Authenticated()
  @Post("auth/password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<void> {
    const input = record(body);
    try {
      await this.account.changePassword(
        request.auth!.user.id,
        string(input.currentPassword, "currentPassword"),
        string(input.newPassword, "newPassword"),
        request.auth!.sessionId,
      );
    } catch (error) {
      translate(error);
    }
  }
}
