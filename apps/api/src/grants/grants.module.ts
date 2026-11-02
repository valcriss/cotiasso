import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { GrantExpensesController } from "./grant-expenses.controller.js";
import { GrantExpensesService } from "./grant-expenses.service.js";
import { GrantFinanceService } from "./grant-finance.service.js";
import { FundersService } from "./funders.service.js";
import { GrantsController } from "./grants.controller.js";
import { GrantsService } from "./grants.service.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [GrantsController, GrantExpensesController],
  providers: [FundersService, GrantsService, GrantFinanceService, GrantExpensesService],
})
export class GrantsModule {}
