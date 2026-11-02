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
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { safeFilename, toCsv } from "../accounting/csv.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission, RequireProjectAccess } from "../authz/decorators.js";
import { GrantExpensesService, type ExpenseCandidate, type GrantExpenses, type GrantReport } from "./grant-expenses.service.js";
import { grantReportCsv } from "./grant-report-csv.js";

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
 * Dépenses affectées à une subvention et compte rendu pour le financeur (ADR 0024, tranche 4.4). Lecture `grants:view`
 * (portée projet : hors portée, introuvable) ; écriture `grants:manage` ; la liste des dépenses candidates montre des
 * écritures comptables : elle exige aussi `entries:view`.
 */
@Controller()
export class GrantExpensesController {
  constructor(
    @Inject(GrantExpensesService) private readonly service: GrantExpensesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequireProjectAccess("grants:view")
  @Get("grants/:id/expenses")
  list(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<GrantExpenses> {
    return translate(() => this.service.expenses(id, request.projectAccess));
  }

  @RequirePermission("grants:manage")
  @Post("grants/:id/expenses")
  attach(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantExpenses> {
    return translate(() => this.service.attach(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage")
  @Post("grant-expenses/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<GrantExpenses> {
    return translate(() => this.service.cancel(id, body, request.auth!.user.id));
  }

  @RequirePermission("grants:manage", "entries:view")
  @Get("grants/:id/expense-candidates")
  candidates(@Param("id", ParseUUIDPipe) id: string): Promise<ExpenseCandidate[]> {
    return translate(() => this.service.candidates(id));
  }

  @RequireProjectAccess("grants:view")
  @Get("grants/:id/report")
  report(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown, @Req() request: AuthenticatedRequest): Promise<GrantReport> {
    return translate(() => this.service.report(id, query, request.projectAccess));
  }

  /** Export CSV sûr (ADR 0021), tracé sans en garder le contenu. */
  @RequireProjectAccess("grants:view")
  @Get("grants/:id/report/csv")
  async reportCsv(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const report = await translate(() => this.service.report(id, query, request.projectAccess));
    await this.audit.record({
      action: "report.exported",
      objectType: "Report",
      actorId: request.auth!.user.id,
      details: { kind: "grant-report", grantId: id, query: query as Record<string, string> },
    });
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${safeFilename(`compte rendu ${report.grant.title}`)}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    return toCsv(grantReportCsv(report));
  }
}
