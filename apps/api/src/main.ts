import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { readEnv } from "./config/env.js";
import { ReimbursementNotifier } from "./reimbursements/reimbursement-notifier.js";

async function bootstrap(): Promise<void> {
  const env = readEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: env.trustProxy }));
  await configureApp(app, env);
  app.enableShutdownHooks();
  await app.listen(env.port, env.host);
  // Envoi périodique des notifications (sans effet tant que SMTP n'est pas configuré).
  app.get(ReimbursementNotifier).start();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
