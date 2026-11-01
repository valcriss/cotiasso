import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { Public } from "../auth/public.decorator.js";
import { RequirePermission } from "../authz/decorators.js";
import { ModuleNotFoundError, ModuleStateError, ModuleUnavailableError, SettingsValidationError } from "./errors.js";
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
  ) {}

  /** Marque blanche affichée avant toute connexion (page de connexion, titre) : données publiques par nature. */
  @Public()
  @Get("branding")
  branding(): Promise<Record<string, unknown>> {
    return this.settings.current("branding");
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

