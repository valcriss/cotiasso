import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { readEnv } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const env = readEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableShutdownHooks();
  await app.listen(env.port, env.host);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
