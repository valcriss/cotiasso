import multipart from "@fastify/multipart";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { AppEnv } from "./config/env.js";

/**
 * Configuration de l'application partagée par le démarrage et les tests. L'envoi de fichiers est limité en taille,
 * en nombre de fichiers et de champs ; la taille est aussi contrôlée pendant l'écriture (DocumentStorage).
 */
export async function configureApp(app: NestFastifyApplication, env: AppEnv): Promise<void> {
  await app.register(multipart, {
    limits: {
      // Marge d'un octet : c'est DocumentStorage qui refuse, avec un message précis, au-delà de la taille maximale.
      fileSize: env.documentsMaxBytes + 1,
      files: 1,
      fields: 10,
      fieldSize: 10_000,
      parts: 12,
    },
  });
}
