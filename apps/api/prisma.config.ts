import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Absente pour `prisma generate` ; les commandes de migration échouent explicitement sans elle.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
