import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { MfaService } from "../auth/mfa.service.js";
import { normalizeEmail } from "../auth/email.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Récupération d'urgence (ADR 0028) : réinitialise le second facteur d'un compte depuis le serveur, sans écrire de SQL.
 * Pour le cas où le seul administrateur a perdu son appareil et ses codes de secours. Passe par le service applicatif :
 * le second facteur est supprimé, les sessions sont révoquées et l'événement entre dans le journal d'audit chaîné
 * (`user.mfa.reset`, sans acteur, `via: "serveur"`). La personne se réinscrira à sa prochaine connexion.
 *
 * Usage : node dist/cli/reset-mfa.js adresse@email
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage : node dist/cli/reset-mfa.js <adresse email du compte>");
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const user = await app.get(PrismaService).user.findFirst({ where: { email: normalizeEmail(email) ?? "" }, select: { id: true, displayName: true } });
    if (!user) {
      console.error(`Aucun compte ne correspond à ${email}. Vérifiez l'adresse.`);
      process.exitCode = 1;
      return;
    }
    await app.get(MfaService).adminReset(user.id, undefined, { via: "serveur" });
    console.log(`Second facteur réinitialisé pour ${user.displayName}. Ses sessions sont fermées ; il se réinscrira à la prochaine connexion.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
