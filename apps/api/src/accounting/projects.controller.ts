import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { SettingsService } from "../settings/settings.service.js";
import { SettingsValidationError } from "../settings/errors.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import { ProjectsService, type ProjectSummary, type ProjectView } from "./projects.service.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) {
      throw new BadRequestException({ message: error.message, issues: error.issues });
    }
    if (error instanceof SettingsValidationError) {
      throw new BadRequestException({ message: error.message, issues: error.issues });
    }
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof AccountingConflictError) throw new ConflictException(error.message);
    throw error;
  }
}

/**
 * Projets : lecture `projects:view`, modification `projects:update` (portée globale pour l'instant ; la portée par
 * projet viendra avec les attributions de rôle à portée). Les paramètres comptables relèvent de `settings.accounting:admin`.
 */
@Controller()
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @RequirePermission("projects:view")
  @Get("projects")
  list(): Promise<ProjectView[]> {
    return this.projects.list();
  }

  @RequirePermission("projects:view")
  @Get("projects/:id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<ProjectView> {
    return translate(() => this.projects.get(id));
  }

  @RequirePermission("projects:view")
  @Get("projects/:id/summary")
  summary(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown): Promise<ProjectSummary> {
    return translate(() => this.projects.summary(id, query));
  }

  @RequirePermission("projects:update")
  @Post("projects")
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ProjectView> {
    return translate(() => this.projects.create(body, request.auth!.user.id));
  }

  @RequirePermission("projects:update")
  @Patch("projects/:id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ProjectView> {
    return translate(() => this.projects.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("entries:view")
  @Get("accounting/settings")
  accountingSettings(): Promise<Record<string, unknown>> {
    return this.settings.current("accounting");
  }

  @RequirePermission("settings.accounting:admin")
  @Put("accounting/settings")
  updateAccountingSettings(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ changed: boolean; value: Record<string, unknown> }> {
    return translate(() => this.settings.update("accounting", body, request.auth!.user.id));
  }
}
