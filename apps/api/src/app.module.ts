import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { DATABASE_PING, HealthController } from "./health/health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
  providers: [
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
