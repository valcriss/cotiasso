import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { FundersService } from "./funders.service.js";
import { GrantsController } from "./grants.controller.js";
import { GrantsService } from "./grants.service.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [GrantsController],
  providers: [FundersService, GrantsService],
})
export class GrantsModule {}
