import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AuditService } from "../audit/audit.service.js";
import { WrongCurrentPasswordError } from "../auth/errors.js";
import { normalizeEmail } from "../auth/email.js";
import type { AuthContext } from "../auth/auth.guard.js";
import { PasskeyPolicyService, type PasskeyPolicy } from "../auth/passkey-policy.service.js";
import { MfaService } from "../auth/mfa.service.js";
import { SessionService, type CreatedSession } from "../auth/session.service.js";
import type { PublicUser } from "../auth/users.service.js";
import { UsersService } from "../auth/users.service.js";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import type { WebauthnPurpose } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";
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
import { allowsPasswordlessLogin, allowsSecondFactor, decoyCredentialId } from "./policy.js";

export interface PasskeyView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** « Sur cet appareil » ou « Synchronisée » (iCloud, Google…) : de quoi reconnaître la clé. */
  deviceType: string;
  backedUp: boolean;
}

export interface PasskeysState {
  /** Mode réellement appliqué (désactivé si le domaine ne le permet pas). */
  mode: string;
  usernameless: boolean;
  /** Une nouvelle clé peut être enregistrée maintenant. */
  canRegister: boolean;
  items: PasskeyView[];
}

export interface ChallengeOptions<T> {
  challengeId: string;
  options: T;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const CEREMONY_TIMEOUT_MS = 5 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Identifiant WebAuthn de l'utilisateur : les 16 octets de son UUID (opaque, sans donnée personnelle). */
export function userHandleOf(userId: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(userId.replaceAll("-", ""), "hex"));
}

/** Convertit une erreur de la bibliothèque en message compréhensible. */
function translateLibraryError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (/user verification/i.test(message)) throw new UserVerificationMissingError();
  throw new InvalidPasskeyResponseError();
}

