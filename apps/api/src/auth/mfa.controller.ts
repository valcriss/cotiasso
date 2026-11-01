import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
import { AllowPartialSession } from "../authz/partial-session.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import {
  InvalidMfaCodeError,
  MfaAlreadyEnabledError,
  MfaNotPendingError,
  MfaRequiredByRoleError,
  UserNotFoundError,
  WrongCurrentPasswordError,
} from "./errors.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { MfaService, type EnrollmentStart, type VerificationResult } from "./mfa.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD_LENGTH = 1024;

function field(body: unknown, name: string): string {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_FIELD_LENGTH) {
    throw new BadRequestException(`Champ invalide : ${name}.`);
  }
  return value;
}

function translate(error: unknown): never {
  if (error instanceof InvalidMfaCodeError || error instanceof WrongCurrentPasswordError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof MfaAlreadyEnabledError || error instanceof MfaNotPendingError || error instanceof MfaRequiredByRoleError) {
    throw new ConflictException(error.message);
  }
  if (error instanceof UserNotFoundError) throw new NotFoundException(error.message);
  throw error;
}

@Controller()
export class MfaController {
  constructor(
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
  ) {}

  /** Vérifie le second facteur d'une session ouverte avec le mot de passe. Ralenti comme la connexion. */
  @Authenticated()
  @AllowPartialSession()
  @Post("auth/mfa/verify")
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VerificationResult> {
    const auth = request.auth!;
    if (auth.mfa.state !== "VERIFICATION_REQUIRED") throw new ConflictException("Aucune vérification n'est attendue.");
    const code = field(body, "code");

    await this.guardAttempts(auth.user.email, request.ip, reply);
    try {
      const result = await this.mfa.verify(auth.user.id, auth.sessionId, code);
      await this.throttle.record(auth.user.email, request.ip, true);
      return result;
    } catch (error) {
      if (error instanceof InvalidMfaCodeError) await this.throttle.record(auth.user.email, request.ip, false);
      return translate(error);
    }
  }

  @Authenticated()
  @AllowPartialSession()
  @Post("auth/mfa/enroll/start")
  @HttpCode(HttpStatus.OK)
  async startEnrollment(@Req() request: AuthenticatedRequest): Promise<EnrollmentStart> {
    const auth = request.auth!;
    if (auth.mfa.state === "VERIFICATION_REQUIRED") throw new ForbiddenException("Vérifiez d'abord votre second facteur.");
    try {
      return await this.mfa.startEnrollment(auth.user);
    } catch (error) {
      return translate(error);
    }
  }

  @Authenticated()
  @AllowPartialSession()
  @Post("auth/mfa/enroll/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmEnrollment(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ recoveryCodes: string[] }> {
    const auth = request.auth!;
    if (auth.mfa.state === "VERIFICATION_REQUIRED") throw new ForbiddenException("Vérifiez d'abord votre second facteur.");
    const code = field(body, "code");

    await this.guardAttempts(auth.user.email, request.ip, reply);
    try {
      const recoveryCodes = await this.mfa.confirmEnrollment(auth.user.id, auth.sessionId, code);
      await this.throttle.record(auth.user.email, request.ip, true);
      return { recoveryCodes };
    } catch (error) {
      if (error instanceof InvalidMfaCodeError) await this.throttle.record(auth.user.email, request.ip, false);
      return translate(error);
    }
  }

  /** Désactive son propre second facteur, sauf si un rôle l'exige. Session complète et mot de passe exigés. */
  @Authenticated()
  @Post("auth/mfa/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<void> {
    try {
      await this.mfa.disable(request.auth!.user.id, field(body, "password"));
    } catch (error) {
      translate(error);
    }
  }

  @Authenticated()
  @Post("auth/mfa/recovery-codes")
  @HttpCode(HttpStatus.OK)
  async regenerate(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<{ recoveryCodes: string[] }> {
    try {
      return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(request.auth!.user.id, field(body, "password")) };
    } catch (error) {
      return translate(error);
    }
  }

  /** Appareil perdu : un administrateur supprime le second facteur d'un compte (tracé dans l'audit). */
  @RequirePermission("users:admin")
  @Post("users/:id/mfa/reset")
  @HttpCode(HttpStatus.NO_CONTENT)
  async adminReset(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundException();
    try {
      await this.mfa.adminReset(id, request.auth!.user.id);
    } catch (error) {
      translate(error);
    }
  }

  private async guardAttempts(email: string, ip: string | undefined, reply: FastifyReply): Promise<void> {
    const decision = await this.throttle.check(email, ip);
    if (!decision.allowed) {
      reply.header("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(
        `Trop de tentatives. Réessayez dans ${decision.retryAfterSeconds} secondes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
