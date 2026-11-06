import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { passkeyAvailability, allowsSecondFactor, type PasskeyAvailability, type PasskeyMode } from "../passkeys/policy.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { SecuritySettings } from "../settings/schemas.js";
import { SettingsService } from "../settings/settings.service.js";

export interface PasskeyPolicy {
  /** Réglage de l'association. */
  mode: PasskeyMode;
  usernameless: boolean;
  availability: PasskeyAvailability;
  /** Mode réellement appliqué : désactivé tant que le domaine de l'application ne permet pas les clés d'accès. */
  effectiveMode: PasskeyMode;
}

/**
 * Règle d'usage des clés d'accès (ADR 0036) : réglage de l'association et domaine de l'application. Placée dans le module
 * d'authentification parce que l'état du second facteur de chaque requête en dépend.
 */
@Injectable()
export class PasskeyPolicyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async current(): Promise<PasskeyPolicy> {
    const value = (await this.settings.current("security")) as unknown as SecuritySettings;
    const availability = passkeyAvailability(this.env.publicUrl);
    const effectiveMode: PasskeyMode = availability.ok ? value.passkeyMode : "DISABLED";
    return { mode: value.passkeyMode, usernameless: value.passkeyUsernameless && effectiveMode === "FULL", availability, effectiveMode };
  }

  /**
   * Clés utilisables aujourd'hui : actives, enregistrées sur le domaine actuel, et seulement si l'association autorise
   * les clés d'accès. Une clé d'un ancien domaine ne compte pas comme second facteur.
   */
  async usableCount(userId: string, policy?: PasskeyPolicy): Promise<number> {
    const current = policy ?? (await this.current());
    if (!current.availability.ok || !allowsSecondFactor(current.effectiveMode)) return 0;
    return this.prisma.passkeyCredential.count({ where: { userId, revokedAt: null, rpId: current.availability.rpId } });
  }
}
