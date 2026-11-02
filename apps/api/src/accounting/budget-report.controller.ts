import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequireProjectAccess } from "../authz/decorators.js";
import { BudgetReportService, type BudgetReport } from "./budget-report.service.js";
import { safeFilename, toCsv } from "./csv.js";
import { AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import { budgetReportCsv } from "./exports.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) {
      throw new BadRequestException({ message: error.message, issues: error.issues });
    }
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    throw error;
  }
}

/** Rapport budgétaire d'un projet : lecture `projects:view`, filtrée par la portée projet (hors portée : introuvable). */
@Controller("projects")
export class BudgetReportController {
  constructor(
    @Inject(BudgetReportService) private readonly reports: BudgetReportService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequireProjectAccess("projects:view")
  @Get(":id/budget-report")
  report(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown, @Req() request: AuthenticatedRequest): Promise<BudgetReport> {
    return translate(() => this.reports.report(id, query, request.projectAccess));
  }

  /** Export CSV sûr (ADR 0021), tracé sans en garder le contenu. */
  @RequireProjectAccess("projects:view")
  @Get(":id/budget-report/csv")
  async csv(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const report = await translate(() => this.reports.report(id, query, request.projectAccess));
    await this.audit.record({
      action: "report.exported",
      objectType: "Report",
      actorId: request.auth!.user.id,
      details: { kind: "project-budget", projectId: id, query: query as Record<string, string> },
    });
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${safeFilename(`budget ${report.project.code}`)}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    return toCsv(budgetReportCsv(report));
  }
}
