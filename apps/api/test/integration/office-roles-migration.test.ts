import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeRoleKey } from "../../src/members/office-role-key.js";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
const TARGET = "20261104000000_add_office_roles";

/**
 * Reprise des mandats existants dans le catalogue de fonctions (ADR 0035) : on rejoue les migrations jusqu'à la
 * veille de celle du catalogue, on saisit des intitulés « d'avant », puis on applique la migration.
 */
describe("migration add_office_roles", () => {
  const adminUrl = process.env.DATABASE_URL!;
  const name = `cotiasso_test_${randomUUID().replace(/-/g, "")}`;
  let client: pg.Client;

  const run = (file: string) => client.query(readFileSync(join(migrationsDir, file, "migration.sql"), "utf8"));

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const folder of folders.filter((f) => f < TARGET)) await run(folder);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  });

  it("regroupe les intitulés qui ne diffèrent que par la casse ou les accents et garde tous les mandats", async () => {
    const member = (await client.query(`INSERT INTO "Member" ("id", "firstName", "lastName") VALUES (gen_random_uuid(), 'Claire', 'Morel') RETURNING "id"`)).rows[0].id;
    const titles = ["Présidente", "Présidente", "presidente", "  Trésorier  ", "Secrétaire adjoint", "Secrétaire adjoint", "SECRETAIRE   ADJOINT", "Œuvres"];
    for (const title of titles) {
      await client.query(`INSERT INTO "MemberOffice" ("id", "memberId", "title", "startsOn") VALUES (gen_random_uuid(), $1, $2, '2020-01-01')`, [member, title]);
    }

    await run(TARGET);

    const roles = (await client.query(`SELECT "name", "nameKey", "active" FROM "OfficeRole" ORDER BY "nameKey"`)).rows;
    expect(roles.map((r) => r.name)).toEqual(["Présidente", "Œuvres", "Secrétaire adjoint", "Trésorier"].sort((a, b) => officeRoleKey(a).localeCompare(officeRoleKey(b))));
    expect(roles.every((r) => r.active)).toBe(true);
    // La clé calculée en SQL est celle que l'application calcule : sinon un doublon passerait plus tard.
    for (const role of roles) expect(role.nameKey).toBe(officeRoleKey(role.name));

    const mandates = (await client.query(`SELECT o."officeRoleId", r."name" FROM "MemberOffice" o JOIN "OfficeRole" r ON r."id" = o."officeRoleId"`)).rows;
    expect(mandates).toHaveLength(titles.length);
    expect(mandates.filter((m) => m.name === "Présidente")).toHaveLength(3);
    expect(mandates.filter((m) => m.name === "Secrétaire adjoint")).toHaveLength(3);
  });

  it("refuse la suppression d'une fonction", async () => {
    await expect(client.query(`DELETE FROM "OfficeRole"`)).rejects.toThrow(/ne se supprime pas/);
    await expect(client.query(`TRUNCATE "OfficeRole" CASCADE`)).rejects.toThrow();
  });
});
