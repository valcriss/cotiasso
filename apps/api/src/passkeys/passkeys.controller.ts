import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { WrongCurrentPasswordError } from "../auth/errors.js";
import { LoginThrottleService } from "../auth/login-throttle.service.js";
import { PasskeyPolicyService } from "../auth/passkey-policy.service.js";
import { Public } from "../auth/public.decorator.js";
import { setSessionCookie } from "../auth/session-cookie.js";
import { SessionPresenter, type SessionResponse } from "../auth/session-presenter.js";
import { Authenticated, RequirePermission } from "../authz/decorators.js";
import { AllowPartialSession } from "../authz/partial-session.js";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { SettingsValidationError } from "../settings/errors.js";
import {
  InvalidPasskeyChallengeError,
  InvalidPasskeyResponseError,
  LastSecondFactorError,
  NoUsablePasskeyError,
  PasskeyAlreadyRegisteredError,
  PasskeyEmailRequiredError,
  PasskeyNotFoundError,
  PasskeysUnavailableError,
  UserVerificationMissingError,
} from "./errors.js";
import { PasskeySettingsService, type PasskeySettingsView } from "./passkey-settings.service.js";
import { PasskeysService, type ChallengeOptions, type PasskeysState, type PasskeyView } from "./passkeys.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABEL = 60;
const DEFAULT_LABEL = "Ma clé d'accès";

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BadRequestException("Corps de requête invalide.");
  return body as Record<string, unknown>;
}

function challengeId(body: Record<string, unknown>): string {
  if (typeof body["challengeId"] !== "string") throw new BadRequestException("La demande est incomplète. Recommencez depuis le début.");
  return body["challengeId"];
}

/** Forme minimale d'une réponse du navigateur ; la vérification fine est celle de la bibliothèque. */
function credentialResponse<T extends { id: string; response: object }>(body: Record<string, unknown>): T {
  const value = body["response"];
  if (typeof value !== "object" || value === null) throw new BadRequestException("La réponse de l'appareil est absente. Recommencez.");
  const candidate = value as { id?: unknown; rawId?: unknown; type?: unknown; response?: unknown };
  if (typeof candidate.id !== "string" || typeof candidate.rawId !== "string" || candidate.type !== "public-key" || typeof candidate.response !== "object" || candidate.response === null) {
    throw new BadRequestException("La réponse de l'appareil est incomplète. Recommencez.");
  }
  return value as T;
}

function label(body: Record<string, unknown>): string {
  const raw = body["label"];
  if (raw === undefined || raw === null || raw === "") return DEFAULT_LABEL;
  if (typeof raw !== "string") throw new BadRequestException("Le nom de la clé n'est pas valide.");
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) return DEFAULT_LABEL;
  if (value.length > MAX_LABEL) throw new BadRequestException(`Ce nom est trop long (${MAX_LABEL} caractères au plus). Raccourcissez-le, puis réessayez.`);
  return value;
}

function password(body: Record<string, unknown>): string | undefined {
  const value = body["password"];
  return typeof value === "string" && value !== "" && value.length <= 1024 ? value : undefined;
}

/**
 * `invalidAs` : une réponse refusée est un 401 pour la connexion (comme un mauvais mot de passe), mais un 400 ailleurs : sur une
 * route de session ouverte, un 401 fait croire au navigateur que la session a expiré et déconnecte la personne.
 */
function translate(error: unknown, invalidAs: 400 | 401 = 400): never {
  if (error instanceof PasskeysUnavailableError || error instanceof NoUsablePasskeyError || error instanceof PasskeyAlreadyRegisteredError || error instanceof LastSecondFactorError) {
    throw new ConflictException(error.message);
  }
  if (error instanceof InvalidPasskeyChallengeError || error instanceof PasskeyEmailRequiredError || error instanceof UserVerificationMissingError || error instanceof WrongCurrentPasswordError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof InvalidPasskeyResponseError) {
    if (invalidAs === 401) throw new UnauthorizedException(error.message);
    throw new BadRequestException(error.message);
  }
  if (error instanceof PasskeyNotFoundError) throw new NotFoundException(error.message);
  if (error instanceof SettingsValidationError) throw new BadRequestException({ message: error.message, issues: error.issues });
  throw error;
}

@Controller()
export class PasskeysController {
  constructor(
    @Inject(PasskeysService) private readonly passkeys: PasskeysService,
    @Inject(PasskeySettingsService) private readonly passkeySettings: PasskeySettingsService,
    @Inject(PasskeyPolicyService) private readonly policy: PasskeyPolicyService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionPresenter) private readonly presenter: SessionPresenter,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  // --- Réglages de l'association ---

  /** Moyens de connexion proposés avant toute session : de quoi afficher (ou non) le bouton « clé d'accès ». Public par nature. */
  @Public()
  @Get("auth/methods")
  async methods(): Promise<{ passkeys: { mode: string; usernameless: boolean } }> {
    const policy = await this.policy.current();
    return { passkeys: { mode: policy.effectiveMode, usernameless: policy.usernameless } };
  }

  @RequirePermission("settings.association:view")
  @Get("security/passkeys")
  settingsView(): Promise<PasskeySettingsView> {
    return this.passkeySettings.view();
  }

