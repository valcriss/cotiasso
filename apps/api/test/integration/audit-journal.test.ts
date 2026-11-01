import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { AuditService } from "../../src/audit/audit.service.js";
import { Prisma } from "../../src/generated/prisma/client.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

describe("Journal d'audit (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let audit: AuditService;
  let admin: Session;

  const call = (url: string, session?: Session) =>
    app.inject({
      method: "GET",
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie }) },
    });

  const login = async (email: string): Promise<Session> => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return {
      cookie: String(response.headers["set-cookie"]).split(";")[0]!,
      csrf: response.json().csrfToken as string,
      userId: response.json().user.id as string,
    };
  };

  const verify = async () => (await call("/audit/verify", admin)).json() as {
    ok: boolean;
    checked: number;
    unchained: number;
    firstBrokenSeq: number | null;
    reason: string | null;
  };

  /** Simule un attaquant ayant un accès direct à la base : il désactive les déclencheurs, puis les rétablit. */
  const asDatabaseOwner = async <T>(action: () => Promise<T>): Promise<T> => {
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" DISABLE TRIGGER USER');
    try {
      return await action();
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" ENABLE TRIGGER USER');
    }
  };

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `a-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "A", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    return login(email);
  };

  beforeAll(async () => {
    db = await createTempDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue({ ...readEnv(), databaseUrl: db.url, cookieSecure: true })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    users = app.get(UsersService);
    audit = app.get(AuditService);

    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin Test", password: PASSWORD },
    });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    admin = await login("admin@asso.test");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("chaîne chaque événement à l'empreinte du précédent", async () => {
    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.previousHash).toBeNull();
    rows.forEach((row, index) => {
      expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
      if (index > 0) expect(row.previousHash).toBe(rows[index - 1]!.hash);
    });
    const report = await verify();
    expect(report).toMatchObject({ ok: true, unchained: 0, firstBrokenSeq: null });
    expect(report.checked).toBe(rows.length);
  });

  it("garde une chaîne linéaire sous écritures concurrentes", async () => {
    const before = await prisma.auditEvent.count();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => audit.record({ action: "test.concurrent", objectType: "Test", objectId: String(i) })),
    );
    expect(await prisma.auditEvent.count()).toBe(before + 25);

    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });
    expect(new Set(rows.map((r) => r.previousHash)).size).toBe(rows.length);
    expect((await verify()).ok).toBe(true);
  });

  it("calcule l'empreinte sur des détails identiques malgré l'ordre des clés de jsonb", async () => {
    await audit.record({ action: "test.details", objectType: "Test", details: { zeta: 1, alpha: { y: 2, b: 1 }, liste: [3, { q: 1, a: 2 }] } });
    expect((await verify()).ok).toBe(true);
  });

  it("détecte un événement modifié directement en base, puis constate le retour à la normale", async () => {
    const target = await prisma.auditEvent.findFirstOrThrow({ where: { action: "setup.completed" } });
    await asDatabaseOwner(() =>
      prisma.$executeRaw`UPDATE "AuditEvent" SET "action" = 'auth.login.failure' WHERE "seq" = ${target.seq}`,
    );
    const broken = await verify();
    expect(broken.ok).toBe(false);
    expect(broken.firstBrokenSeq).toBe(Number(target.seq));
    expect(broken.reason).toContain("modifié");

    await asDatabaseOwner(() => prisma.$executeRaw`UPDATE "AuditEvent" SET "action" = 'setup.completed' WHERE "seq" = ${target.seq}`);
    expect((await verify()).ok).toBe(true);
  });

  it("détecte un événement retiré de la chaîne", async () => {
    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });
    const removed = rows[3]!;
    await asDatabaseOwner(() => prisma.$executeRaw`DELETE FROM "AuditEvent" WHERE "seq" = ${removed.seq}`);
    const broken = await verify();
    expect(broken.ok).toBe(false);
    expect(broken.firstBrokenSeq).toBe(Number(rows[4]!.seq));
    expect(broken.reason).toContain("chaînage");

    await asDatabaseOwner(() =>
      prisma.auditEvent.create({ data: { ...removed, details: removed.details === null ? Prisma.DbNull : removed.details } }),
    );
    expect((await verify()).ok).toBe(true);
  });

  it("détecte un événement forgé et inséré en base", async () => {
    const forged = await asDatabaseOwner(() =>
      prisma.auditEvent.create({
        data: { action: "forge", objectType: "Test", previousHash: "f".repeat(64), hash: "e".repeat(64) },
      }),
    );
    const broken = await verify();
    expect(broken.ok).toBe(false);
    expect(broken.firstBrokenSeq).toBe(Number(forged.seq));

    await asDatabaseOwner(() => prisma.$executeRaw`DELETE FROM "AuditEvent" WHERE "seq" = ${forged.seq}`);
    expect((await verify()).ok).toBe(true);
  });

  it("conserve sans les vérifier les événements antérieurs à la chaîne", async () => {
    await prisma.auditEvent.create({ data: { action: "legacy", objectType: "Test" } });
    const report = await verify();
    expect(report.ok).toBe(true);
    expect(report.unchained).toBe(1);
    await audit.record({ action: "test.after-legacy", objectType: "Test" });
    expect((await verify()).ok).toBe(true);
  });

  it("réserve la consultation à audit:view", async () => {
    expect((await call("/audit")).statusCode).toBe(401);
    expect((await call("/audit", await userWith("reader"))).statusCode).toBe(403);
    expect((await call("/audit/verify", await userWith("reader"))).statusCode).toBe(403);
    expect((await call("/audit", await userWith("president"))).statusCode).toBe(200);
  });

  it("filtre par action, objet, acteur et période, et renvoie le nom de l'acteur", async () => {
    const byAction = (await call("/audit?action=setup.completed", admin)).json();
    expect(byAction.items).toHaveLength(1);
    expect(byAction.items[0].actor).toMatchObject({ displayName: "Admin Test", email: "admin@asso.test" });

    const byType = (await call("/audit?objectType=Test&limit=200", admin)).json();
    expect(byType.items.every((e: { objectType: string }) => e.objectType === "Test")).toBe(true);

    const byActor = (await call(`/audit?actorId=${admin.userId}&limit=200`, admin)).json();
    expect(byActor.items.length).toBeGreaterThanOrEqual(2);
    expect(byActor.items.every((e: { actor: { id: string } }) => e.actor.id === admin.userId)).toBe(true);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await call(`/audit?from=${encodeURIComponent(future)}`, admin)).json().items).toEqual([]);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await call(`/audit?from=${encodeURIComponent(past)}&limit=1`, admin)).json().items).toHaveLength(1);
  });

  it("pagine du plus récent au plus ancien sans doublon ni trou", async () => {
    const all = (await call("/audit?limit=200", admin)).json().items as { seq: number }[];
    const seen: number[] = [];
    let cursor: number | null = null;
    do {
      const page = (await call(`/audit?limit=7${cursor ? `&before=${cursor}` : ""}`, admin)).json() as { items: { seq: number }[]; nextCursor: number | null };
      expect(page.items.length).toBeLessThanOrEqual(7);
      seen.push(...page.items.map((i) => i.seq));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual(all.map((i) => i.seq));
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
  });

  it("refuse des paramètres invalides et propose des facettes de filtre", async () => {
    for (const query of ["actorId=pas-un-uuid", "from=pas-une-date", "limit=0", "limit=9999", "before=abc", `action=${"x".repeat(300)}`]) {
      expect((await call(`/audit?${query}`, admin)).statusCode).toBe(400);
    }
    const facets = (await call("/audit/facets", admin)).json();
    expect(facets.actions).toEqual(expect.arrayContaining(["setup.completed", "auth.login.success"]));
    expect(facets.objectTypes).toEqual(expect.arrayContaining(["User", "Test"]));
  });
});
