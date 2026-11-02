import { BadRequestException, Controller, Get, Inject, NotFoundException, Query } from "@nestjs/common";
import { AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import { RequirePermission } from "../authz/decorators.js";
import { RecoveryProgressService, type ProgressReport } from "./recovery-progress.service.js";

/** Tableau de progression de la reprise (lecture seule, ADR 0027) : mêmes droits de lecture que les lots de reprise. */
@Controller("recovery-progress")
export class RecoveryProgressController {
  constructor(@Inject(RecoveryProgressService) private readonly progress: RecoveryProgressService) {}

  @RequirePermission("entries:view")
  @Get()
  async report(@Query() query: unknown): Promise<ProgressReport> {
    try {
      return await this.progress.report(query);
    } catch (error) {
      if (error instanceof AccountingValidationError) throw new BadRequestException({ message: error.message, issues: error.issues });
      if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
