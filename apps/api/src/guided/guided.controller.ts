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
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { Authenticated, RequirePermission } from "../authz/decorators.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { CategoriesService, type CategoryView, type TemplateResult } from "./categories.service.js";
import { OperationsService, type OperationResult } from "./operations.service.js";
import { OverviewService, type OverviewView } from "./overview.service.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) throw new BadRequestException({ message: error.message, issues: error.issues });
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof AccountingConflictError) throw new ConflictException(error.message);
    throw error;
  }
}

/**
 * Parcours simplifiés (ADR 0028) : vue d'ensemble « À faire » (tout utilisateur connecté, filtrée selon ses droits),
 * catégories en langage courant, modèle de démarrage et saisie guidée d'une opération.
 */
@Controller()
export class GuidedController {
  constructor(
    @Inject(CategoriesService) private readonly categories: CategoriesService,
    @Inject(OperationsService) private readonly operations: OperationsService,
    @Inject(OverviewService) private readonly overviewService: OverviewService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
  ) {}

  @Authenticated()
  @Get("overview")
  overview(@Req() request: AuthenticatedRequest): Promise<OverviewView> {
    return this.overviewService.overview(request.auth!.user.id);
  }

  @RequirePermission("financial-accounts:view")
  @Get("operation-categories")
  listCategories(): Promise<CategoryView[]> {
    return this.categories.list();
  }

  @RequirePermission("settings.accounting:admin")
  @Get("operation-categories/all")
  listAllCategories(): Promise<CategoryView[]> {
    return this.categories.list(true);
  }

  @RequirePermission("settings.accounting:admin")
  @Post("operation-categories")
  createCategory(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CategoryView> {
    return translate(() => this.categories.create(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Patch("operation-categories/:id")
  updateCategory(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CategoryView> {
    return translate(() => this.categories.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @HttpCode(HttpStatus.OK)
  @Post("starter-template")
  applyStarterTemplate(@Req() request: AuthenticatedRequest): Promise<TemplateResult> {
    return translate(() => this.categories.applyStarterTemplate(request.auth!.user.id));
  }

  @RequirePermission("transactions:manage", "entries:create")
  @Post("guided-operations")
  async record(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OperationResult> {
    const userId = request.auth!.user.id;
    const canPost = (await this.authz.permissionsFor(userId)).has("entries:post");
    return translate(() => this.operations.record(body, userId, canPost));
  }
}
