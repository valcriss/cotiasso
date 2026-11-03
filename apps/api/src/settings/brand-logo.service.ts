import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { InvalidLogoError } from "./errors.js";
import { readImageInfo } from "./image-info.js";
import { SettingsService } from "./settings.service.js";

/** Un logo est une petite image : au-delà, c'est presque sûrement une photo, trop lourde pour chaque page et chaque email. */
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MIN_SIDE = 32;
export const LOGO_MAX_SIDE = 2000;

export interface LogoFile {
  sha256: string;
  mimeType: string;
  data: Buffer;
}

/**
 * Logo de l'association (marque blanche). PNG, JPEG et SVG sont acceptés, reconnus d'après leur contenu. Un SVG est un
 * document actif : il n'est gardé que si, élément par élément, il ne contient que du dessin (voir image-info.ts), et il
 * n'est jamais servi autrement qu'en image sans exécution. Les images sont conservées (ajout seul) ; la section « logo »
 * désigne celle en vigueur.
 */
@Injectable()
export class BrandLogoService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Logo en vigueur (empreinte, null sans logo) et choix d'afficher ou non le nom de l'association à côté. */
  async state(): Promise<{ sha256: string | null; showName: boolean }> {
    const value = await this.settings.current("logo");
    return { sha256: value.sha256 as string | null, showName: value.showName as boolean };
  }

  async current(): Promise<LogoFile | null> {
    const { sha256 } = await this.state();
    if (!sha256) return null;
    const row = await this.prisma.brandLogo.findUnique({ where: { sha256 } });
    return row ? { sha256, mimeType: row.mimeType, data: Buffer.from(row.data) } : null;
  }

  async set(bytes: Buffer, actorId: string): Promise<string> {
    const info = readImageInfo(bytes);
    if (!info) {
      throw new InvalidLogoError("Ce fichier n'est pas un logo utilisable. Choisissez une image PNG, JPEG ou SVG. Un SVG qui contient des scripts, des liens ou des images externes est refusé : réexportez-le en dessin seul depuis votre logiciel de dessin, ou envoyez un PNG.");
    }
    const isSvg = info.mimeType === "image/svg+xml"; // un SVG n'a pas de taille en pixels : il s'adapte à toute taille
    if (!isSvg && (info.width < LOGO_MIN_SIDE || info.height < LOGO_MIN_SIDE)) {
      throw new InvalidLogoError(`Cette image est trop petite (${info.width} × ${info.height} px) : elle serait floue à l'écran. Choisissez une image d'au moins ${LOGO_MIN_SIDE} px de côté.`);
    }
    if (!isSvg && (info.width > LOGO_MAX_SIDE || info.height > LOGO_MAX_SIDE)) {
      throw new InvalidLogoError(`Cette image est trop grande (${info.width} × ${info.height} px). Réduisez-la à ${LOGO_MAX_SIDE} px de côté au plus, puis réessayez.`);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.prisma.brandLogo.upsert({
      where: { sha256 },
      create: { sha256, mimeType: info.mimeType, width: info.width, height: info.height, size: bytes.length, data: new Uint8Array(bytes) },
      update: {},
    });
    const { showName } = await this.state();
    const { changed } = await this.settings.update("logo", { sha256, showName }, actorId);
    if (changed) {
      await this.audit.record({ action: "branding.logo.updated", objectType: "Settings", objectId: "logo", actorId, details: { width: info.width, height: info.height } });
    }
    return sha256;
  }

  /** Affiche ou masque le nom de l'association à côté du logo (le choix est gardé même sans logo). */
  async setShowName(showName: boolean, actorId: string): Promise<void> {
    const { sha256 } = await this.state();
    const { changed } = await this.settings.update("logo", { sha256, showName }, actorId);
    if (changed) {
      await this.audit.record({ action: "branding.logo.display-changed", objectType: "Settings", objectId: "logo", actorId, details: { showName } });
    }
  }

  async remove(actorId: string): Promise<void> {
    const { showName } = await this.state();
    const { changed } = await this.settings.update("logo", { sha256: null, showName }, actorId);
    if (changed) {
      await this.audit.record({ action: "branding.logo.removed", objectType: "Settings", objectId: "logo", actorId, details: {} });
    }
  }
}
