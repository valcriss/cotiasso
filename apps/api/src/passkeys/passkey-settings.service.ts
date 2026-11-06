import { Inject, Injectable } from "@nestjs/common";
import { PasskeyPolicyService } from "../auth/passkey-policy.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { PasskeysUnavailableError } from "./errors.js";
import { availabilityMessage, type PasskeyMode } from "./policy.js";

export interface PasskeySettingsView {
  /** Réglage de l'association. */
  mode: PasskeyMode;
  usernameless: boolean;
  /** Mode réellement appliqué (désactivé tant que le domaine ne le permet pas). */
  effectiveMode: PasskeyMode;
  domain: { ok: true; rpId: string } | { ok: false; reason: string; message: string };
  /** Clés actives utilisables aujourd'hui (domaine actuel). */
  usableKeys: number;
  /** Clés actives enregistrées sur un autre domaine : devenues inutilisables, à refaire. */
  otherDomainKeys: number;
  /** Comptes qui ont au moins une clé utilisable. */
  usersWithKeys: number;
}

@Injectable()
export class PasskeySettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasskeyPolicyService) private readonly policy: PasskeyPolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async view(): Promise<PasskeySettingsView> {
    const policy = await this.policy.current();
    const active = await this.prisma.passkeyCredential.findMany({ where: { revokedAt: null }, select: { rpId: true, userId: true } });
    const rpId = policy.availability.ok ? policy.availability.rpId : null;
    const usable = active.filter((row) => row.rpId === rpId);
    return {
      mode: policy.mode,
      usernameless: policy.mode === "FULL" && policy.usernameless,
      effectiveMode: policy.effectiveMode,
      domain: policy.availability.ok
        ? { ok: true, rpId: policy.availability.rpId }
        : { ok: false, reason: policy.availability.reason, message: availabilityMessage(policy.availability.reason) },
      usableKeys: usable.length,
      otherDomainKeys: active.length - usable.length,
      usersWithKeys: new Set(usable.map((row) => row.userId)).size,
    };
  }

  /**
   * Enregistre le réglage. Activer les clés d'accès exige un domaine utilisable (HTTPS) : sinon refus expliqué.
   * Repasser à « Désactivées » est toujours permis. La validation du contenu est celle du schéma de paramètres.
   */
  async update(input: unknown, actorId: string): Promise<PasskeySettingsView> {
    const requested = (input as { passkeyMode?: unknown } | null)?.passkeyMode;
    if (typeof requested === "string" && requested !== "DISABLED") {
      const policy = await this.policy.current();
      if (!policy.availability.ok) throw new PasskeysUnavailableError(availabilityMessage(policy.availability.reason));
    }
    await this.settings.update("security", input, actorId);
    return this.view();
  }
}
