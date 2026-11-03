import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthzModule } from "../authz/authz.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { FinancialAccountsService } from "./financial-accounts.service.js";
import { ImportsService } from "./imports.service.js";
import { RecoveryController } from "./recovery.controller.js";
import { RecoveryProgressController } from "./recovery-progress.controller.js";
import { RecoveryProgressService } from "./recovery-progress.service.js";
import { RecoveryService } from "./recovery.service.js";
import { ReconciliationsService } from "./reconciliations.service.js";
import { TransactionLinksService } from "./transaction-links.service.js";
import { TransactionsService } from "./transactions.service.js";
import { TransfersService } from "./transfers.service.js";
import { TreasuryController } from "./treasury.controller.js";

@Module({
  imports: [PrismaModule, AuditModule, AuthzModule, AccountingModule, DocumentsModule],
  controllers: [TreasuryController, RecoveryController, RecoveryProgressController],
  providers: [FinancialAccountsService, TransactionsService, ImportsService, TransactionLinksService, TransfersService, ReconciliationsService, RecoveryService, RecoveryProgressService],
  exports: [FinancialAccountsService, TransactionsService],
})
export class TreasuryModule {}
