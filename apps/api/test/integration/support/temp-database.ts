import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const apiRoot = fileURLToPath(new URL("../../../", import.meta.url));
const prismaCli = join(apiRoot, "../../node_modules/prisma/build/index.js");

export interface TempDatabase {
  url: string;
  drop(): Promise<void>;
}

async function withAdminClient<T>(connectionString: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Crée une base vierge, jetable, avec toutes les migrations appliquées. Sert aux tests qui exigent un état
 * initial (aucun compte) alors que la base de développement partagée en contient déjà.
 */
export async function createTempDatabase(): Promise<TempDatabase> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("DATABASE_URL est obligatoire pour les tests d'intégration.");

  const name = `cotiasso_test_${randomUUID().replace(/-/g, "")}`;
  await withAdminClient(adminUrl, (client) => client.query(`CREATE DATABASE "${name}"`));

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });

  return {
    url: url.toString(),
    drop: () => withAdminClient(adminUrl, (client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).then(() => undefined)),
  };
}
