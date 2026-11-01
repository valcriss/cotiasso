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
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { AccountingService, type AccountView, type FiscalYearView, type JournalView } from "./accounting.service.js";
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

/** Lecture : `entries:view`. Modification de la structure comptable : `settings.accounting:admin`. */
@Controller()
export class AccountingController {
  constructor(@Inject(AccountingService) private readonly accounting: AccountingService) {}

  @RequirePermission("entries:view")
  @Get("fiscal-years")
  fiscalYears(): Promise<FiscalYearView[]> {
    return this.accounting.listFiscalYears();
  }

  @RequirePermission("settings.accounting:admin")
  @Post("fiscal-years")
  createFiscalYear(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<FiscalYearView> {
    return translate(() => this.accounting.createFiscalYear(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Patch("fiscal-years/:id")
  updateFiscalYear(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<FiscalYearView> {
    return translate(() => this.accounting.updateFiscalYear(id, body, request.auth!.user.id));
  }

  @RequirePermission("entries:view")
  @Get("journals")
  journals(): Promise<JournalView[]> {
    return this.accounting.listJournals();
  }

  @RequirePermission("settings.accounting:admin")
  @Post("journals")
  createJournal(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<JournalView> {
    return translate(() => this.accounting.createJournal(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Patch("journals/:id")
  updateJournal(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JournalView> {
    return translate(() => this.accounting.updateJournal(id, body, request.auth!.user.id));
  }

  @RequirePermission("entries:view")
  @Get("accounts")
  accounts(): Promise<AccountView[]> {
    return this.accounting.listAccounts();
  }

  @RequirePermission("settings.accounting:admin")
  @Post("accounts")
  createAccount(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<AccountView> {
    return translate(() => this.accounting.createAccount(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Post("accounts/import")
  @HttpCode(HttpStatus.OK)
  importAccounts(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ created: number; skipped: number }> {
    return translate(() => this.accounting.importAccounts(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Patch("accounts/:id")
  updateAccount(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccountView> {
    return translate(() => this.accounting.updateAccount(id, body, request.auth!.user.id));
  }
}
