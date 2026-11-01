import "@fastify/multipart";
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
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { FinancialAccountsService, type FinancialAccountView, type StatementView } from "./financial-accounts.service.js";
import {
  ImportRefusedError,
  ImportsService,
  OFX_MAX_BYTES,
  type ImportListItem,
  type ImportView,
} from "./imports.service.js";
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
    if (error instanceof ImportRefusedError) throw new UnprocessableEntityException(error.message);
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
    @Inject(ImportsService) private readonly imports: ImportsService,
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

  // --- Import de relevés OFX : analyse sans écriture, puis confirmation ---

  @RequirePermission("financial-accounts:view")
  @Get("financial-accounts/:id/imports")
  listImports(@Param("id", ParseUUIDPipe) id: string): Promise<ImportListItem[]> {
    return translate(() => this.imports.list(id));
  }

  @RequirePermission("imports:post")
  @Post("financial-accounts/:id/imports")
  async analyzeImport(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ImportView> {
    const file = await this.readOfx(request as unknown as FastifyRequest);
    return translate(() => this.imports.analyze(id, file, request.auth!.user.id));
  }

  @RequirePermission("financial-accounts:view")
  @Get("imports/:id")
  getImport(@Param("id", ParseUUIDPipe) id: string): Promise<ImportView> {
    return translate(() => this.imports.get(id));
  }

  @RequirePermission("imports:post")
  @Post("imports/:id/commit")
  @HttpCode(HttpStatus.OK)
  commitImport(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ImportView> {
    return translate(() => this.imports.commit(id, body, request.auth!.user.id));
  }

  @RequirePermission("imports:post")
  @Post("imports/:id/cancel")
  @HttpCode(HttpStatus.OK)
  cancelImport(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ImportView> {
    return translate(() => this.imports.cancel(id, request.auth!.user.id));
  }

  /** Lit le fichier envoyé en mémoire, plafonné : un relevé OFX est petit et doit être entièrement lu pour être analysé. */
  private async readOfx(request: FastifyRequest): Promise<{ name: string; bytes: Buffer }> {
    if (!request.isMultipart()) throw new UnsupportedMediaTypeException("Envoi multipart/form-data attendu.");
    let found: { name: string; bytes: Buffer } | null = null;
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (found) throw new BadRequestException("Un seul fichier à la fois.");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of part.file) {
        size += (chunk as Buffer).length;
        if (size > OFX_MAX_BYTES) {
          // Le reste du flux est consommé pour libérer la connexion, sans le conserver.
          part.file.resume();
          throw new PayloadTooLargeException(`Fichier trop volumineux (${Math.round(OFX_MAX_BYTES / 1024 / 1024)} Mo au plus).`);
        }
        chunks.push(chunk as Buffer);
      }
      found = { name: part.filename, bytes: Buffer.concat(chunks) };
    }
    if (!found) throw new BadRequestException("Aucun fichier reçu.");
    return found;
  }
}