  @RequirePermission("settings.association:admin")
  @Put("security/passkeys")
  async updateSettings(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<PasskeySettingsView> {
    try {
      return await this.passkeySettings.update(asObject(body), request.auth!.user.id);
    } catch (error) {
      return translate(error);
    }
  }

  // --- Connexion complète ---

  @Public()
  @Post("auth/passkeys/login/options")
  @HttpCode(HttpStatus.OK)
  async loginOptions(@Body() body: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<ChallengeOptions<unknown>> {
    const email = this.passkeys.normalizeLoginEmail(asObject(body)["email"]);
    await this.guardAttempts(email, request.ip, reply);
    try {
      return await this.passkeys.loginOptions(email);
    } catch (error) {
      return translate(error);
    }
  }

  @Public()
  @Post("auth/passkeys/login/verify")
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SessionResponse> {
    const input = asObject(body);
    const ipAddress = request.ip;
    await this.guardAttempts(null, ipAddress, reply);
    try {
      const { user, session } = await this.passkeys.login(
        { challengeId: challengeId(input), response: credentialResponse<AuthenticationResponseJSON>(input) },
        { ipAddress, userAgent: request.headers["user-agent"] },
      );
      await this.throttle.record(user.email, ipAddress, true);
      setSessionCookie(reply, this.env, session.token);
      return await this.presenter.present(user, { ...session, mfaVerifiedAt: new Date() });
    } catch (error) {
      if (error instanceof InvalidPasskeyResponseError || error instanceof InvalidPasskeyChallengeError || error instanceof UserVerificationMissingError) {
        await this.throttle.record(null, ipAddress, false);
        await this.audit.record({ action: "auth.login.failure", objectType: "User", details: { ipAddress: ipAddress ?? null, method: "passkey" } });
      }
      return translate(error, 401);
    }
  }

  // --- Second facteur d'une session ouverte avec le mot de passe ---

  @Authenticated()
  @AllowPartialSession()
  @Post("auth/passkeys/verify/options")
  @HttpCode(HttpStatus.OK)
  async verificationOptions(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<ChallengeOptions<unknown>> {
    const auth = request.auth!;
    if (auth.mfa.state !== "VERIFICATION_REQUIRED") throw new ConflictException("Aucune vérification n'est attendue.");
    await this.guardAttempts(auth.user.email, request.ip, reply);
    try {
      return await this.passkeys.verificationOptions(auth);
    } catch (error) {
      return translate(error);
    }
  }

  @Authenticated()
  @AllowPartialSession()
  @Post("auth/passkeys/verify")
  @HttpCode(HttpStatus.NO_CONTENT)
  async verify(@Body() body: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const auth = request.auth!;
    if (auth.mfa.state !== "VERIFICATION_REQUIRED") throw new ConflictException("Aucune vérification n'est attendue.");
    const input = asObject(body);
    await this.guardAttempts(auth.user.email, request.ip, reply);
    try {
      await this.passkeys.verifySecondFactor(auth, { challengeId: challengeId(input), response: credentialResponse<AuthenticationResponseJSON>(input) });
      await this.throttle.record(auth.user.email, request.ip, true);
    } catch (error) {
      if (error instanceof InvalidPasskeyResponseError || error instanceof InvalidPasskeyChallengeError || error instanceof UserVerificationMissingError) {
        await this.throttle.record(auth.user.email, request.ip, false);
      }
      translate(error);
    }
  }

  // --- Gestion de ses propres clés ---

  @Authenticated()
  @AllowPartialSession()
  @Get("auth/passkeys")
  state(@Req() request: AuthenticatedRequest): Promise<PasskeysState> {
    return this.passkeys.state(request.auth!.user.id);
  }

  @Authenticated()
  @AllowPartialSession()
  @Post("auth/passkeys/register/options")
  @HttpCode(HttpStatus.OK)
  async registrationOptions(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ChallengeOptions<unknown>> {
    const auth = request.auth!;
    if (auth.mfa.state === "VERIFICATION_REQUIRED") throw new ForbiddenException("Vérifiez d'abord votre second facteur.");
    try {
      return await this.passkeys.registrationOptions(auth, password(asObject(body)));
    } catch (error) {
      return translate(error);
    }
  }

  @Authenticated()
  @AllowPartialSession()
  @Post("auth/passkeys/register/verify")
  @HttpCode(HttpStatus.OK)
  async register(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<{ passkey: PasskeyView; recoveryCodes: string[] | null }> {
    const auth = request.auth!;
    if (auth.mfa.state === "VERIFICATION_REQUIRED") throw new ForbiddenException("Vérifiez d'abord votre second facteur.");
    const input = asObject(body);
    try {
      return await this.passkeys.register(auth, {
        challengeId: challengeId(input),
        response: credentialResponse<RegistrationResponseJSON>(input),
        label: label(input),
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Authenticated()
  @Patch("auth/passkeys/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async rename(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundException();
    try {
      await this.passkeys.rename(request.auth!.user.id, id, label(asObject(body)));
    } catch (error) {
      translate(error);
    }
  }

  @Authenticated()
  @Post("auth/passkeys/:id/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundException();
    const secret = password(asObject(body));
    if (!secret) throw new BadRequestException("Saisissez votre mot de passe actuel pour retirer une clé d'accès.");
    try {
      await this.passkeys.revoke(request.auth!, id, secret);
    } catch (error) {
      translate(error);
    }
  }

  private async guardAttempts(email: string | null, ip: string | undefined, reply: FastifyReply): Promise<void> {
    const decision = await this.throttle.check(email, ip);
    if (!decision.allowed) {
      reply.header("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(`Trop de tentatives. Réessayez dans ${decision.retryAfterSeconds} secondes.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
