import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { FinancialAccountsService, type FinancialAccountView, type StatementView } from "./financial-accounts.service.js";
import { TransactionsService, type TransactionView } from "./transactions.service.js";

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
 * Trésorerie : consultation `financial-accounts:view`, saisie des transactions `transactions:manage`, relevés
 * `imports:post`, création et archivage des comptes `settings.accounting:admin`.
 */
@Controller()
export class TreasuryController {
  constructor(
    @Inject(FinancialAccountsService) private readonly accounts: FinancialAccountsService,
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
  ) {}

  @RequirePermission("financial-accounts:view")
  @Get("financial-accounts")
  list(): Promise<FinancialAccountView[]> {
    return this.accounts.list();
  }

  @RequirePermission("financial-accounts:view")
  @Get("financial-accounts/:id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<FinancialAccountView> {
    return translate(() => this.accounts.get(id));
  }

  @RequirePermission("settings.accounting:admin")
  @Post("financial-accounts")
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<FinancialAccountView> {
    return translate(() => this.accounts.create(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Patch("financial-accounts/:id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<FinancialAccountView> {
    return translate(() => this.accounts.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("financial-accounts:view")
  @Get("financial-accounts/:id/statements")
  statements(@Param("id", ParseUUIDPipe) id: string): Promise<StatementView[]> {
    return translate(() => this.accounts.listStatements(id));
  }

  @RequirePermission("imports:post")
  @Post("financial-accounts/:id/statements")
  addStatement(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<StatementView> {
    return translate(() => this.accounts.addStatement(id, body, request.auth!.user.id));
  }

  @RequirePermission("financial-accounts:view")
  @Get("financial-accounts/:id/transactions")
  listTransactions(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ): Promise<{ transactions: TransactionView[]; next: string | null }> {
    return translate(() => this.transactions.list(id, query));
  }

  @RequirePermission("transactions:manage")
  @Post("financial-accounts/:id/transactions")
  createTransaction(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<TransactionView> {
    return translate(() => this.transactions.create(id, body, request.auth!.user.id));
  }

  @RequirePermission("transactions:manage")
  @Patch("transactions/:id")
  updateTransaction(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<TransactionView> {
    return translate(() => this.transactions.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("transactions:manage")
  @Delete("transactions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTransaction(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await translate(() => this.transactions.remove(id, request.auth!.user.id));
  }
}
