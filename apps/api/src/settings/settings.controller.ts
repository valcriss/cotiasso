import "@fastify/multipart";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { Public } from "../auth/public.decorator.js";
import { RequirePermission } from "../authz/decorators.js";
import { BrandLogoService, LOGO_MAX_BYTES } from "./brand-logo.service.js";
import { InvalidLogoError, ModuleNotFoundError, ModuleStateError, ModuleUnavailableError, SettingsValidationError } from "./errors.js";
import { ModulesService, type ModuleView } from "./modules.service.js";
import { isSettingsSection, type SettingsSection } from "./schemas.js";
import { SettingsService, type SettingsVersionView } from "./settings.service.js";

function section(value: string): SettingsSection {
  if (!isSettingsSection(value)) throw new NotFoundException("Rubrique de paramètres inconnue.");
  return value;
}

function translate(error: unknown): never {
  if (error instanceof SettingsValidationError) {
    throw new BadRequestException({ message: error.message, issues: error.issues });
  }
  if (error instanceof ModuleNotFoundError) throw new NotFoundException(error.message);
  if (error instanceof ModuleUnavailableError || error instanceof ModuleStateError) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller()
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ModulesService) private readonly modules: ModulesService,
    @Inject(BrandLogoService) private readonly logo: BrandLogoService,
  ) {}

  /** Marque blanche affichée avant toute connexion (page de connexion, titre) : données publiques par nature. */
  @Public()
  @Get("branding")
  async branding(): Promise<Record<string, unknown>> {
    // `logoHash` change avec chaque logo : le navigateur peut garder l'image en cache sans jamais en afficher un ancien.
    const logo = await this.logo.state();
    return { ...(await this.settings.current("branding")), logoHash: logo.sha256, logoShowsName: logo.showName };
  }

  /** Logo en vigueur, public comme la marque blanche (la page de connexion l'affiche). Servi en image seule, jamais exécutable. */
  @Public()
  @Get("branding/logo")
  async logoFile(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer | undefined> {
    const file = await this.logo.current();
    if (!file) throw new NotFoundException("Aucun logo n'a été ajouté.");
    reply.header("ETag", `"${file.sha256}"`);
    reply.header("Cache-Control", "no-cache");
    reply.header("X-Content-Type-Options", "nosniff");
    // Même pour un SVG ouvert directement dans un onglet : aucun script, aucune ressource externe.
    reply.header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    reply.header("Content-Type", file.mimeType);
    if (request.headers["if-none-match"] === `"${file.sha256}"`) {
      reply.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return file.data;
  }

  @RequirePermission("settings.association:admin")
  @Put("branding/logo")
  async setLogo(@Req() request: AuthenticatedRequest): Promise<{ logoHash: string }> {
    const bytes = await this.readLogo(request as unknown as FastifyRequest);
    try {
      return { logoHash: await this.logo.set(bytes, request.auth!.user.id) };
    } catch (error) {
      if (error instanceof InvalidLogoError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Logo seul ou logo et nom de l'association (utile quand le logo contient déjà le nom). */
  @RequirePermission("settings.association:admin")
  @Put("branding/logo/display")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setLogoDisplay(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<void> {
    const showName = (body as { showName?: unknown } | null)?.showName;
    if (typeof showName !== "boolean") throw new BadRequestException("Indiquez si le nom de l'association doit s'afficher à côté du logo (showName : vrai ou faux).");
    await this.logo.setShowName(showName, request.auth!.user.id);
  }

  @RequirePermission("settings.association:admin")
  @Delete("branding/logo")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeLogo(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.logo.remove(request.auth!.user.id);
  }

  /** Lit l'image envoyée en mémoire, plafonnée : un logo est petit et doit être entièrement lu pour être contrôlé. */
  private async readLogo(request: FastifyRequest): Promise<Buffer> {
    if (!request.isMultipart()) throw new UnsupportedMediaTypeException("Envoi multipart/form-data attendu.");
    let found: Buffer | null = null;
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (found) throw new BadRequestException("Un seul fichier à la fois.");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of part.file) {
        size += (chunk as Buffer).length;
        if (size > LOGO_MAX_BYTES) {
          part.file.resume();
          throw new PayloadTooLargeException(`Ce logo est trop lourd (${Math.round(LOGO_MAX_BYTES / 1024)} Ko au plus). Réduisez-le ou enregistrez-le dans un format plus léger, puis réessayez.`);
        }
        chunks.push(chunk as Buffer);
      }
      found = Buffer.concat(chunks);
    }
    if (!found) throw new BadRequestException("Aucun fichier reçu. Choisissez une image, puis réessayez.");
    return found;
  }

  @RequirePermission("settings.association:view")
  @Get("settings/:section")
  async get(@Param("section") name: string): Promise<{ section: SettingsSection; value: Record<string, unknown> }> {
    const key = section(name);
    return { section: key, value: await this.settings.current(key) };
  }

  @RequirePermission("settings.association:view")
  @Get("settings/:section/history")
  history(@Param("section") name: string): Promise<SettingsVersionView[]> {
    return this.settings.history(section(name));
  }

  @RequirePermission("settings.association:admin")
  @Put("settings/:section")
  async update(
    @Param("section") name: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ changed: boolean; value: Record<string, unknown> }> {
    const key = section(name);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Corps de requête invalide.");
    }
    try {
      return await this.settings.update(key, body, request.auth!.user.id);
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("settings.association:view")
  @Get("modules")
  listModules(): Promise<ModuleView[]> {
    return this.modules.list();
  }

  @RequirePermission("settings.accounting:admin")
  @Post("modules/:key/activate")
  @HttpCode(HttpStatus.NO_CONTENT)
  async activate(@Param("key") key: string, @Req() request: AuthenticatedRequest): Promise<void> {
    try {
      await this.modules.activate(key, request.auth!.user.id);
    } catch (error) {
      translate(error);
    }
  }

  @RequirePermission("settings.accounting:admin")
  @Post("modules/:key/deactivate")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param("key") key: string, @Req() request: AuthenticatedRequest): Promise<void> {
    try {
      await this.modules.deactivate(key, request.auth!.user.id);
    } catch (error) {
      translate(error);
    }
  }
}

