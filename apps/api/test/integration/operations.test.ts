import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv, type AppEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";
// Fichiers réellement produits par docker/backup.sh : le test vérifie le contrat entre le script et l'API.
const FIXTURES = fileURLToPath(new URL("../fixtures/backups/", import.meta.url));

interface Session {
  cookie: string;
}

describe("Exploitation : état des sauvegardes (base vierge)", () => {
  let db: TempDatabase;
  let dir: string;
  let changelog: string;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;

  const get = (url: string, session?: Session) =>
    app.inject({ method: "GET", url, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`, headers: { ...(session && { cookie: session.cookie }) } });

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `o-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "O", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
    return { cookie: String(login.headers["set-cookie"]).split(";")[0]! };
  };

  const boot = async (env: Partial<AppEnv>) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue({ ...readEnv(), databaseUrl: db.url, cookieSecure: true, ...env })
      .compile();
    const created = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await created.init();
    await created.getHttpAdapter().getInstance().ready();
    return created;
  };

  beforeAll(async () => {
    db = await createTempDatabase();
    dir = await mkdtemp(join(tmpdir(), "cotiasso-backups-"));
    changelog = join(dir, "..", `cotiasso-changelog-${randomUUID()}.md`);
    await writeFile(
      changelog,
      "# Notes\n\n## 1.2.3 — 2026-11-10\n\n### À savoir\n\n- Sauvegardez avant de mettre à jour.\n\n## 1.1.0 — 2026-10-01\n\n- Ancienne nouveauté.\n",
    );
    app = await boot({ backupsDir: dir, appVersion: "1.2.3", changelogFile: changelog });
    prisma = app.get(PrismaService);
    users = app.get(UsersService);

    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
    await rm(dir, { recursive: true, force: true });
    await rm(changelog, { force: true });
  });

  it("sert les notes de version aux seuls administrateurs de l'exploitation", async () => {
    expect((await get("/operations/release-notes")).statusCode).toBe(401);
    expect((await get("/operations/release-notes", await userWith("treasurer"))).statusCode).toBe(403);
    const notes = (await get("/operations/release-notes", await userWith("technical-admin"))).json();
    expect(notes).toMatchObject({ version: "1.2.3", available: true });
    expect(notes.releases.map((r: { heading: string; current: boolean }) => [r.heading, r.current])).toEqual([
      ["1.2.3 — 2026-11-10", true],
      ["1.1.0 — 2026-10-01", false],
    ]);
    expect(notes.releases[0].groups[0]).toEqual({ title: "À savoir", items: ["Sauvegardez avant de mettre à jour."] });
  });

  it("réserve l'état de l'exploitation à backups:admin", async () => {
    expect((await get("/operations")).statusCode).toBe(401);
    expect((await get("/operations", await userWith("treasurer"))).statusCode).toBe(403);
    expect((await get("/operations", await userWith("technical-admin"))).statusCode).toBe(200);
  });

  it("annonce « aucune sauvegarde » quand le dossier est vide", async () => {
    const report = (await get("/operations", await userWith("technical-admin"))).json();
    expect(report.version).toBe("1.2.3");
    expect(report.backups).toMatchObject({ configured: true, entries: [], status: null });
    expect(report.backups.report.health).toBe("NONE");
    expect(report.offsite).toMatchObject({ status: null, report: { health: "NONE" } });
  });

  it("lit les fichiers réellement produits par le script de sauvegarde", async () => {
    await cp(FIXTURES, dir, { recursive: true });
    await writeFile(join(dir, "cotiasso-20261101T165255Z.tar.enc"), "archive chiffrée factice");

    const report = (await get("/operations", await userWith("technical-admin"))).json();
    expect(report.backups.status).toMatchObject({ lastError: null, intervalHours: 24, retentionDays: 30 });
    expect(report.backups.entries).toHaveLength(1);
    expect(report.backups.entries[0]).toMatchObject({
      name: "cotiasso-20261101T165255Z",
      appVersion: "test",
      bytes: 61472,
      archivePresent: true,
      counts: { users: 1, documents: 1, documentVersions: 1, auditEvents: 4 },
    });
    // Les fichiers de test datent de 2026-11-01 : l'état est évalué à la date du jour d'exécution.
    expect(["OK", "STALE"]).toContain(report.backups.report.health);
  });

  it("lit l'état de la copie hors site réellement écrit par le script", async () => {
    const report = (await get("/operations", await userWith("technical-admin"))).json();
    expect(report.offsite.status).toEqual({
      lastAttemptAt: "2026-11-01T17:00:00Z",
      lastSuccessAt: "2026-11-01T17:00:00Z",
      lastError: null,
      target: "s3:bucket/cotiasso",
    });
    // Aucun identifiant n'est exposé : seule la cible lisible.
    expect(JSON.stringify(report.offsite)).not.toMatch(/secret|password|pass"/i);
    expect(["OK", "STALE"]).toContain(report.offsite.report.health);

    await writeFile(
      join(dir, "offsite.json"),
      JSON.stringify({ lastAttemptAt: new Date().toISOString(), lastSuccessAt: "2026-11-01T17:00:00Z", lastError: "réseau coupé", target: "s3:bucket/cotiasso" }),
    );
    const failing = (await get("/operations", await userWith("technical-admin"))).json();
    expect(failing.offsite.report.health).toBe("FAILING");
    expect(failing.offsite.report.message).toContain("réseau coupé");
    await cp(join(FIXTURES, "offsite.json"), join(dir, "offsite.json"));
  });

  it("signale une archive disparue alors que son manifeste existe", async () => {
    await rm(join(dir, "cotiasso-20261101T165255Z.tar.enc"));
    const report = (await get("/operations", await userWith("technical-admin"))).json();
    expect(report.backups.entries[0].archivePresent).toBe(false);
  });

  it("ignore sans planter les fichiers illisibles ou inattendus", async () => {
    await writeFile(join(dir, "status.json"), "{ pas du json");
    await writeFile(join(dir, "cotiasso-20261101T170000Z.manifest.json"), JSON.stringify({ name: "../../etc/passwd" }));
    await writeFile(join(dir, "notes.txt"), "autre fichier");
    const report = (await get("/operations", await userWith("technical-admin"))).json();
    expect(report.backups.status).toBeNull();
    expect(report.backups.entries.map((e: { name: string }) => e.name)).toEqual(["cotiasso-20261101T165255Z"]);
  });

  it("indique que les sauvegardes ne sont pas configurées quand aucun dossier n'est fourni", async () => {
    const unconfigured = await boot({ backupsDir: null });
    try {
      const session = await (async () => {
        const email = `o-${randomUUID()}@test.invalid`;
        const user = await unconfigured.get(UsersService).createUser({ email, displayName: "O", password: PASSWORD });
        const role = await unconfigured.get(PrismaService).role.findUniqueOrThrow({ where: { key: "technical-admin" } });
        await unconfigured.get(PrismaService).roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
        const login = await unconfigured.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: "198.51.100.7" });
        return String(login.headers["set-cookie"]).split(";")[0]!;
      })();
      const report = (await unconfigured.inject({ method: "GET", url: "/operations", headers: { cookie: session } })).json();
      expect(report.backups).toMatchObject({ configured: false, report: null, entries: [] });
    } finally {
      await unconfigured.close();
    }
  });
});
