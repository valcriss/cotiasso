import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { parseCookies, sessionCookieName } from "./cookies.js";
import { IS_PUBLIC } from "./public.decorator.js";
import { csrfTokensMatch } from "./session-tokens.js";
import { MfaService, type MfaStatus } from "./mfa.service.js";
import { SessionService, type ValidSession } from "./session.service.js";

/** Session validée, enrichie de l'état du second facteur (recalculé à chaque requête). */
export type AuthContext = ValidSession & { mfa: MfaStatus };

/** Projets accessibles pour la permission d'une route à portée projet : tous (droit global) ou une liste. */
export interface ProjectAccess {
  all: boolean;
  ids: ReadonlySet<string>;
}

export type AuthenticatedRequest = FastifyRequest & { auth?: AuthContext; projectAccess?: ProjectAccess };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-csrf-token";

/** Garde globale : refus par défaut. Une route n'est ouverte que par `@Public()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseCookies(request.headers.cookie)[sessionCookieName(this.env.cookieSecure)];
    const session = token ? await this.sessions.validate(token) : null;
    if (!session) throw new UnauthorizedException("Authentification requise.");

    if (!SAFE_METHODS.has(request.method.toUpperCase())) {
      const header = request.headers[CSRF_HEADER];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!csrfTokensMatch(session.csrfToken, provided)) {
        throw new ForbiddenException("Jeton CSRF manquant ou invalide.");
      }
    }

    request.auth = { ...session, mfa: await this.mfa.statusFor(session.user.id, session.mfaVerifiedAt) };
    return true;
  }
}
