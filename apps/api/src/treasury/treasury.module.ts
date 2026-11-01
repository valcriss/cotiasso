import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { FinancialAccountsService } from "./financial-accounts.service.js";
import { TransactionsService } from "./transactions.service.js";
import { TreasuryController } from "./treasury.controller.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TreasuryController],
  providers: [FinancialAccountsService, TransactionsService],
  exports: [FinancialAccountsService, TransactionsService],
})
export class TreasuryModule {}
