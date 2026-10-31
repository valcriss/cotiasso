import { Module } from "@nestjs/common";
import { readEnv } from "./config/env.js";
import { ENV } from "./config/tokens.js";
import { DATABASE_PING, HealthController } from "./health/health.controller.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Module({
  controllers: [HealthController],
  providers: [
    { provide: ENV, useFactory: () => readEnv() },
    PrismaService,
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
