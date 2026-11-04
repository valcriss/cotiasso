import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { WorkflowsService, type VersionSummary, type VersionView, type WorkflowSummary } from "./workflows.service.js";

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

/** Circuits de validation : consultation `workflows:view`, réglage `workflows:admin` (ADR 0035). */
@Controller()
export class WorkflowsController {
  constructor(@Inject(WorkflowsService) private readonly workflows: WorkflowsService) {}

  @RequirePermission("workflows:view")
  @Get("workflows")
  list(): Promise<WorkflowSummary[]> {
    return this.workflows.list();
  }

  @RequirePermission("workflows:view")
  @Get("workflows/:subjectType")
  history(@Param("subjectType") subjectType: string): Promise<{ subjectType: string; label: string; versions: VersionSummary[] }> {
    return translate(() => this.workflows.history(subjectType));
  }

  @RequirePermission("workflows:admin")
  @Post("workflows/:subjectType/draft")
  createDraft(@Param("subjectType") subjectType: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<VersionView> {
    return translate(() => this.workflows.createDraft(subjectType, body, request.auth!.user.id));
  }

  @RequirePermission("workflows:view")
  @Get("workflow-versions/:id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<VersionView> {
    return translate(() => this.workflows.get(id));
  }

  @RequirePermission("workflows:admin")
  @Put("workflow-versions/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<VersionView> {
    return translate(() => this.workflows.updateDraft(id, body, request.auth!.user.id));
  }

  @RequirePermission("workflows:admin")
  @Delete("workflow-versions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await translate(() => this.workflows.deleteDraft(id, request.auth!.user.id));
  }

  @RequirePermission("workflows:admin")
  @Post("workflow-versions/:id/activate")
  @HttpCode(HttpStatus.OK)
  activate(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<VersionView> {
    return translate(() => this.workflows.activate(id, request.auth!.user.id));
  }
}
