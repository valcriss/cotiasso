import { isDeepStrictEqual } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsValidationError } from "./errors.js";
import { SETTINGS_SECTIONS, type SettingsSection } from "./schemas.js";

export interface SettingsVersionView {
  id: string;
  effectiveFrom: Date;
  createdAt: Date;
  createdBy: string | null;
  payload: Record<string, unknown>;
}

/**
 * Paramètres de l'association, versionnés : chaque modification crée une nouvelle version (ajout seul en base) ;
 * l'historique n'est jamais réécrit. Le contenu est validé par un schéma avant toute écriture.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Valeur en vigueur à la date donnée ; les valeurs par défaut tant que rien n'a été enregistré. */
  async current(section: SettingsSection, at: Date = new Date()): Promise<Record<string, unknown>> {
    const { schema, defaults } = SETTINGS_SECTIONS[section];
    const row = await this.prisma.settingsVersion.findFirst({
      where: { section, effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });
    if (!row) return { ...defaults };

    // Un ancien contenu est complété par les valeurs par défaut si le schéma a gagné des champs depuis.
    const parsed = schema.safeParse({ ...defaults, ...(row.payload as object) });
    return parsed.success ? (parsed.data as Record<string, unknown>) : { ...defaults };
  }

  async history(section: SettingsSection, limit = 50): Promise<SettingsVersionView[]> {
    const rows = await this.prisma.settingsVersion.findMany({
      where: { section },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      effectiveFrom: row.effectiveFrom,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      payload: row.payload as Record<string, unknown>,
    }));
  }

  /** Enregistre une nouvelle version si le contenu change. Renvoie la valeur en vigueur après l'opération. */
  async update(
    section: SettingsSection,
    input: unknown,
    actorId: string,
  ): Promise<{ changed: boolean; value: Record<string, unknown> }> {
    const parsed = SETTINGS_SECTIONS[section].schema.safeParse(input);
    if (!parsed.success) {
      throw new SettingsValidationError(
        parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
    }
    const next = parsed.data as Record<string, unknown>;
    const before = await this.current(section);
    if (isDeepStrictEqual(before, next)) return { changed: false, value: before };

    await this.prisma.settingsVersion.create({
      data: { section, payload: next as Prisma.InputJsonObject, createdBy: actorId },
    });
    const changedKeys = Object.keys(next).filter((key) => !isDeepStrictEqual(before[key], next[key]));
    await this.audit.record({
      action: "settings.updated",
      objectType: "Settings",
      objectId: section,
      actorId,
      details: { section, changedKeys },
    });
    return { changed: true, value: next };
  }
}
