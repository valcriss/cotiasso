import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission, RequireProjectAccess } from "../authz/decorators.js";
import { BudgetsService, type BudgetSummary, type BudgetView } from "./budgets.service.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import { ParticipantsService, type ParticipantView } from "./participants.service.js";

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
 * Budgets et participants d'un projet (ADR 0024, tranche 4.1). Lecture `projects:view` (filtrée par la portée projet),
 * préparation `budgets:update`, approbation `budgets:approve` : celui qui prépare n'est pas forcément celui qui approuve.
 */
@Controller()
export class BudgetsController {
  constructor(
    @Inject(BudgetsService) private readonly budgets: BudgetsService,
    @Inject(ParticipantsService) private readonly participants: ParticipantsService,
  ) {}

  @RequireProjectAccess("projects:view")
  @Get("projects/:id/budgets")
  list(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<BudgetSummary[]> {
    return translate(() => this.budgets.list(id, request.projectAccess));
  }

  @RequireProjectAccess("projects:view")
  @Get("budgets/:id")
  get(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<BudgetView> {
    return translate(() => this.budgets.get(id, request.projectAccess));
  }

  @RequirePermission("budgets:update")
  @Post("projects/:id/budgets")
  create(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<BudgetView> {
    return translate(() => this.budgets.create(id, body, request.auth!.user.id));
  }

  @RequirePermission("budgets:update")
  @Put("budgets/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<BudgetView> {
    return translate(() => this.budgets.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("budgets:approve")
  @Post("budgets/:id/approve")
  @HttpCode(200)
  approve(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<BudgetView> {
    return translate(() => this.budgets.approve(id, request.auth!.user.id));
  }

  @RequirePermission("budgets:update")
  @Delete("budgets/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await translate(() => this.budgets.remove(id, request.auth!.user.id));
  }

  @RequireProjectAccess("projects:view")
  @Get("projects/:id/participants")
  listParticipants(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ParticipantView[]> {
    return translate(() => this.participants.list(id, request.projectAccess));
  }

  @RequireProjectAccess("projects:update")
  @Post("projects/:id/participants")
  addParticipant(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ParticipantView> {
    return translate(() => this.participants.add(id, body, request.auth!.user.id, request.projectAccess));
  }

  @RequireProjectAccess("projects:update")
  @Patch("project-participants/:id")
  updateParticipant(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ParticipantView> {
    return translate(() => this.participants.update(id, body, request.auth!.user.id, request.projectAccess));
  }

  @RequireProjectAccess("projects:update")
  @Delete("project-participants/:id")
  @HttpCode(204)
  async removeParticipant(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await translate(() => this.participants.remove(id, request.auth!.user.id, request.projectAccess));
  }
}
