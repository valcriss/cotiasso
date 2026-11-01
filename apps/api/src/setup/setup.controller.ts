import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import type { SessionResponse } from "../auth/auth.controller.js";
import {
  AlreadySetUpError,
  DuplicateEmailError,
  InvalidEmailError,
  InvalidSetupTokenError,
  WeakPasswordError,
} from "../auth/errors.js";
import { LoginThrottleService } from "../auth/login-throttle.service.js";
import { PASSWORD_ISSUE_MESSAGES } from "../auth/password-policy.js";
import { Public } from "../auth/public.decorator.js";
import { setSessionCookie } from "../auth/session-cookie.js";
import { SessionService } from "../auth/session.service.js";
import { AuditService } from "../audit/audit.service.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { SetupService } from "./setup.service.js";

const MAX_FIELD_LENGTH = 1024;

function readSetupBody(body: unknown): { token: string; email: string; displayName: string; password: string } {
  if (typeof body !== "object" || body === null) throw new BadRequestException("Corps de requête invalide.");
  const { token, email, displayName, password } = body as Record<string, unknown>;
  for (const value of [token, email, displayName, password]) {
    if (typeof value !== "string" || value.length === 0) {
      throw new BadRequestException("Jeton, email, nom et mot de passe sont obligatoires.");
    }
    if (value.length > MAX_FIELD_LENGTH) throw new BadRequestException("Champ trop long.");
  }
  return { token: token as string, email: email as string, displayName: displayName as string, password: password as string };
}

@Controller("setup")
export class SetupController {
  constructor(
    @Inject(SetupService) private readonly setup: SetupService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  @Public()
  @Get("status")
  async status(): Promise<{ setupRequired: boolean }> {
    return { setupRequired: await this.setup.isSetupRequired() };
  }

  @Public()
  @Post()
  async complete(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { token, ...account } = readSetupBody(body);
    const ipAddress = request.ip;

    // Même protection que la connexion : les essais de jeton sont ralentis par adresse IP.
    const decision = await this.throttle.check(null, ipAddress);
    if (!decision.allowed) {
      reply.header("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(
        `Trop de tentatives. Réessayez dans ${decision.retryAfterSeconds} secondes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const user = await this.setup.complete(token, account);
      await this.throttle.record(null, ipAddress, true);

      const session = await this.sessions.create(user.id, { ipAddress, userAgent: request.headers["user-agent"] });
      await this.audit.record({
        action: "auth.login.success",
        objectType: "User",
        objectId: user.id,
        actorId: user.id,
        details: { sessionId: session.sessionId, ipAddress: ipAddress ?? null },
      });
      setSessionCookie(reply, this.env, session.token);
      return {
        user,
        permissions: [...(await this.authorization.permissionsFor(user.id))],
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof InvalidSetupTokenError) {
        await this.throttle.record(null, ipAddress, false);
        throw new ForbiddenException(error.message);
      }
      if (error instanceof AlreadySetUpError || error instanceof DuplicateEmailError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof InvalidEmailError) throw new BadRequestException(error.message);
      if (error instanceof WeakPasswordError) {
        throw new BadRequestException({
          message: "Mot de passe refusé.",
          issues: error.issues.map((issue) => PASSWORD_ISSUE_MESSAGES[issue]),
        });
      }
      throw error;
    }
  }
}