@Injectable()
export class PasskeysService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PasskeyPolicyService) private readonly policy: PasskeyPolicyService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  // --- État et gestion de ses propres clés ---

  async state(userId: string): Promise<PasskeysState> {
    const policy = await this.policy.current();
    const rows = await this.prisma.passkeyCredential.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: "asc" } });
    return {
      mode: policy.effectiveMode,
      usernameless: policy.usernameless,
      canRegister: policy.availability.ok && allowsSecondFactor(policy.effectiveMode),
      items: rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        deviceType: row.deviceType,
        backedUp: row.backedUp,
      })),
    };
  }

  async rename(userId: string, id: string, label: string): Promise<void> {
    const updated = await this.prisma.passkeyCredential.updateMany({ where: { id, userId, revokedAt: null }, data: { label } });
    if (updated.count !== 1) throw new PasskeyNotFoundError();
    await this.audit.record({ action: "auth.passkey.renamed", objectType: "User", objectId: userId, actorId: userId });
  }

  /** Retire une clé (elle est révoquée, jamais supprimée). Mot de passe exigé ; refusé si c'est la dernière protection exigée par un rôle. */
  async revoke(auth: AuthContext, id: string, password: string, now: Date = new Date()): Promise<void> {
    await this.assertPassword(auth.user.email, password);
    const credential = await this.prisma.passkeyCredential.findFirst({ where: { id, userId: auth.user.id, revokedAt: null } });
    if (!credential) throw new PasskeyNotFoundError();

    if (auth.mfa.required && !auth.mfa.totp) {
      const policy = await this.policy.current();
      const others = policy.availability.ok
        ? await this.prisma.passkeyCredential.count({ where: { userId: auth.user.id, revokedAt: null, rpId: policy.availability.rpId, id: { not: id } } })
        : 0;
      if (others === 0) throw new LastSecondFactorError();
    }
    const revoked = await this.prisma.passkeyCredential.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
    if (revoked.count !== 1) throw new PasskeyNotFoundError();
    await this.audit.record({ action: "auth.passkey.revoked", objectType: "User", objectId: auth.user.id, actorId: auth.user.id });
  }

  // --- Enregistrement ---

  async registrationOptions(auth: AuthContext, password: string | undefined, now: Date = new Date()): Promise<ChallengeOptions<PublicKeyCredentialCreationOptionsJSON>> {
    const policy = await this.requireSecondFactorUse();
    const rp = this.relyingParty(policy);
    // Session complète : le mot de passe est redemandé, pour qu'un cookie volé ne suffise pas à installer un accès durable.
    if (auth.mfa.state === "OK") {
      if (!password) throw new WrongCurrentPasswordError();
      await this.assertPassword(auth.user.email, password);
    }
    const existing = await this.prisma.passkeyCredential.findMany({
      where: { userId: auth.user.id, revokedAt: null, rpId: rp.rpId },
      select: { credentialId: true, transports: true },
    });
    const challenge = this.newChallenge();
    const options = await generateRegistrationOptions({
      rpName: await this.relyingPartyName(),
      rpID: rp.rpId,
      userName: auth.user.email,
      userDisplayName: auth.user.displayName,
      userID: userHandleOf(auth.user.id),
      challenge,
      timeout: CEREMONY_TIMEOUT_MS,
      attestationType: "none",
      excludeCredentials: existing.map((row) => ({ id: row.credentialId, transports: row.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = await this.storeChallenge("REGISTRATION", options.challenge, { userId: auth.user.id }, now);
    return { challengeId, options };
  }

  async register(
    auth: AuthContext,
    input: { challengeId: string; response: RegistrationResponseJSON; label: string },
    now: Date = new Date(),
  ): Promise<{ passkey: PasskeyView; recoveryCodes: string[] | null }> {
    const policy = await this.requireSecondFactorUse();
    const rp = this.relyingParty(policy);
    const challenge = await this.consumeChallenge(input.challengeId, "REGISTRATION", { userId: auth.user.id }, now);

    let info;
    try {
      const verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpId,
        requireUserVerification: true,
      });
      if (!verification.verified) throw new InvalidPasskeyResponseError();
      info = verification.registrationInfo;
    } catch (error) {
      if (error instanceof InvalidPasskeyResponseError) throw error;
      return translateLibraryError(error);
    }

    let result: { row: Awaited<ReturnType<PrismaService["passkeyCredential"]["create"]>>; recoveryCodes: string[] | null };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const row = await tx.passkeyCredential.create({
          data: {
            userId: auth.user.id,
            credentialId: info.credential.id,
            publicKey: Buffer.from(info.credential.publicKey),
            counter: BigInt(info.credential.counter),
            transports: info.credential.transports ?? input.response.response.transports ?? [],
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            label: input.label,
            rpId: rp.rpId,
            createdAt: now,
          },
        });
        const recoveryCodes = await this.mfa.ensureRecoveryCodes(tx, auth.user.id);
        // Un second facteur vient d'être prouvé (possession + vérification de l'utilisateur) : la session est vérifiée.
        if (!auth.mfaVerifiedAt) await tx.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: now } });
        return { row, recoveryCodes };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PasskeyAlreadyRegisteredError();
      throw error;
    }
    await this.audit.record({
      action: "auth.passkey.registered",
      objectType: "User",
      objectId: auth.user.id,
      actorId: auth.user.id,
      details: { deviceType: result.row.deviceType, backedUp: result.row.backedUp },
    });
    return {
      passkey: {
        id: result.row.id,
        label: result.row.label,
        createdAt: result.row.createdAt.toISOString(),
        lastUsedAt: null,
        deviceType: result.row.deviceType,
        backedUp: result.row.backedUp,
      },
      recoveryCodes: result.recoveryCodes,
    };
  }

  // --- Second facteur d'une session ouverte avec le mot de passe ---

  async verificationOptions(auth: AuthContext, now: Date = new Date()): Promise<ChallengeOptions<PublicKeyCredentialRequestOptionsJSON>> {
    const policy = await this.requireSecondFactorUse();
    const rp = this.relyingParty(policy);
    const credentials = await this.prisma.passkeyCredential.findMany({
      where: { userId: auth.user.id, revokedAt: null, rpId: rp.rpId },
      select: { credentialId: true, transports: true },
    });
    if (credentials.length === 0) throw new NoUsablePasskeyError();
    const challenge = this.newChallenge();
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      challenge,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: "required",
      allowCredentials: credentials.map((row) => ({ id: row.credentialId, transports: row.transports })),
    });
    const challengeId = await this.storeChallenge("AUTHENTICATION", options.challenge, { userId: auth.user.id, sessionId: auth.sessionId }, now);
    return { challengeId, options };
  }

  async verifySecondFactor(auth: AuthContext, input: { challengeId: string; response: AuthenticationResponseJSON }, now: Date = new Date()): Promise<void> {
    const policy = await this.requireSecondFactorUse();
    const challenge = await this.consumeChallenge(input.challengeId, "AUTHENTICATION", { userId: auth.user.id, sessionId: auth.sessionId }, now);
    await this.authenticate(input.response, challenge.challenge, policy, auth.user.id, now);
    await this.prisma.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: now } });
    await this.audit.record({ action: "auth.passkey.verified", objectType: "User", objectId: auth.user.id, actorId: auth.user.id });
  }

  // --- Connexion complète (mode « Connexion complète ») ---

  async loginOptions(email: string | null, now: Date = new Date()): Promise<ChallengeOptions<PublicKeyCredentialRequestOptionsJSON>> {
    const policy = await this.current();
    if (!policy.availability.ok || !allowsPasswordlessLogin(policy.effectiveMode)) throw new PasskeysUnavailableError();
    const rp = this.relyingParty(policy);

    let allowCredentials: { id: string; transports?: string[] }[] = [];
    let userId: string | null = null;
    if (!policy.usernameless) {
      if (!email) throw new PasskeyEmailRequiredError();
      const user = await this.prisma.user.findFirst({ where: { email, status: "ACTIVE" }, select: { id: true } });
      const credentials = user
        ? await this.prisma.passkeyCredential.findMany({ where: { userId: user.id, revokedAt: null, rpId: rp.rpId }, select: { credentialId: true, transports: true } })
        : [];
      userId = user && credentials.length > 0 ? user.id : null;
      // Compte inconnu ou sans clé : un identifiant factice stable, pour ne pas révéler s'il existe.
      allowCredentials = credentials.length > 0
        ? credentials.map((row) => ({ id: row.credentialId, transports: row.transports }))
        : [{ id: decoyCredentialId(this.env.mfaKey, email) }];
    }
    const challenge = this.newChallenge();
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      challenge,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: "required",
      allowCredentials,
    });
    const challengeId = await this.storeChallenge("AUTHENTICATION", options.challenge, { userId }, now);
    return { challengeId, options };
  }

  /** Ouvre une session à partir d'une clé d'accès : complète d'emblée, la clé valant possession et vérification de l'utilisateur. */
  async login(
    input: { challengeId: string; response: AuthenticationResponseJSON },
    meta: { ipAddress?: string | undefined; userAgent?: string | undefined },
    now: Date = new Date(),
  ): Promise<{ user: PublicUser; session: CreatedSession }> {
    const policy = await this.current();
    if (!policy.availability.ok || !allowsPasswordlessLogin(policy.effectiveMode)) throw new PasskeysUnavailableError();
    const challenge = await this.consumeChallenge(input.challengeId, "AUTHENTICATION", {}, now);
    // Sans mode « sans email », l'adresse doit avoir été indiquée (donc reconnue) au moment de la demande.
    if (!policy.usernameless && !challenge.userId) throw new InvalidPasskeyResponseError();

    const user = await this.authenticate(input.response, challenge.challenge, policy, challenge.userId ?? undefined, now);
    const session = await this.sessions.create(user.id, meta, now);
    await this.prisma.session.update({ where: { id: session.sessionId }, data: { mfaVerifiedAt: now } });
    await this.audit.record({
      action: "auth.login.success",
      objectType: "User",
      objectId: user.id,
      actorId: user.id,
      details: { sessionId: session.sessionId, ipAddress: meta.ipAddress ?? null, method: "passkey" },
    });
    return { user, session };
  }

  // --- Outils ---

  private current(): Promise<PasskeyPolicy> {
    return this.policy.current();
  }

  private async requireSecondFactorUse(): Promise<PasskeyPolicy> {
    const policy = await this.current();
    if (!policy.availability.ok || !allowsSecondFactor(policy.effectiveMode)) throw new PasskeysUnavailableError();
    return policy;
  }

  private relyingParty(policy: PasskeyPolicy): { rpId: string; origin: string } {
    if (!policy.availability.ok) throw new PasskeysUnavailableError();
    return { rpId: policy.availability.rpId, origin: policy.availability.origin };
  }

  private async relyingPartyName(): Promise<string> {
    const branding = (await this.settings.current("branding")) as { appName?: string };
    return branding.appName || "Cotiasso";
  }

  /** Défi aléatoire (octets) : la bibliothèque l'encode en base64url dans les options, et c'est cette forme qu'elle exige à la vérification. */
  private newChallenge(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(randomBytes(32));
  }

  private async assertPassword(email: string, password: string): Promise<void> {
    if (!(await this.users.verifyCredentials(email, password))) throw new WrongCurrentPasswordError();
  }

  private async storeChallenge(
    purpose: WebauthnPurpose,
    challenge: string,
    bind: { userId?: string | null; sessionId?: string | null },
    now: Date,
  ): Promise<string> {
    // Purge au passage des défis périmés : la table ne grossit pas.
    await this.prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 3_600_000) } } });
    const row = await this.prisma.webauthnChallenge.create({
      data: {
        challenge,
        purpose,
        userId: bind.userId ?? null,
        sessionId: bind.sessionId ?? null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      },
    });
    return row.id;
  }

  /**
   * Consomme un défi : une seule fois, avant son expiration, pour le bon but et le bon utilisateur ou la bonne session.
   * La mise à jour conditionnelle empêche deux requêtes concurrentes de l'utiliser toutes les deux.
   */
  private async consumeChallenge(
    id: string,
    purpose: WebauthnPurpose,
    expected: { userId?: string; sessionId?: string },
    now: Date,
  ): Promise<{ challenge: string; userId: string | null }> {
    if (!UUID_PATTERN.test(id)) throw new InvalidPasskeyChallengeError();
    const row = await this.prisma.webauthnChallenge.findUnique({ where: { id } });
    if (!row || row.purpose !== purpose) throw new InvalidPasskeyChallengeError();
    const claimed = await this.prisma.webauthnChallenge.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new InvalidPasskeyChallengeError();
    if (expected.userId !== undefined && row.userId !== expected.userId) throw new InvalidPasskeyChallengeError();
    if (expected.sessionId !== undefined && row.sessionId !== expected.sessionId) throw new InvalidPasskeyChallengeError();
    return { challenge: row.challenge, userId: row.userId };
  }

  /** Vérifie une signature de clé d'accès et met le compteur à jour. Renvoie le propriétaire (compte actif obligatoire). */
  private async authenticate(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    policy: PasskeyPolicy,
    onlyUserId: string | undefined,
    now: Date,
  ): Promise<PublicUser> {
    const rp = this.relyingParty(policy);
    const row = await this.prisma.passkeyCredential.findUnique({ where: { credentialId: response.id }, include: { user: true } });
    if (!row || row.revokedAt || row.rpId !== rp.rpId || row.user.status !== "ACTIVE") throw new InvalidPasskeyResponseError();
    if (onlyUserId !== undefined && row.userId !== onlyUserId) throw new InvalidPasskeyResponseError();
    // Quand l'appareil renvoie l'identifiant du compte, il doit être celui du propriétaire de la clé.
    const handle = response.response.userHandle;
    if (handle && Buffer.compare(Buffer.from(handle, "base64url"), Buffer.from(userHandleOf(row.userId))) !== 0) throw new InvalidPasskeyResponseError();

    let newCounter: number;
    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpId,
        credential: {
          id: row.credentialId,
          publicKey: new Uint8Array(row.publicKey),
          counter: Number(row.counter),
          transports: row.transports,
        },
        requireUserVerification: true,
      });
      if (!verification.verified) throw new InvalidPasskeyResponseError();
      newCounter = verification.authenticationInfo.newCounter;
    } catch (error) {
      if (error instanceof InvalidPasskeyResponseError) throw error;
      return translateLibraryError(error);
    }

    const updated = await this.prisma.passkeyCredential.updateMany({
      where: { id: row.id, revokedAt: null, counter: { lte: BigInt(newCounter) } },
      data: { counter: BigInt(newCounter), lastUsedAt: now },
    });
    if (updated.count !== 1) throw new InvalidPasskeyResponseError();
    const { id, email, displayName, status, createdAt } = row.user;
    return { id, email, displayName, status, createdAt };
  }

  /** Normalise l'adresse indiquée à la connexion (null si absente ou invalide). */
  normalizeLoginEmail(input: unknown): string | null {
    return typeof input === "string" ? normalizeEmail(input) : null;
  }
}
