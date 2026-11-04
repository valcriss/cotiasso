import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { BackupsService } from "./backups.service.js";
import { OperationsController } from "./operations.controller.js";
import { UPDATE_FETCH, UpdateCheckService, type UpdateFetch } from "./update-check.service.js";

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [OperationsController],
  providers: [BackupsService, UpdateCheckService, { provide: UPDATE_FETCH, useValue: ((url, init) => fetch(url, init)) satisfies UpdateFetch }],
  exports: [BackupsService],
})
export class OperationsModule {}
