import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { UsersService } from "../../src/auth/users.service.js";
import { hashSessionToken } from "../../src/auth/session-tokens.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";
const NEW_PASSWORD = "un nouveau mot de passe valide";

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

describe("Administration des comptes (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let admin: Session;
  let adminId: string;

  const call = (method: "GET" | "POST", url: string, session?: Session, body?: unknown, ip?: string) =>
    app.inject({
      method,
      url,
      remoteAddress: ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: {
        ...(session && { cookie: session.cookie }),
        ...(session && method !== "GET" && { "x-csrf-token": session.csrf }),
      },
      ...(body !== undefined && { payload: body as Record<string, unknown> }),
    });

  const login = async (email: string, password = PASSWORD): Promise<Session> => {
    const response = await call("POST", "/auth/login", undefined, { email, password });
    expect(response.statusCode).toBe(200);
    return {
      cookie: String(response.headers["set-cookie"]).split(";")[0]!,
      csrf: response.json().csrfToken as string,
      userId: response.json().user.id as string,
    };
  };

  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  const tokenFrom = (invitation: { path: string }) => invitation.path.split("#token=")[1]!;
  const redeem = (token: string, password: string, ip?: string) =>
    call("POST", "/auth/password-reset", undefined, { token, password }, ip);

  const createUser = async (roles: string[] = []) => {
    const email = `u-${randomUUID()}@test.invalid`;
    const response = await call("POST", "/users", admin, {
      email,
      displayName: "Nouvel utilisateur",
      roleIds: await Promise.all(roles.map(roleId)),
    });
    expect(response.statusCode).toBe(201);
    return { email, id: response.json().user.id as string, invitation: response.json().invitation };
  };

  /** Crée un compte actif avec un mot de passe défini, via le parcours d'invitation. */
  const activeUser = async (roles: string[] = []) => {
    const created = await createUser(roles);
    expect((await redeem(tokenFrom(created.invitation), PASSWORD)).statusCode).toBe(204);
    return created;
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

    const token = (await app.get(SetupService).ensureToken())!;
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD },
    });
    adminId = setup.json().user.id;
    admin = await login("admin@asso.test");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("crée un compte sans mot de passe utilisable, avec ses rôles et un lien d'invitation", async () => {
    const { email, id, invitation } = await createUser(["reader"]);
    expect(invitation.path).toMatch(/^\/reinitialisation#token=[A-Za-z0-9_-]{43}$/);
    expect(invitation.purpose).toBe("INVITATION");

    // Aucun mot de passe connu : la connexion échoue, quel que soit l'essai.
    expect((await call("POST", "/auth/login", undefined, { email, password: PASSWORD })).statusCode).toBe(401);

    // Seule l'empreinte du jeton est stockée.
    const stored = await prisma.passwordToken.findFirstOrThrow({ where: { userId: id } });
    expect(stored.tokenHash).toBe(hashSessionToken(tokenFrom(invitation)));
    expect(JSON.stringify(stored)).not.toContain(tokenFrom(invitation));

    const assignments = await prisma.roleAssignment.findMany({ where: { userId: id }, include: { role: true } });
    expect(assignments.map((a) => a.role.key)).toEqual(["reader"]);

    const audit = JSON.stringify(await prisma.auditEvent.findMany({ where: { objectId: id } }));
    expect(audit).toContain("user.created");
    expect(audit).not.toContain(tokenFrom(invitation));
  });

  it("refuse la création à un compte sans droit d'administration, et les doublons", async () => {
    const { email } = await activeUser(["president"]);
    const president = await login(email);
    expect((await call("POST", "/users", president, { email: "x@test.invalid", displayName: "X" })).statusCode).toBe(403);
    expect((await call("POST", "/users", undefined, { email: "x@test.invalid", displayName: "X" })).statusCode).toBe(401);

    expect((await call("POST", "/users", admin, { email, displayName: "Doublon" })).statusCode).toBe(409);
    expect((await call("POST", "/users", admin, { email: "pas-un-email", displayName: "X" })).statusCode).toBe(400);
    expect((await call("POST", "/users", admin, { email: "y@test.invalid", displayName: "Y", roleIds: [randomUUID()] })).statusCode).toBe(400);
    await expect(prisma.user.count({ where: { email: "y@test.invalid" } })).resolves.toBe(0);
  });

  it("définit le mot de passe avec le jeton, une seule fois", async () => {
    const { email, invitation } = await createUser();
    const token = tokenFrom(invitation);

    expect((await redeem(token, PASSWORD)).statusCode).toBe(204);
    await login(email);
    expect((await redeem(token, NEW_PASSWORD)).statusCode).toBe(400);
  });

  it("ne consomme pas le jeton quand le mot de passe est refusé", async () => {
    const { email, invitation } = await createUser();
    const token = tokenFrom(invitation);
    const weak = await redeem(token, "court");
    expect(weak.statusCode).toBe(400);
    expect(weak.json().issues.length).toBeGreaterThan(0);

    expect((await redeem(token, PASSWORD)).statusCode).toBe(204);
    await login(email);
  });

  it("refuse un jeton inconnu, expiré, ou celui d'un compte désactivé", async () => {
    expect((await redeem("jeton-inconnu", PASSWORD)).statusCode).toBe(400);

    const expired = await createUser();
    await prisma.passwordToken.updateMany({
      where: { userId: expired.id },
      data: { createdAt: new Date(Date.now() - 4 * 86_400_000), expiresAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    expect((await redeem(tokenFrom(expired.invitation), PASSWORD)).statusCode).toBe(400);

    const disabled = await createUser();
    await prisma.user.update({ where: { id: disabled.id }, data: { status: "DISABLED" } });
    expect((await redeem(tokenFrom(disabled.invitation), PASSWORD)).statusCode).toBe(400);
  });

  it("remplace l'ancien lien par le nouveau et révoque les sessions à la réinitialisation", async () => {
    const { email, id } = await activeUser();
    const session = await login(email);
    expect((await call("GET", "/auth/me", session)).statusCode).toBe(200);

    const first = (await call("POST", `/users/${id}/password-reset`, admin)).json();
    const second = (await call("POST", `/users/${id}/password-reset`, admin)).json();
    expect(second.purpose).toBe("RESET");
    expect((await redeem(tokenFrom(first), NEW_PASSWORD)).statusCode).toBe(400);

    expect((await redeem(tokenFrom(second), NEW_PASSWORD)).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", session)).statusCode).toBe(401);
    expect((await call("POST", "/auth/login", undefined, { email, password: PASSWORD })).statusCode).toBe(401);
    await login(email, NEW_PASSWORD);

    const audit = (await prisma.auditEvent.findMany({ where: { objectId: id } })).map((e) => e.action);
    expect(audit).toEqual(expect.arrayContaining(["user.password-reset.issued", "auth.password.reset"]));
  });

  it("ralentit les essais de jetons par adresse IP, comme la connexion", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    for (let i = 0; i < 20; i += 1) expect((await redeem(`faux-${i}`, PASSWORD, ip)).statusCode).toBe(400);
    expect((await redeem("faux-21", PASSWORD, ip)).statusCode).toBe(400);
    const blocked = await redeem("faux-22", PASSWORD, ip);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("désactive un compte et révoque ses sessions, puis le réactive", async () => {
    const { email, id } = await activeUser();
    const session = await login(email);

    expect((await call("POST", `/users/${id}/disable`, admin)).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", session)).statusCode).toBe(401);
    expect((await call("POST", "/auth/login", undefined, { email, password: PASSWORD })).statusCode).toBe(401);

    expect((await call("POST", `/users/${id}/enable`, admin)).statusCode).toBe(204);
    await login(email);
    expect((await call("POST", `/users/${randomUUID()}/disable`, admin)).statusCode).toBe(404);
  });

  it("interdit de désactiver son propre compte", async () => {
    expect((await call("POST", `/users/${adminId}/disable`, admin)).statusCode).toBe(409);
    expect((await call("GET", "/auth/me", admin)).statusCode).toBe(200);
  });

  it("garde toujours un administrateur actif quand deux administrateurs se désactivent en même temps", async () => {
    const other = await activeUser(["technical-admin"]);
    const otherSession = await login(other.email);

    const results = await Promise.all([
      call("POST", `/users/${other.id}/disable`, admin),
      call("POST", `/users/${adminId}/disable`, otherSession),
    ]);
    expect(results.filter((r) => r.statusCode === 204)).toHaveLength(1);

    const active = await prisma.user.count({
      where: { status: "ACTIVE", roleAssignments: { some: { revokedAt: null, role: { permissions: { has: "users:admin" } } } } },
    });
    expect(active).toBeGreaterThanOrEqual(1);

    // Rétablit l'état pour les tests suivants.
    await prisma.user.updateMany({ where: { id: { in: [adminId, other.id] } }, data: { status: "ACTIVE" } });
    admin = await login("admin@asso.test");
  });

  it("déconnecte un utilisateur de toutes ses sessions", async () => {
    const { email, id } = await activeUser();
    const a = await login(email);
    const b = await login(email);
    const response = await call("POST", `/users/${id}/sessions/revoke`, admin);
    expect(response.json()).toEqual({ revoked: 2 });
    expect((await call("GET", "/auth/me", a)).statusCode).toBe(401);
    expect((await call("GET", "/auth/me", b)).statusCode).toBe(401);
  });

  it("change son propre mot de passe après vérification de l'actuel, en gardant la session courante", async () => {
    const { email } = await activeUser();
    const current = await login(email);
    const other = await login(email);

    const wrong = await call("POST", "/auth/password", current, { currentPassword: "mauvais mot de passe", newPassword: NEW_PASSWORD });
    expect(wrong.statusCode).toBe(400);
    const weak = await call("POST", "/auth/password", current, { currentPassword: PASSWORD, newPassword: "court" });
    expect(weak.statusCode).toBe(400);

    expect((await call("POST", "/auth/password", current, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", current)).statusCode).toBe(200);
    expect((await call("GET", "/auth/me", other)).statusCode).toBe(401);
    expect((await call("POST", "/auth/login", undefined, { email, password: PASSWORD })).statusCode).toBe(401);
    await login(email, NEW_PASSWORD);
    expect((await call("POST", "/auth/password", undefined, { currentPassword: "x", newPassword: "y" })).statusCode).toBe(401);
  });

  it("garantit en base que seule l'empreinte d'un jeton peut être stockée", async () => {
    const { id } = await createUser();
    await expect(
      prisma.passwordToken.create({
        data: { userId: id, tokenHash: "jeton-en-clair", purpose: "RESET", expiresAt: new Date(Date.now() + 60_000) },
      }),
    ).rejects.toThrow(/PasswordToken_hash_sha256/);
    expect(await users.findByEmail("admin@asso.test")).not.toBeNull();
  });
});
