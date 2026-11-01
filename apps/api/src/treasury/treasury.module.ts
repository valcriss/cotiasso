import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { FinancialAccountsService } from "./financial-accounts.service.js";
import { ImportsService } from "./imports.service.js";
import { TransactionLinksService } from "./transaction-links.service.js";
import { TransactionsService } from "./transactions.service.js";
import { TransfersService } from "./transfers.service.js";
import { TreasuryController } from "./treasury.controller.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TreasuryController],
  providers: [FinancialAccountsService, TransactionsService, ImportsService, TransactionLinksService, TransfersService],
  exports: [FinancialAccountsService, TransactionsService],
})
export class TreasuryModule {}
