import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { normalizeEmail } from "./email.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { Public } from "./public.decorator.js";
import { removeSessionCookie, setSessionCookie } from "./session-cookie.js";
import { SessionService } from "./session.service.js";
import { UsersService, type PublicUser } from "./users.service.js";

export interface SessionResponse {
  user: PublicUser;
  csrfToken: string;
  expiresAt: string;
}

const MAX_FIELD_LENGTH = 1024;

function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== "object" || body === null) throw new BadRequestException("Corps de requête invalide.");
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    throw new BadRequestException("Email et mot de passe sont obligatoires.");
  }
  if (email.length > MAX_FIELD_LENGTH || password.length > MAX_FIELD_LENGTH) {
    throw new BadRequestException("Champ trop long.");
  }
  return { email, password };
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { email, password } = readCredentials(body);
    const normalizedEmail = normalizeEmail(email);
    const ipAddress = request.ip;

    const decision = await this.throttle.check(normalizedEmail, ipAddress);
    if (!decision.allowed) {
      reply.header("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(
        `Trop de tentatives. Réessayez dans ${decision.retryAfterSeconds} secondes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.verifyCredentials(email, password);
    await this.throttle.record(normalizedEmail, ipAddress, user !== null);

    if (!user) {
      await this.audit.record({
        action: "auth.login.failure",
        objectType: "User",
        details: { ipAddress: ipAddress ?? null },
      });
      throw new UnauthorizedException("Identifiants invalides.");
    }

    const userAgent = request.headers["user-agent"];
    const session = await this.sessions.create(user.id, { ipAddress, userAgent });
    await this.audit.record({
      action: "auth.login.success",
      objectType: "User",
      objectId: user.id,
      actorId: user.id,
      details: { sessionId: session.sessionId, ipAddress: ipAddress ?? null },
    });

    setSessionCookie(reply, this.env, session.token);
    return { user, csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() };
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest): SessionResponse {
    const auth = request.auth;
    if (!auth) throw new UnauthorizedException("Authentification requise.");
    return { user: auth.user, csrfToken: auth.csrfToken, expiresAt: auth.expiresAt.toISOString() };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const auth = request.auth;
    if (!auth) throw new UnauthorizedException("Authentification requise.");
    await this.sessions.revoke(auth.sessionId);
    await this.audit.record({
      action: "auth.logout",
      objectType: "User",
      objectId: auth.user.id,
      actorId: auth.user.id,
      details: { sessionId: auth.sessionId },
    });
    removeSessionCookie(reply, this.env);
  }
}
