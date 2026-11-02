import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import { FrozenReportsService, type FrozenReportDetail, type FrozenReportSummary } from "./frozen-reports.service.js";

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

/** Rapports figés (ADR 0031) : lecture `reports:view` ; figer et faire approuver `fiscal-years:close` (un enregistrement qui ne se défait pas). */
@Controller()
export class FrozenReportsController {
  constructor(@Inject(FrozenReportsService) private readonly frozen: FrozenReportsService) {}

  @RequirePermission("reports:view")
  @Get("fiscal-years/:id/frozen-reports")
  list(@Param("id", ParseUUIDPipe) id: string): Promise<FrozenReportSummary[]> {
    return translate(() => this.frozen.list(id));
  }

  @RequirePermission("fiscal-years:close")
  @Post("fiscal-years/:id/frozen-reports")
  freeze(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<FrozenReportSummary> {
    return translate(() => this.frozen.freezeManually(id, body, request.auth!.user.id));
  }

  @RequirePermission("reports:view")
  @Get("frozen-reports/:id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<FrozenReportDetail> {
    return translate(() => this.frozen.get(id));
  }

  @RequirePermission("fiscal-years:close")
  @HttpCode(HttpStatus.OK)
  @Post("frozen-reports/:id/approve")
  approve(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<FrozenReportSummary> {
    return translate(() => this.frozen.approve(id, body, request.auth!.user.id));
  }
}
