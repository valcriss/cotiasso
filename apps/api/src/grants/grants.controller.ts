import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
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
import { RequirePermission, RequireProjectAccess } from "../authz/decorators.js";
import { FundersService, type FunderView } from "./funders.service.js";
import { GrantsService, type GrantView } from "./grants.service.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) {
      throw new BadRequestException({ message: error.message, issues: error.issues });
    }
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof AccountingConflictError) throw new ConflictException(error.message);
    throw error;
  }
}

/**
 * Financeurs et subventions (ADR 0024, tranche 4.3a). Lecture des subventions `grants:view`, filtrée par la portée projet :
 * une subvention n'est visible que si elle finance un projet de la portée (hors portée : introuvable). Écriture
 * `grants:manage` (global). La liste des financeurs est réservée au droit global `grants:view`.
 */
@Controller()
export class GrantsController {
  constructor(
    @Inject(FundersService) private readonly funders: FundersService,
    @Inject(GrantsService) private readonly grants: GrantsService,
  ) {}

  @RequirePermission("grants:view")
  @Get("funders")
  listFunders(): Promise<FunderView[]> {
    return this.funders.list();
  }

  @RequirePermission("grants:manage")
  @Post("funders")
  createFunder(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<FunderView> {
    return translate(() => this.funders.create(body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Patch("funders/:id")
  updateFunder(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<FunderView> {
    return translate(() => this.funders.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Post("funders/:id/archive")
  @HttpCode(200)
  archiveFunder(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<FunderView> {
    return translate(() => this.funders.archive(id, request.auth!.user.id));
  }

  @RequireProjectAccess("grants:view")
  @Get("grants")
  list(@Query() query: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView[]> {
    return translate(() => this.grants.list(query, request.projectAccess));
  }

  @RequireProjectAccess("grants:view")
  @Get("projects/:id/grants")
  listForProject(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<GrantView[]> {
    return translate(() => this.grants.listForProject(id, request.projectAccess));
  }

  @RequireProjectAccess("grants:view")
  @Get("grants/:id")
  get(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.get(id, request.projectAccess));
  }

  @RequirePermission("grants:manage")
  @Post("grants")
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.create(body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Patch("grants/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Put("grants/:id/allocations")
  setAllocations(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.setAllocations(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Post("grants/:id/review")
  @HttpCode(200)
  review(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.review(id, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Post("grants/:id/grant")
  @HttpCode(200)
  grant(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.grant(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Post("grants/:id/refuse")
  @HttpCode(200)
  refuse(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.refuse(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Post("grants/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.cancel(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Post("grants/:id/close")
  @HttpCode(200)
  close(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantView> {
    return translate(() => this.grants.close(id, body, request.auth!.user.id));
  }
}
