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
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { Authenticated, RequirePermission } from "../authz/decorators.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { CategoriesService, type CategoryView, type TemplateResult } from "./categories.service.js";
import { OpeningSituationService, type OpeningSituationResult, type OpeningSituationView, type StartMode } from "./opening-situation.service.js";
import { OperationsService, type BulkBookResult, type OperationResult } from "./operations.service.js";
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
    @Inject(OpeningSituationService) private readonly situation: OpeningSituationService,
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

  @RequirePermission("transactions:manage", "entries:create")
  @Post("transactions/:id/book")
  async book(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OperationResult> {
    const userId = request.auth!.user.id;
    const canPost = (await this.authz.permissionsFor(userId)).has("entries:post");
    return translate(() => this.operations.book(id, body, userId, canPost));
  }

  /** Corrige une opération enregistrée (catégorie, projet, description) : contrepassation et nouvelle écriture d'un bloc. */
  @RequirePermission("transactions:manage", "entries:create", "entries:post")
  @HttpCode(HttpStatus.OK)
  @Post("transactions/:id/correct")
  async correct(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OperationResult & { reversedEntryId: string }> {
    const userId = request.auth!.user.id;
    return translate(() => this.operations.correct(id, body, userId, true));
  }

  /** Corrige un montant par un mouvement de régularisation de l'écart (ADR 0032). */
  @RequirePermission("transactions:manage", "entries:create")
  @Post("transactions/:id/adjust-amount")
  async adjustAmount(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const userId = request.auth!.user.id;
    const canPost = (await this.authz.permissionsFor(userId)).has("entries:post");
    return translate(() => this.operations.adjustAmount(id, body, userId, canPost));
  }

  @RequirePermission("transactions:manage", "entries:create")
  @HttpCode(HttpStatus.OK)
  @Post("financial-accounts/:id/transactions/book")
  async bookMany(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<BulkBookResult> {
    const userId = request.auth!.user.id;
    const canPost = (await this.authz.permissionsFor(userId)).has("entries:post");
    return translate(() => this.operations.bookMany(id, body ?? {}, userId, canPost));
  }

  /** Mode de démarrage (ADR 0029) : reprise de l'historique ou situation d'ouverture. */
  @RequirePermission("settings.accounting:admin")
  @Put("start-mode")
  setStartMode(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<{ mode: StartMode }> {
    return translate(() => this.situation.setMode(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Get("opening-situation")
  openingSituation(@Query("date") date?: string): Promise<OpeningSituationView> {
    return translate(() => this.situation.view(date));
  }

  @RequirePermission("settings.accounting:admin", "entries:create")
  @Post("opening-situation")
  async recordOpeningSituation(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OpeningSituationResult> {
    const userId = request.auth!.user.id;
    const canPost = (await this.authz.permissionsFor(userId)).has("entries:post");
    return translate(() => this.situation.record(body, userId, canPost));
  }
}
