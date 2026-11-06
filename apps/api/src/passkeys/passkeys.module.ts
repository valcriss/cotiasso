import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { PasskeySettingsService } from "./passkey-settings.service.js";
import { PasskeysController } from "./passkeys.controller.js";
import { PasskeysService } from "./passkeys.service.js";

/** Clés d'accès WebAuthn (ADR 0036) : réglages de l'association, enregistrement, second facteur et connexion complète. */
@Module({
  imports: [PrismaModule, AuditModule, AuthModule, SettingsModule],
  controllers: [PasskeysController],
  providers: [PasskeysService, PasskeySettingsService],
})
export class PasskeysModule {}
