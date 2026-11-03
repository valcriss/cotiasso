import { Module } from "@nestjs/common";
import { createTransport } from "nodemailer";
import { AuditModule } from "../audit/audit.module.js";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { AccountMailService } from "./account-mail.service.js";
import { MAIL_TRANSPORT, MailService, type MailTransport } from "./mail.service.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Transport SMTP, ou null sans configuration. Le chiffrement est exigé (TLS direct ou STARTTLS), sauf vers la machine locale (développement). */
export function createSmtpTransport(env: AppEnv): MailTransport | null {
  const smtp = env.smtp;
  if (!smtp) return null;
  return createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure && !LOCAL_HOSTS.has(smtp.host),
    ...(smtp.user !== null && smtp.password !== null && { auth: { user: smtp.user, pass: smtp.password } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

@Module({
  imports: [PrismaModule, AuditModule, SettingsModule],
  providers: [{ provide: MAIL_TRANSPORT, useFactory: createSmtpTransport, inject: [ENV] }, MailService, AccountMailService],
  exports: [MailService, AccountMailService],
})
export class MailModule {}
