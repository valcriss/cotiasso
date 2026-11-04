import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { BackupsService } from "./backups.service.js";
import { OperationsController } from "./operations.controller.js";

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [OperationsController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class OperationsModule {}
