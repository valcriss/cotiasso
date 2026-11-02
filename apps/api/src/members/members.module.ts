import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
