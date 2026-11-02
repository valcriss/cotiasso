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
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission, RequireProjectAccess } from "../authz/decorators.js";
import { CommitmentsService, type CommitmentView, type EntryCandidate } from "./commitments.service.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";

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
 * Engagements d'un projet (ADR 0024, tranche 4.2). Lecture `projects:view` (filtrée par la portée projet) ; écriture
 * `budgets:update` (global). Solder lie une écriture comptable : il exige aussi `entries:view`.
 */
@Controller()
export class CommitmentsController {
  constructor(@Inject(CommitmentsService) private readonly commitments: CommitmentsService) {}

  @RequireProjectAccess("projects:view")
  @Get("projects/:id/commitments")
  list(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<CommitmentView[]> {
    return translate(() => this.commitments.list(id, request.projectAccess));
  }

  @RequirePermission("budgets:update")
  @Post("projects/:id/commitments")
  create(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CommitmentView> {
    return translate(() => this.commitments.create(id, body, request.auth!.user.id));
  }

  @RequirePermission("budgets:update")
  @Patch("commitments/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CommitmentView> {
    return translate(() => this.commitments.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("budgets:update", "entries:view")
  @Post("commitments/:id/settle")
  @HttpCode(200)
  settle(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CommitmentView> {
    return translate(() => this.commitments.settle(id, body, request.auth!.user.id));
  }

  @RequirePermission("budgets:update")
  @Post("commitments/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CommitmentView> {
    return translate(() => this.commitments.cancel(id, body, request.auth!.user.id));
  }

  @RequirePermission("budgets:update", "entries:view")
  @Get("commitments/:id/entry-candidates")
  candidates(@Param("id", ParseUUIDPipe) id: string): Promise<EntryCandidate[]> {
    return translate(() => this.commitments.candidates(id));
  }
}
