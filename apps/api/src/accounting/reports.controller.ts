import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { RequirePermission } from "../authz/decorators.js";
import { AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import {
  ReportTooLargeError,
  ReportsService,
  type JournalBookEntry,
  type LedgerAccount,
  type TrialBalance,
} from "./reports.service.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) {
      throw new BadRequestException({ message: error.message, issues: error.issues });
    }
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof ReportTooLargeError) throw new UnprocessableEntityException(error.message);
    throw error;
  }
}

/** États de lecture : ils détaillent les écritures, ils exigent donc `entries:view` (jamais seulement `reports:view`). */
@Controller("reports")
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @RequirePermission("entries:view")
  @Get("ledger")
  ledger(@Query() query: unknown): Promise<{ accounts: LedgerAccount[] }> {
    return translate(() => this.reports.ledger(query));
  }

  @RequirePermission("entries:view")
  @Get("trial-balance")
  trialBalance(@Query() query: unknown): Promise<TrialBalance> {
    return translate(() => this.reports.trialBalance(query));
  }

  @RequirePermission("entries:view")
  @Get("journal")
  journal(@Query() query: unknown): Promise<{ entries: JournalBookEntry[] }> {
    return translate(() => this.reports.journalBook(query));
  }
}
