import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";
const ADMIN = { email: "admin@asso.test", displayName: "Admin", password: PASSWORD };

async function startApp(databaseUrl: string): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue({ ...readEnv(), databaseUrl, cookieSecure: true })
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

const post = (app: NestFastifyApplication, token: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: "/setup", payload: { token, ...ADMIN, ...extra } });

describe("Assistant initial (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let setup: SetupService;
  let prisma: PrismaService;

  beforeAll(async () => {
    db = await createTempDatabase();
    app = await startApp(db.url);
    setup = app.get(SetupService);
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("génère un jeton au démarrage et signale l'installation requise", async () => {
    await expect(prisma.setupToken.count({ where: { usedAt: null } })).resolves.toBe(1);
    const status = await app.inject({ method: "GET", url: "/setup/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ setupRequired: true });
    expect((await app.inject({ method: "GET", url: "/auth/me" })).statusCode).toBe(401);
  });

  it("ne stocke que l'empreinte du jeton et remplace l'ancien à chaque génération", async () => {
    const first = (await setup.ensureToken())!;
    const second = (await setup.ensureToken())!;
    const stored = JSON.stringify(await prisma.setupToken.findMany());
    expect(stored).not.toContain(first);
    expect(stored).not.toContain(second);
    await expect(prisma.setupToken.count({ where: { usedAt: null } })).resolves.toBe(1);

    expect((await post(app, first)).statusCode).toBe(403);
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it("refuse un jeton faux ou un corps incomplet", async () => {
    expect((await post(app, "jeton-faux")).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/setup", payload: { token: "x" } })).statusCode).toBe(400);
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it("ne consomme pas le jeton quand le mot de passe est refusé", async () => {
    const token = (await setup.ensureToken())!;
    const weak = await post(app, token, { password: "court" });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().issues.length).toBeGreaterThan(0);
    const invalidEmail = await post(app, token, { email: "pas-un-email" });
    expect(invalidEmail.statusCode).toBe(400);
    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.setupToken.count({ where: { usedAt: null } })).resolves.toBe(1);
  });

  it("crée le premier compte, ouvre la session et consomme le jeton", async () => {
    const token = (await setup.ensureToken())!;
    const response = await post(app, token);
    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({ email: ADMIN.email, displayName: "Admin", status: "ACTIVE" });
    expect(JSON.stringify(response.json())).not.toContain("passwordHash");

    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("__Host-cotiasso_session=");
    expect(setCookie).toContain("HttpOnly");

    const cookie = setCookie.split(";")[0]!;
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(200);

    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(prisma.setupToken.count({ where: { usedAt: null } })).resolves.toBe(0);
    const audit = await prisma.auditEvent.findMany({ where: { action: "setup.completed" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it("refuse toute nouvelle installation une fois le premier compte créé", async () => {
    expect((await app.inject({ method: "GET", url: "/setup/status" })).json()).toEqual({ setupRequired: false });
    await expect(setup.ensureToken()).resolves.toBeNull();
    expect((await post(app, "n-importe-quel-jeton", { email: "autre@asso.test" })).statusCode).toBe(403);
    await expect(prisma.user.count()).resolves.toBe(1);
  });
});

describe("Assistant initial : requêtes concurrentes", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    db = await createTempDatabase();
    app = await startApp(db.url);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("ne crée qu'un seul compte quand plusieurs requêtes utilisent le même jeton", async () => {
    const token = (await app.get(SetupService).ensureToken())!;
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) => post(app, token, { email: `admin${i}@asso.test` })),
    );
    const statuses = responses.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 201).every((s) => s === 403 || s === 409)).toBe(true);
    await expect(app.get(PrismaService).user.count()).resolves.toBe(1);
  });
});

describe("Assistant initial : la personne qui installe est aussi trésorière (ADR 0028)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    db = await createTempDatabase();
    app = await startApp(db.url);
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("refuse un choix de rôle qui n'est pas un booléen, puis attribue les deux rôles dans la même transaction", async () => {
    const token = (await app.get(SetupService).ensureToken())!;
    expect((await post(app, token, { alsoTreasurer: "oui" })).statusCode).toBe(400);
    await expect(prisma.user.count()).resolves.toBe(0);

    expect((await post(app, token, { alsoTreasurer: true })).statusCode).toBe(201);
    const roles = await prisma.roleAssignment.findMany({ include: { role: true } });
    expect(roles.map((a) => a.role.key).sort()).toEqual(["technical-admin", "treasurer"]);
  });
});
