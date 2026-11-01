import { Module } from "@nestjs/common";
import { readEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  providers: [{ provide: ENV, useFactory: () => readEnv() }, PrismaService],
  exports: [ENV, PrismaService],
})
export class PrismaModule {}
