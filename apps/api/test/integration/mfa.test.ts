import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { base32Decode } from "../../src/mfa/base32.js";
import { hotp, stepAt } from "../../src/mfa/totp.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  mfaState: string;
}

describe("Authentification à deux facteurs (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let admin: Session;
  let adminEmail: string;

  const call = (method: "GET" | "POST" | "PUT", url: string, session?: Session, body?: unknown, ip?: string) =>
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
      mfaState: response.json().mfa.state as string,
    };
  };

  /** Code TOTP valide pour un secret base32, au pas courant décalé de `offset`. */
  const codeFor = (secret: string, offset = 0) => hotp(base32Decode(secret), stepAt(Date.now()) + offset);
  /** Simule l'écoulement du temps entre deux vérifications (le pas TOTP ne peut servir qu'une fois). */
  const resetStep = (userId: string) => prisma.mfaCredential.update({ where: { userId }, data: { lastUsedStep: 0 } });

  const newUser = async (roleKeys: string[] = []) => {
    const email = `m-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "M", password: PASSWORD });
    for (const key of roleKeys) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    }
    return { email, id: user.id };
  };

  /** Inscrit un second facteur pour l'utilisateur et renvoie son secret et ses codes de secours. */
  const enroll = async (email: string) => {
    const session = await login(email);
    const start = (await call("POST", "/auth/mfa/enroll/start", session)).json();
    const confirm = await call("POST", "/auth/mfa/enroll/confirm", session, { code: codeFor(start.secret) });
    expect(confirm.statusCode).toBe(200);
    return { secret: start.secret as string, recoveryCodes: confirm.json().recoveryCodes as string[], session };
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

    // Rôles par défaut conservés tels quels : l'administrateur technique exige le second facteur.
    adminEmail = "admin@asso.test";
    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: adminEmail, displayName: "Admin", password: PASSWORD } });
    admin = await login(adminEmail);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("impose l'inscription au premier administrateur : session partielle, aucun droit tant qu'il n'est pas inscrit", async () => {
    expect(admin.mfaState).toBe("ENROLLMENT_REQUIRED");
    const me = (await call("GET", "/auth/me", admin)).json();
    expect(me.permissions).toEqual([]);
    expect(me.mfa).toEqual({ state: "ENROLLMENT_REQUIRED", enabled: false, required: true });

    const denied = await call("GET", "/roles", admin);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "MFA_REQUIRED", mfa: "ENROLLMENT_REQUIRED" });
    expect((await call("POST", "/users", admin, { email: "x@test.invalid", displayName: "X" })).statusCode).toBe(403);
    expect((await call("GET", "/authz/permissions", admin)).statusCode).toBe(403);
  });

  it("inscrit un second facteur : secret chiffré, codes de secours affichés une fois, session complète", async () => {
    const start = (await call("POST", "/auth/mfa/enroll/start", admin)).json();
    expect(start.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(start.otpauthUri).toContain("otpauth://totp/");
    expect(start.otpauthUri).toContain(`secret=${start.secret}`);

    expect((await call("POST", "/auth/mfa/enroll/confirm", admin, { code: "000000" })).statusCode).toBe(400);
    expect((await call("POST", "/auth/mfa/enroll/confirm", admin, {})).statusCode).toBe(400);

    const confirm = await call("POST", "/auth/mfa/enroll/confirm", admin, { code: codeFor(start.secret) });
    expect(confirm.statusCode).toBe(200);
    const codes = confirm.json().recoveryCodes as string[];
    expect(codes).toHaveLength(10);

    const stored = await prisma.mfaCredential.findUniqueOrThrow({ where: { userId: admin.userId } });
    expect(stored.enabledAt).not.toBeNull();
    expect(stored.secretEncrypted.startsWith("v1.")).toBe(true);
    expect(stored.secretEncrypted).not.toContain(start.secret);
    const hashes = JSON.stringify(await prisma.mfaRecoveryCode.findMany({ where: { userId: admin.userId } }));
    for (const code of codes) expect(hashes).not.toContain(code.replace("-", ""));

    const me = (await call("GET", "/auth/me", admin)).json();
    expect(me.mfa).toEqual({ state: "OK", enabled: true, required: true });
    expect(me.permissions).toContain("users:admin");
    expect((await call("GET", "/roles", admin)).statusCode).toBe(200);

    // Déjà activé : on ne peut pas recommencer l'inscription.
    expect((await call("POST", "/auth/mfa/enroll/start", admin)).statusCode).toBe(409);

    const audit = JSON.stringify(await prisma.auditEvent.findMany({ where: { actorId: admin.userId } }));
    expect(audit).toContain("auth.mfa.enabled");
    expect(audit).not.toContain(start.secret);
    for (const code of codes) expect(audit).not.toContain(code);
  });

  it("exige le code à chaque nouvelle connexion, refuse un mauvais code et un code rejoué", async () => {
    const { email } = await newUser();
    const { secret } = await enroll(email);
    await prisma.role.updateMany({ where: { key: "reader" }, data: { requiresMfa: false } });

    const session = await login(email);
    expect(session.mfaState).toBe("VERIFICATION_REQUIRED");
    expect((await call("GET", "/auth/me", session)).json().permissions).toEqual([]);
    const blocked = await call("GET", "/authz/permissions", session);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "MFA_REQUIRED", mfa: "VERIFICATION_REQUIRED" });

    // Pendant la vérification, on ne peut pas non plus recommencer une inscription.
    expect((await call("POST", "/auth/mfa/enroll/start", session)).statusCode).toBe(403);

    expect((await call("POST", "/auth/mfa/verify", session, { code: "123456" })).statusCode).toBe(400);

    await resetStep(session.userId);
    const code = codeFor(secret);
    const ok = await call("POST", "/auth/mfa/verify", session, { code });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ method: "totp", recoveryCodesLeft: 10 });
    expect((await call("GET", "/authz/permissions", session)).statusCode).toBe(200);
    expect((await call("GET", "/auth/me", session)).json().mfa.state).toBe("OK");

    // Le même code ne sert qu'une fois, même depuis une autre session.
    const other = await login(email);
    expect((await call("POST", "/auth/mfa/verify", other, { code })).statusCode).toBe(400);
    // Pas de vérification attendue sur une session déjà vérifiée.
    expect((await call("POST", "/auth/mfa/verify", session, { code })).statusCode).toBe(409);
  });

  it("accepte un code de secours une seule fois", async () => {
    const { email } = await newUser();
    const { recoveryCodes } = await enroll(email);

    const session = await login(email);
    const result = await call("POST", "/auth/mfa/verify", session, { code: recoveryCodes[0]!.toLowerCase() });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ method: "recovery", recoveryCodesLeft: 9 });

    const again = await login(email);
    expect((await call("POST", "/auth/mfa/verify", again, { code: recoveryCodes[0]! })).statusCode).toBe(400);
    expect((await call("POST", "/auth/mfa/verify", again, { code: recoveryCodes[1]! })).statusCode).toBe(200);

    const events = (await prisma.auditEvent.findMany({ where: { actorId: session.userId } })).map((e) => e.action);
    expect(events).toContain("auth.mfa.recovery-used");
  });

  it("ralentit les essais de codes comme les mots de passe", async () => {
    const { email } = await newUser();
    await enroll(email);
    const session = await login(email);
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

    for (let i = 0; i < 5; i += 1) {
      expect((await call("POST", "/auth/mfa/verify", session, { code: "000000" }, ip)).statusCode).toBe(400);
    }
    expect((await call("POST", "/auth/mfa/verify", session, { code: "000000" }, ip)).statusCode).toBe(400);
    const blocked = await call("POST", "/auth/mfa/verify", session, { code: "000000" }, ip);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("applique immédiatement un rôle devenu exigeant aux sessions en cours", async () => {
    const { email } = await newUser(["reader"]);
    const session = await login(email);
    expect(session.mfaState).toBe("OK");
    expect((await call("GET", "/authz/permissions", session)).statusCode).toBe(200);

    const reader = await prisma.role.findUniqueOrThrow({ where: { key: "reader" } });
    const update = await call("PUT", `/roles/${reader.id}`, await adminSession(), {
      name: reader.name,
      description: reader.description,
      permissions: reader.permissions,
      requiresMfa: true,
    });
    expect(update.statusCode).toBe(200);

    expect((await call("GET", "/auth/me", session)).json().mfa.state).toBe("ENROLLMENT_REQUIRED");
    expect((await call("GET", "/authz/permissions", session)).statusCode).toBe(403);

    // Rétablit le rôle pour les tests suivants.
    await prisma.role.update({ where: { key: "reader" }, data: { requiresMfa: false } });
  });

  it("refuse de désactiver le second facteur quand un rôle l'exige, sinon le permet avec le mot de passe", async () => {
    const { email } = await newUser(["reader"]);
    const { session } = await enroll(email);
    await prisma.role.update({ where: { key: "reader" }, data: { requiresMfa: true } });

    expect((await call("POST", "/auth/mfa/disable", session, { password: PASSWORD })).statusCode).toBe(409);

    await prisma.role.update({ where: { key: "reader" }, data: { requiresMfa: false } });
    expect((await call("POST", "/auth/mfa/disable", session, { password: "mauvais mot de passe" })).statusCode).toBe(400);
    expect((await call("POST", "/auth/mfa/disable", session, { password: PASSWORD })).statusCode).toBe(204);

    await expect(prisma.mfaCredential.count({ where: { userId: session.userId } })).resolves.toBe(0);
    await expect(prisma.mfaRecoveryCode.count({ where: { userId: session.userId } })).resolves.toBe(0);
    expect((await login(email)).mfaState).toBe("OK");
  });

  it("régénère les codes de secours : les anciens cessent de fonctionner", async () => {
    const { email } = await newUser();
    const { session, recoveryCodes } = await enroll(email);

    expect((await call("POST", "/auth/mfa/recovery-codes", session, { password: "mauvais mot de passe" })).statusCode).toBe(400);
    const fresh = (await call("POST", "/auth/mfa/recovery-codes", session, { password: PASSWORD })).json().recoveryCodes as string[];
    expect(fresh).toHaveLength(10);

    const next = await login(email);
    expect((await call("POST", "/auth/mfa/verify", next, { code: recoveryCodes[0]! })).statusCode).toBe(400);
    expect((await call("POST", "/auth/mfa/verify", next, { code: fresh[0]! })).statusCode).toBe(200);
  });

  it("permet à un administrateur de réinitialiser le second facteur d'un compte, avec audit", async () => {
    const { email, id } = await newUser(["reader"]);
    const { session } = await enroll(email);

    const adminFull = await adminSession();
    expect((await call("POST", `/users/${id}/mfa/reset`, adminFull)).statusCode).toBe(204);

    expect((await call("GET", "/auth/me", session)).statusCode).toBe(401);
    await expect(prisma.mfaCredential.count({ where: { userId: id } })).resolves.toBe(0);
    expect((await login(email)).mfaState).toBe("OK");
    expect((await call("POST", `/users/${randomUUID()}/mfa/reset`, adminFull)).statusCode).toBe(404);

    const reader = await newUser(["reader"]);
    const readerSession = await login(reader.email);
    expect((await call("POST", `/users/${id}/mfa/reset`, readerSession)).statusCode).toBe(403);

    const actions = (await prisma.auditEvent.findMany({ where: { objectId: id } })).map((e) => e.action);
    expect(actions).toContain("user.mfa.reset");
  });

  it("garantit en base le format des secrets et des empreintes", async () => {
    const { id } = await newUser();
    await expect(
      prisma.mfaCredential.create({ data: { userId: id, secretEncrypted: "secret-en-clair" } }),
    ).rejects.toThrow(/MfaCredential_secret_versioned/);
    await expect(
      prisma.mfaRecoveryCode.create({ data: { userId: id, codeHash: "ABCDE-FGHJK" } }),
    ).rejects.toThrow(/MfaRecoveryCode_hash_sha256/);
  });

  /** Session complète de l'administrateur (second facteur vérifié), sans rejouer un pas TOTP déjà utilisé. */
  async function adminSession(): Promise<Session> {
    const session = await login(adminEmail);
    if (session.mfaState === "OK") return session;
    // Le secret de l'administrateur n'est pas conservé par le test : on prépare un code de secours.
    const code = await prepareRecoveryCode(session.userId);
    expect((await call("POST", "/auth/mfa/verify", session, { code })).statusCode).toBe(200);
    return session;
  }

  async function prepareRecoveryCode(userId: string): Promise<string> {
    const { createHmac } = await import("node:crypto");
    const code = "TESTA-TESTB".replace(/[AEIO]/g, "X");
    const normalized = code.replace("-", "");
    const codeHash = createHmac("sha256", readEnv().mfaKey).update(`recovery:${normalized}`).digest("hex");
    await prisma.mfaRecoveryCode.upsert({
      where: { codeHash },
      create: { userId, codeHash },
      update: { usedAt: null },
    });
    return code;
  }
});
