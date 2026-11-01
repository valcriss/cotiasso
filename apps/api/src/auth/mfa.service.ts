import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { base32Encode } from "../mfa/base32.js";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "../mfa/recovery-codes.js";
import { SecretCipher } from "../mfa/secret-cipher.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../mfa/totp.js";
import {
  InvalidMfaCodeError,
  MfaAlreadyEnabledError,
  MfaNotPendingError,
  MfaRequiredByRoleError,
  UserNotFoundError,
  WrongCurrentPasswordError,
} from "./errors.js";
import { UsersService } from "./users.service.js";

/** État du second facteur pour une session : détermine ce qu'elle a le droit de faire. */
export type MfaState = "OK" | "VERIFICATION_REQUIRED" | "ENROLLMENT_REQUIRED";

export interface MfaStatus {
  state: MfaState;
  /** L'utilisateur a activé un second facteur. */
  enabled: boolean;
  /** Au moins un de ses rôles actifs l'exige. */
  required: boolean;
}

export interface EnrollmentStart {
  /** Secret en base32, à saisir à la main si le QR code n'est pas utilisable. */
  secret: string;
  otpauthUri: string;
}

export interface VerificationResult {
  method: "totp" | "recovery";
  recoveryCodesLeft: number;
}

const ISSUER = "cotiasso";

@Injectable()
export class MfaService {
  private readonly cipher: SecretCipher;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.cipher = new SecretCipher(env.mfaKey);
  }

  /** Calculé à chaque requête : un rôle devenu exigeant s'applique immédiatement aux sessions en cours. */
  async statusFor(userId: string, sessionMfaVerifiedAt: Date | null, now: Date = new Date()): Promise<MfaStatus> {
    const [credential, requiring] = await Promise.all([
      this.prisma.mfaCredential.findUnique({ where: { userId }, select: { enabledAt: true } }),
      this.prisma.roleAssignment.count({
        where: {
          userId,
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          role: { requiresMfa: true },
        },
      }),
    ]);
    const enabled = credential?.enabledAt != null;
    const required = requiring > 0;
    const state: MfaState =
      enabled && !sessionMfaVerifiedAt ? "VERIFICATION_REQUIRED" : !enabled && required ? "ENROLLMENT_REQUIRED" : "OK";
    return { state, enabled, required };
  }

  /** Génère un secret non encore actif. Reprendre l'inscription remplace le secret précédent. */
  async startEnrollment(user: { id: string; email: string }): Promise<EnrollmentStart> {
    const existing = await this.prisma.mfaCredential.findUnique({ where: { userId: user.id } });
    if (existing?.enabledAt) throw new MfaAlreadyEnabledError();

    const secret = generateTotpSecret();
    const secretEncrypted = this.cipher.encrypt(secret, user.id);
    await this.prisma.mfaCredential.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secretEncrypted },
      update: { secretEncrypted, lastUsedStep: 0 },
    });
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, ISSUER, user.email) };
  }

  /**
   * Confirme l'inscription avec un premier code, active le second facteur, génère les codes de secours
   * (renvoyés une seule fois) et marque la session comme vérifiée.
   */
  async confirmEnrollment(userId: string, sessionId: string, code: string, now: Date = new Date()): Promise<string[]> {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (!credential || credential.enabledAt) throw new MfaNotPendingError();

    const secret = this.cipher.decrypt(credential.secretEncrypted, userId);
    const step = verifyTotp(secret, code, now.getTime());
    if (step === null) throw new InvalidMfaCodeError();

    const codes = generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.update({ where: { userId }, data: { enabledAt: now, lastUsedStep: step } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((value) => ({ userId, codeHash: this.hash(value) })),
      });
      await tx.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: now } });
    });
    await this.audit.record({ action: "auth.mfa.enabled", objectType: "User", objectId: userId, actorId: userId });
    return codes;
  }

  /** Vérifie le second facteur (code TOTP ou code de secours) et marque la session comme vérifiée. */
  async verify(userId: string, sessionId: string, code: string, now: Date = new Date()): Promise<VerificationResult> {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (!credential?.enabledAt) throw new InvalidMfaCodeError();

    const method = (await this.acceptTotp(userId, credential, code, now)) ? "totp" : (await this.acceptRecovery(userId, code, now)) ? "recovery" : null;
    if (!method) throw new InvalidMfaCodeError();

    await this.prisma.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: now } });
    const recoveryCodesLeft = await this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
    await this.audit.record({
      action: method === "recovery" ? "auth.mfa.recovery-used" : "auth.mfa.verified",
      objectType: "User",
      objectId: userId,
      actorId: userId,
    });
    return { method, recoveryCodesLeft };
  }

  /** Désactive son propre second facteur (mot de passe exigé), sauf si un rôle l'impose. */
  async disable(userId: string, password: string): Promise<void> {
    await this.assertPassword(userId, password);
    const status = await this.statusFor(userId, new Date());
    if (status.required) throw new MfaRequiredByRoleError();
    await this.removeCredential(userId);
    await this.audit.record({ action: "auth.mfa.disabled", objectType: "User", objectId: userId, actorId: userId });
  }

  /** Remplace les codes de secours (mot de passe exigé) ; les anciens cessent de fonctionner. */
  async regenerateRecoveryCodes(userId: string, password: string): Promise<string[]> {
    await this.assertPassword(userId, password);
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (!credential?.enabledAt) throw new MfaNotPendingError();

    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: codes.map((value) => ({ userId, codeHash: this.hash(value) })) }),
    ]);
    await this.audit.record({ action: "auth.mfa.recovery-regenerated", objectType: "User", objectId: userId, actorId: userId });
    return codes;
  }

  /**
   * Réinitialisation par un administrateur (appareil perdu) : supprime le second facteur et déconnecte l'utilisateur.
   * Si un rôle l'exige, il devra se réinscrire à la prochaine connexion.
   */
  async adminReset(userId: string, actorId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new UserNotFoundError();
    await this.removeCredential(userId);
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: "user.mfa.reset", objectType: "User", objectId: userId, actorId });
  }

  private hash(code: string): string {
    return hashRecoveryCode(normalizeRecoveryCode(code)!, this.env.mfaKey);
  }

  private async assertPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new UserNotFoundError();
    if (!(await this.users.verifyCredentials(user.email, password))) throw new WrongCurrentPasswordError();
  }

  private async removeCredential(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaCredential.deleteMany({ where: { userId } }),
    ]);
  }

  /** Accepte un code TOTP jamais utilisé ; la mise à jour conditionnelle empêche deux requêtes de le rejouer. */
  private async acceptTotp(userId: string, credential: { secretEncrypted: string; lastUsedStep: number }, code: string, now: Date): Promise<boolean> {
    const secret = this.cipher.decrypt(credential.secretEncrypted, userId);
    const step = verifyTotp(secret, code, now.getTime(), { afterStep: credential.lastUsedStep });
    if (step === null) return false;
    const updated = await this.prisma.mfaCredential.updateMany({
      where: { userId, lastUsedStep: { lt: step } },
      data: { lastUsedStep: step },
    });
    return updated.count === 1;
  }

  private async acceptRecovery(userId: string, code: string, now: Date): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) return false;
    const used = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(normalized, this.env.mfaKey), usedAt: null },
      data: { usedAt: now },
    });
    return used.count === 1;
  }
}
