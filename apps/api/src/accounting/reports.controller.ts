import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { safeFilename, toCsv, type CsvCell } from "./csv.js";
import { balanceSheetCsv, incomeStatementCsv, journalBookCsv, ledgerCsv, trialBalanceCsv, treasuryStatementCsv } from "./exports.js";
import { StatementsService, type BalanceSheet, type IncomeStatement, type TreasuryStatement } from "./statements.service.js";
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
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(StatementsService) private readonly statements: StatementsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Envoie un CSV en pièce jointe (ADR 0021) et trace l'export, sans en garder le contenu. */
  private async sendCsv(reply: FastifyReply, request: AuthenticatedRequest, kind: string, name: string, rows: CsvCell[][], query: unknown): Promise<string> {
    await this.audit.record({ action: "report.exported", objectType: "Report", actorId: request.auth!.user.id, details: { kind, query: query as Record<string, string> } });
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${safeFilename(name)}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    return toCsv(rows);
  }

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

  /** Compte de résultat et bilan (ADR 0020) : des synthèses, sans le détail des écritures : `reports:view`. */
  @RequirePermission("reports:view")
  @Get("income-statement")
  incomeStatement(@Query() query: unknown): Promise<IncomeStatement> {
    return translate(() => this.statements.incomeStatement(query));
  }

  @RequirePermission("reports:view")
  @Get("balance-sheet")
  balanceSheet(@Query() query: unknown): Promise<BalanceSheet> {
    return translate(() => this.statements.balanceSheet(query));
  }

  @RequirePermission("reports:view")
  @Get("treasury")
  treasury(@Query() query: unknown): Promise<TreasuryStatement> {
    return translate(() => this.statements.treasuryStatement(query));
  }

  @RequirePermission("reports:view")
  @Get("income-statement/csv")
  async incomeStatementCsv(@Query() query: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const statement = await translate(() => this.statements.incomeStatement(query));
    return this.sendCsv(reply, request, "income-statement", `compte de resultat ${statement.fiscalYear.label}`, incomeStatementCsv(statement), query);
  }

  @RequirePermission("reports:view")
  @Get("balance-sheet/csv")
  async balanceSheetCsv(@Query() query: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const sheet = await translate(() => this.statements.balanceSheet(query));
    return this.sendCsv(reply, request, "balance-sheet", `bilan ${sheet.fiscalYear.label}`, balanceSheetCsv(sheet), query);
  }

  @RequirePermission("reports:view")
  @Get("treasury/csv")
  async treasuryCsv(@Query() query: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const statement = await translate(() => this.statements.treasuryStatement(query));
    return this.sendCsv(reply, request, "treasury", `tresorerie ${statement.fiscalYear.label}`, treasuryStatementCsv(statement), query);
  }

  @RequirePermission("entries:view")
  @Get("ledger/csv")
  async ledgerCsv(@Query() query: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const ledger = await translate(() => this.reports.ledger(query));
    return this.sendCsv(reply, request, "ledger", "grand livre", ledgerCsv(ledger), query);
  }

  @RequirePermission("entries:view")
  @Get("trial-balance/csv")
  async trialBalanceCsv(@Query() query: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const balance = await translate(() => this.reports.trialBalance(query));
    return this.sendCsv(reply, request, "trial-balance", "balance", trialBalanceCsv(balance), query);
  }

  @RequirePermission("entries:view")
  @Get("journal/csv")
  async journalCsv(@Query() query: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const book = await translate(() => this.reports.journalBook(query));
    return this.sendCsv(reply, request, "journal", "livre-journal", journalBookCsv(book), query);
  }

  @RequirePermission("entries:view")
  @Get("journal")
  journal(@Query() query: unknown): Promise<{ entries: JournalBookEntry[] }> {
    return translate(() => this.reports.journalBook(query));
  }
}
