import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthzModule } from "./authz/authz.module.js";
import { PermissionsGuard } from "./authz/permissions.guard.js";
import { DATABASE_PING, HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { OperationsModule } from "./operations/operations.module.js";
import { TreasuryModule } from "./treasury/treasury.module.js";
import { MembersModule } from "./members/members.module.js";
import { WorkflowsModule } from "./workflows/workflows.module.js";
import { ReimbursementsModule } from "./reimbursements/reimbursements.module.js";
import { AccountingModule } from "./accounting/accounting.module.js";
import { GrantsModule } from "./grants/grants.module.js";
import { GuidedModule } from "./guided/guided.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { SetupModule } from "./setup/setup.module.js";

@Module({
  imports: [PrismaModule, AuthzModule, AuthModule, SetupModule, SettingsModule, DocumentsModule, OperationsModule, AccountingModule, TreasuryModule, MembersModule, GrantsModule, GuidedModule, WorkflowsModule, ReimbursementsModule],
  controllers: [HealthController],
  providers: [
    // Refus par défaut : toute route exige une session, sauf si elle est marquée @Public().
    { provide: APP_GUARD, useExisting: AuthGuard },
    // Puis refus par défaut des permissions : une route sans déclaration explicite est refusée.
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    {
      provide: DATABASE_PING,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        ping: async () => {
          await prisma.$queryRaw`SELECT 1`;
        },
      }),
    },
  ],
})
export class AppModule {}
