import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ModuleNotFoundError, ModuleStateError, ModuleUnavailableError } from "./errors.js";
import { MODULE_CATALOG, type ModuleDefinition } from "./modules-catalog.js";

export type ModuleStatus = "ACTIVE" | "INACTIVE" | "UNAVAILABLE";

export interface ModuleView {
  key: string;
  label: string;
  description: string;
  status: ModuleStatus;
  /** Présent pour un module indisponible : pourquoi, ou ce qui manque. */
  reason: string | null;
  requires: string[];
  activatedAt: Date | null;
}

/**
 * Registre des modules activables par association (ADR 0002 et 0003). Un module non livré ou dont un prérequis
 * manque ne peut pas être activé : jamais de traitement incomplet accepté silencieusement.
 */
@Injectable()
export class ModulesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MODULE_CATALOG) private readonly catalog: readonly ModuleDefinition[],
  ) {}

  async list(): Promise<ModuleView[]> {
    const activations = await this.prisma.moduleActivation.findMany();
    const active = new Map(activations.filter((a) => a.deactivatedAt === null).map((a) => [a.key, a.activatedAt]));

    return this.catalog.map((definition) => {
      const missing = (definition.requires ?? []).filter((key) => !active.has(key));
      const status: ModuleStatus = active.has(definition.key) ? "ACTIVE" : definition.available ? "INACTIVE" : "UNAVAILABLE";
      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        status,
        reason:
          status === "UNAVAILABLE"
            ? (definition.unavailableReason ?? "Module indisponible.")
            : status === "INACTIVE" && missing.length > 0
              ? `Prérequis à activer d'abord : ${missing.map((key) => this.labelOf(key)).join(", ")}.`
              : null,
        requires: definition.requires ?? [],
        activatedAt: active.get(definition.key) ?? null,
      };
    });
  }

  async activate(key: string, actorId: string, now: Date = new Date()): Promise<void> {
    const definition = this.find(key);
    if (!definition.available) throw new ModuleUnavailableError(definition.unavailableReason ?? "");

    const views = await this.list();
    if (views.find((v) => v.key === key)?.status === "ACTIVE") throw new ModuleStateError("Ce module est déjà actif.");

    const missing = (definition.requires ?? []).filter((required) => views.find((v) => v.key === required)?.status !== "ACTIVE");
    if (missing.length > 0) {
      throw new ModuleStateError(`Prérequis à activer d'abord : ${missing.map((m) => this.labelOf(m)).join(", ")}.`);
    }

    await this.prisma.moduleActivation.upsert({
      where: { key },
      create: { key, activatedAt: now, activatedBy: actorId },
      update: { activatedAt: now, activatedBy: actorId, deactivatedAt: null, deactivatedBy: null },
    });
    await this.audit.record({ action: "module.activated", objectType: "Module", objectId: key, actorId });
  }

  /** Désactive un module, sauf si un autre module actif en dépend. Les écritures validées ne sont jamais recalculées. */
  async deactivate(key: string, actorId: string, now: Date = new Date()): Promise<void> {
    this.find(key);
    const views = await this.list();
    if (views.find((v) => v.key === key)?.status !== "ACTIVE") throw new ModuleStateError("Ce module n'est pas actif.");

    const dependents = views.filter((v) => v.status === "ACTIVE" && v.requires.includes(key));
    if (dependents.length > 0) {
      throw new ModuleStateError(`Désactivez d'abord : ${dependents.map((d) => d.label).join(", ")}.`);
    }

    await this.prisma.moduleActivation.update({ where: { key }, data: { deactivatedAt: now, deactivatedBy: actorId } });
    await this.audit.record({ action: "module.deactivated", objectType: "Module", objectId: key, actorId });
  }

  private find(key: string): ModuleDefinition {
    const definition = this.catalog.find((m) => m.key === key);
    if (!definition) throw new ModuleNotFoundError();
    return definition;
  }

  private labelOf(key: string): string {
    return this.catalog.find((m) => m.key === key)?.label ?? key;
  }
}
