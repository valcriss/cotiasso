import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthModule } from "./auth/auth.module.js";
import { DATABASE_PING, HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
  providers: [
    // Refus par défaut : toute route exige une session, sauf si elle est marquée @Public().
    { provide: APP_GUARD, useExisting: AuthGuard },
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
