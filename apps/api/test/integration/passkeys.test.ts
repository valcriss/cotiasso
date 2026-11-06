import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { userHandleOf } from "../../src/passkeys/passkeys.service.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import "./support/bigint-json.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";
import { VirtualAuthenticator } from "./support/virtual-authenticator.js";

const PASSWORD = "une phrase de passe correcte";
const ORIGIN = "https://compta.asso.test";
const RP_ID = "compta.asso.test";

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  mfaState: string;
}

/** Démarre l'application sur une base jetable, avec l'adresse publique donnée. */
async function boot(publicUrl: string | null) {
  const db = await createTempDatabase();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue({ ...readEnv(), databaseUrl: db.url, cookieSecure: true, publicUrl })
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, db };
}

function helpers(app: NestFastifyApplication) {
  const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, session?: Session, body?: unknown, ip?: string) =>
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

  const toSession = (response: Awaited<ReturnType<typeof call>>): Session => ({
    cookie: String(response.headers["set-cookie"]).split(";")[0]!,
    csrf: response.json().csrfToken as string,
    userId: response.json().user.id as string,
    mfaState: response.json().mfa.state as string,
  });

  const login = async (email: string): Promise<Session> => {
    const response = await call("POST", "/auth/login", undefined, { email, password: PASSWORD });
    expect(response.statusCode).toBe(200);
    return toSession(response);
  };

  return { call, login, toSession };
}

describe("Clés d'accès (domaine https valide)", () => {
  let app: NestFastifyApplication;
  let db: TempDatabase;
  let prisma: PrismaService;
  let users: UsersService;
  let admin: Session;
  let call: ReturnType<typeof helpers>["call"];
  let login: ReturnType<typeof helpers>["login"];
  let toSession: ReturnType<typeof helpers>["toSession"];

  const setMode = async (passkeyMode: string, passkeyUsernameless = false) => {
    const response = await call("PUT", "/security/passkeys", admin, { passkeyMode, passkeyUsernameless });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  const newUser = async (roleKeys: string[] = []) => {
    const email = `p-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "Camille", password: PASSWORD });
    for (const key of roleKeys) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    }
    return { email, id: user.id };
  };

  /** Enregistre une clé d'accès pour la session et renvoie l'authentificateur et la réponse du serveur. */
  const registerKey = async (session: Session, withPassword = true, label?: string) => {
    const authenticator = new VirtualAuthenticator(ORIGIN, RP_ID);
    const optionsResponse = await call("POST", "/auth/passkeys/register/options", session, withPassword ? { password: PASSWORD } : {});
    expect(optionsResponse.statusCode).toBe(200);
    const { challengeId, options } = optionsResponse.json();
    const verify = await call("POST", "/auth/passkeys/register/verify", session, {
      challengeId,
      response: authenticator.create(options),
      ...(label !== undefined && { label }),
    });
    return { authenticator, verify, options, challengeId };
  };

  /** Passe la vérification du second facteur par clé d'accès sur une session partielle. */
  const verifyWithKey = async (session: Session, authenticator: VirtualAuthenticator, userId: string) => {
    const optionsResponse = await call("POST", "/auth/passkeys/verify/options", session);
    expect(optionsResponse.statusCode).toBe(200);
    const { challengeId, options } = optionsResponse.json();
    return call("POST", "/auth/passkeys/verify", session, { challengeId, response: authenticator.get(options, userHandleOf(userId)) });
  };

  beforeAll(async () => {
    ({ app, db } = await boot(ORIGIN));
    ({ call, login, toSession } = helpers(app));
    prisma = app.get(PrismaService);
    users = app.get(UsersService);

    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    // Les clés d'accès sont l'objet de ce fichier : on retire d'abord l'exigence de second facteur des rôles.
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    admin = await login("admin@asso.test");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("est désactivé par défaut : rien ne change pour une installation existante", async () => {
    expect((await call("GET", "/auth/methods")).json()).toEqual({ passkeys: { mode: "DISABLED", usernameless: false } });
    const view = (await call("GET", "/security/passkeys", admin)).json();
    expect(view).toMatchObject({ mode: "DISABLED", usernameless: false, effectiveMode: "DISABLED", domain: { ok: true, rpId: RP_ID }, usableKeys: 0, otherDomainKeys: 0 });

    const user = await newUser();
    const session = await login(user.email);
    const state = (await call("GET", "/auth/passkeys", session)).json();
    expect(state).toMatchObject({ mode: "DISABLED", canRegister: false, items: [] });
    const refused = await call("POST", "/auth/passkeys/register/options", session, { password: PASSWORD });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("pas activées");
    expect((await call("POST", "/auth/passkeys/login/options", undefined, { email: user.email })).statusCode).toBe(409);
  });

  it("n'est réglable que par un administrateur, et refuse les combinaisons incohérentes", async () => {
    const president = await newUser(["president"]);
    const session = await login(president.email);
    expect((await call("GET", "/security/passkeys", session)).statusCode).toBe(200);
    expect((await call("PUT", "/security/passkeys", session, { passkeyMode: "FULL", passkeyUsernameless: false })).statusCode).toBe(403);
    expect((await call("GET", "/security/passkeys")).statusCode).toBe(401);

    const bad = await call("PUT", "/security/passkeys", admin, { passkeyMode: "SECOND_FACTOR", passkeyUsernameless: true });
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain("Connexion complète");
    expect((await call("PUT", "/security/passkeys", admin, { passkeyMode: "TOUJOURS", passkeyUsernameless: false })).statusCode).toBe(400);
    // Le réglage ne passe pas par l'API générique des paramètres.
    expect((await call("PUT", "/settings/security", admin, { passkeyMode: "FULL", passkeyUsernameless: false })).statusCode).toBe(404);

    expect((await setMode("SECOND_FACTOR")).effectiveMode).toBe("SECOND_FACTOR");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "settings.updated", objectId: "security" }, orderBy: { seq: "desc" } });
    expect(JSON.stringify(audit.details)).toContain("passkeyMode");
  });

  it("enregistre une clé d'accès : mot de passe redemandé, clé publique seule en base, codes de secours une fois, défi à usage unique", async () => {
    await setMode("SECOND_FACTOR");
    const user = await newUser();
    const session = await login(user.email);

    // Session complète : le mot de passe est exigé pour installer un accès durable.
    expect((await call("POST", "/auth/passkeys/register/options", session, {})).statusCode).toBe(400);
    expect((await call("POST", "/auth/passkeys/register/options", session, { password: "pas le bon mot de passe" })).statusCode).toBe(400);

    const { authenticator, verify, options, challengeId } = await registerKey(session, true, "  iPhone   de Camille ");
    expect(options).toMatchObject({
      rp: { id: RP_ID },
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      excludeCredentials: [],
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json();
    expect(body.passkey).toMatchObject({ label: "iPhone de Camille", deviceType: "multiDevice", backedUp: true, lastUsedAt: null });
    expect(body.recoveryCodes).toHaveLength(10);

    const stored = await prisma.passkeyCredential.findUniqueOrThrow({ where: { credentialId: authenticator.id } });
    expect(stored).toMatchObject({ userId: user.id, rpId: RP_ID, revokedAt: null });
    expect(Buffer.from(stored.publicKey).length).toBeGreaterThan(30);

    // Le journal ne contient ni identifiant de clé ni réponse du navigateur.
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "auth.passkey.registered", actorId: user.id } });
    expect(JSON.stringify(audit)).not.toContain(authenticator.id);

    // Le même défi ne sert qu'une fois.
    const replay = await call("POST", "/auth/passkeys/register/verify", session, { challengeId, response: authenticator.create(options) });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().message).toContain("expiré");

    // Une seconde inscription du même appareil est refusée avec un message clair (l'appareil est exclu des options).
    const again = await call("POST", "/auth/passkeys/register/options", session, { password: PASSWORD });
    expect(again.json().options.excludeCredentials).toHaveLength(1);

    // La session en cours reste complète (une clé vient d'être prouvée).
    expect((await call("GET", "/auth/me", session)).json().mfa).toEqual({ state: "OK", enabled: true, required: false, totp: false, passkey: true });
    expect((await call("GET", "/auth/passkeys", session)).json().items).toHaveLength(1);
  });

  it("sert de second facteur : session partielle jusqu'à la vérification, refus d'une autre origine, du rejeu et d'une autre session", async () => {
    await setMode("SECOND_FACTOR");
    const user = await newUser();
    const first = await login(user.email);
    const { authenticator, verify } = await registerKey(first);
    const recoveryCodes = verify.json().recoveryCodes as string[];

    // Nouvelle connexion par mot de passe : session partielle.
    const session = await login(user.email);
    expect(session.mfaState).toBe("VERIFICATION_REQUIRED");
    const denied = await call("GET", "/roles", session);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "MFA_REQUIRED", mfa: "VERIFICATION_REQUIRED" });
    expect((await call("GET", "/auth/passkeys", session)).statusCode).toBe(200);
    expect((await call("POST", "/auth/passkeys/register/options", session, { password: PASSWORD })).statusCode).toBe(403);

    const optionsResponse = await call("POST", "/auth/passkeys/verify/options", session);
    const { challengeId, options } = optionsResponse.json();
    expect(options.allowCredentials).toEqual([{ id: authenticator.id, type: "public-key", transports: ["internal"] }]);
    expect(options.userVerification).toBe("required");

    // Autre origine (faux site) : refusé, la session reste partielle.
    const phishing = await call("POST", "/auth/passkeys/verify", session, {
      challengeId,
      response: authenticator.get(options, userHandleOf(user.id), { origin: "https://compta.asso-fake.test" }),
    });
    // 400 et non 401 : sur une session ouverte, un 401 ferait croire au navigateur que la session a expiré.
    expect(phishing.statusCode).toBe(400);
    expect((await call("GET", "/auth/me", session)).json().mfa.state).toBe("VERIFICATION_REQUIRED");

    // Le défi a été consommé par la tentative : il ne peut pas servir avec une bonne réponse.
    const burnt = await call("POST", "/auth/passkeys/verify", session, { challengeId, response: authenticator.get(options, userHandleOf(user.id)) });
    expect(burnt.statusCode).toBe(400);

    // Un défi émis pour une autre session ne sert pas.
    const other = await login(user.email);
    const foreign = (await call("POST", "/auth/passkeys/verify/options", other)).json();
    const stolen = await call("POST", "/auth/passkeys/verify", session, { challengeId: foreign.challengeId, response: authenticator.get(foreign.options, userHandleOf(user.id)) });
    expect(stolen.statusCode).toBe(400);

    // Sans vérification de l'utilisateur (ni empreinte, ni code) : refusé avec une explication.
    const fresh = (await call("POST", "/auth/passkeys/verify/options", session)).json();
    const noUv = await call("POST", "/auth/passkeys/verify", session, { challengeId: fresh.challengeId, response: authenticator.get(fresh.options, userHandleOf(user.id), { userVerified: false }) });
    expect(noUv.statusCode).toBe(400);
    expect(noUv.json().message).toContain("c'est bien vous");

    // Une bonne réponse ouvre la session.
    expect((await verifyWithKey(session, authenticator, user.id)).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", session)).json().mfa).toMatchObject({ state: "OK", passkey: true });
    expect((await call("GET", "/auth/passkeys", session)).json().items[0].lastUsedAt).not.toBeNull();
    expect((await prisma.passkeyCredential.findUniqueOrThrow({ where: { credentialId: authenticator.id } })).counter).toBe(BigInt(authenticator.counter));
    // Plus aucune vérification n'est attendue.
    expect((await call("POST", "/auth/passkeys/verify/options", session)).statusCode).toBe(409);

    // Un code de secours reste valable pour qui n'a qu'une clé d'accès (appareil perdu).
    const lost = await login(user.email);
    expect(lost.mfaState).toBe("VERIFICATION_REQUIRED");
    const withCode = await call("POST", "/auth/mfa/verify", lost, { code: recoveryCodes[0] });
    expect(withCode.statusCode).toBe(200);
    expect(withCode.json()).toMatchObject({ method: "recovery", recoveryCodesLeft: 9 });
  });

  it("tient compte du réglage : désactivées, les clés enregistrées ne comptent plus comme second facteur", async () => {
    await setMode("SECOND_FACTOR");
    const user = await newUser();
    const { authenticator } = await registerKey(await login(user.email));
    expect((await login(user.email)).mfaState).toBe("VERIFICATION_REQUIRED");

    await setMode("DISABLED");
    const session = await login(user.email);
    expect(session.mfaState).toBe("OK");
    expect((await call("GET", "/auth/me", session)).json().mfa).toMatchObject({ enabled: false, passkey: false });
    // Elles sont conservées : réactiver le mode les rend aussitôt utilisables.
    expect((await call("GET", "/auth/passkeys", session)).json()).toMatchObject({ mode: "DISABLED", items: [{ label: "Ma clé d'accès" }] });
    expect((await call("POST", "/auth/passkeys/verify/options", session)).statusCode).toBe(409);
    expect(authenticator.id).toBeTruthy();
    await setMode("SECOND_FACTOR");
    expect((await login(user.email)).mfaState).toBe("VERIFICATION_REQUIRED");
  });

  it("inscrit une clé pendant l'inscription forcée d'un rôle qui exige le second facteur, sans mot de passe supplémentaire", async () => {
    await setMode("SECOND_FACTOR");
    await prisma.role.update({ where: { key: "president" }, data: { requiresMfa: true } });
    try {
      const user = await newUser(["president"]);
      const session = await login(user.email);
      expect(session.mfaState).toBe("ENROLLMENT_REQUIRED");
      expect((await call("GET", "/auth/me", session)).json().permissions).toEqual([]);

      const { verify } = await registerKey(session, false);
      expect(verify.statusCode).toBe(200);
      expect(verify.json().recoveryCodes).toHaveLength(10);
      const me = (await call("GET", "/auth/me", session)).json();
      expect(me.mfa).toEqual({ state: "OK", enabled: true, required: true, totp: false, passkey: true });
      expect(me.permissions).toContain("reports:view");

      // C'est sa seule protection et son rôle l'exige : la retirer est refusé, en expliquant quoi faire.
      const keyId = (await call("GET", "/auth/passkeys", session)).json().items[0].id as string;
      const refused = await call("POST", `/auth/passkeys/${keyId}/revoke`, session, { password: PASSWORD });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("Ajoutez d'abord une autre clé");
    } finally {
      await prisma.role.update({ where: { key: "president" }, data: { requiresMfa: false } });
    }
  });

  it("renomme et retire une clé (mot de passe exigé), sans jamais la supprimer", async () => {
    await setMode("SECOND_FACTOR");
    const user = await newUser();
    const session = await login(user.email);
    const { authenticator } = await registerKey(session);
    const keyId = (await call("GET", "/auth/passkeys", session)).json().items[0].id as string;

    expect((await call("PATCH", `/auth/passkeys/${keyId}`, session, { label: "Téléphone du local" })).statusCode).toBe(204);
    expect((await call("GET", "/auth/passkeys", session)).json().items[0].label).toBe("Téléphone du local");
    expect((await call("PATCH", `/auth/passkeys/${keyId}`, session, { label: "x".repeat(61) })).statusCode).toBe(400);
    expect((await call("PATCH", `/auth/passkeys/${randomUUID()}`, session, { label: "Autre" })).statusCode).toBe(404);

    expect((await call("POST", `/auth/passkeys/${keyId}/revoke`, session, {})).statusCode).toBe(400);
    expect((await call("POST", `/auth/passkeys/${keyId}/revoke`, session, { password: "faux" })).statusCode).toBe(400);
    expect((await call("POST", `/auth/passkeys/${keyId}/revoke`, session, { password: PASSWORD })).statusCode).toBe(204);
    expect((await call("GET", "/auth/passkeys", session)).json().items).toEqual([]);
    expect((await call("POST", `/auth/passkeys/${keyId}/revoke`, session, { password: PASSWORD })).statusCode).toBe(404);

    // Une clé retirée ne permet plus rien et se garde en base.
    expect((await login(user.email)).mfaState).toBe("OK");
    const row = await prisma.passkeyCredential.findUniqueOrThrow({ where: { credentialId: authenticator.id } });
    expect(row.revokedAt).not.toBeNull();
    await expect(prisma.passkeyCredential.update({ where: { id: row.id }, data: { revokedAt: null } })).rejects.toThrow(/réactive/);
    await expect(prisma.passkeyCredential.delete({ where: { id: row.id } })).rejects.toThrow(/ne se supprime pas/);
    await expect(prisma.passkeyCredential.update({ where: { id: row.id }, data: { rpId: "autre.test" } })).rejects.toThrow(/ne change pas/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "PasskeyCredential" CASCADE')).rejects.toThrow();
    expect(await prisma.auditEvent.count({ where: { action: "auth.passkey.revoked", actorId: user.id } })).toBe(1);
  });

  it("révoque aussi les clés quand un administrateur réinitialise le second facteur", async () => {
    await setMode("SECOND_FACTOR");
    const user = await newUser();
    const { authenticator } = await registerKey(await login(user.email));
    expect((await login(user.email)).mfaState).toBe("VERIFICATION_REQUIRED");

    expect((await call("POST", `/users/${user.id}/mfa/reset`, admin)).statusCode).toBe(204);
    const row = await prisma.passkeyCredential.findUniqueOrThrow({ where: { credentialId: authenticator.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect((await login(user.email)).mfaState).toBe("OK");
  });

  it("ne compte pas comme utilisables les clés d'un autre domaine, et le signale à l'administrateur", async () => {
    await setMode("SECOND_FACTOR");
    const user = await newUser();
    await prisma.passkeyCredential.create({
      data: { userId: user.id, credentialId: randomUUID(), publicKey: Buffer.from("clé"), deviceType: "singleDevice", label: "Ancien domaine", rpId: "ancien-domaine.test" },
    });
    const session = await login(user.email);
    expect(session.mfaState).toBe("OK");
    expect((await call("GET", "/auth/me", session)).json().mfa).toMatchObject({ passkey: false });
    expect((await call("GET", "/security/passkeys", admin)).json().otherDomainKeys).toBeGreaterThanOrEqual(1);
  });

  describe("connexion complète", () => {
    it("n'existe qu'en mode complet", async () => {
      await setMode("SECOND_FACTOR");
      const user = await newUser();
      expect((await call("POST", "/auth/passkeys/login/options", undefined, { email: user.email })).statusCode).toBe(409);
      expect((await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: randomUUID(), response: {} })).statusCode).toBeGreaterThanOrEqual(400);
    });

    it("avec l'adresse : identifiants réels pour un compte, leurre stable pour un compte inconnu, session complète à la connexion", async () => {
      await setMode("FULL");
      expect((await call("GET", "/auth/methods")).json()).toEqual({ passkeys: { mode: "FULL", usernameless: false } });
      const user = await newUser();
      const { authenticator } = await registerKey(await login(user.email));
      const unknown = `inconnu-${randomUUID()}@test.invalid`;

      expect((await call("POST", "/auth/passkeys/login/options", undefined, {})).statusCode).toBe(400);
      const real = (await call("POST", "/auth/passkeys/login/options", undefined, { email: ` ${user.email.toUpperCase()} ` })).json();
      expect(real.options.allowCredentials.map((c: { id: string }) => c.id)).toEqual([authenticator.id]);

      const decoy1 = (await call("POST", "/auth/passkeys/login/options", undefined, { email: unknown })).json();
      const decoy2 = (await call("POST", "/auth/passkeys/login/options", undefined, { email: unknown })).json();
      expect(decoy1.options.allowCredentials).toHaveLength(1);
      expect(decoy1.options.allowCredentials[0].id).toBe(decoy2.options.allowCredentials[0].id);
      expect(decoy1.options.allowCredentials[0].id).not.toBe(authenticator.id);

      // Un défi demandé pour une adresse inconnue ne mène jamais à une session.
      const forged = await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: decoy1.challengeId, response: authenticator.get(decoy1.options, userHandleOf(user.id)) });
      expect(forged.statusCode).toBe(401);

      const login1 = await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: real.challengeId, response: authenticator.get(real.options, userHandleOf(user.id)) });
      expect(login1.statusCode).toBe(200);
      const session = toSession(login1);
      expect(session.mfaState).toBe("OK");
      expect(login1.json().user.id).toBe(user.id);
      expect((await call("GET", "/auth/me", session)).json().mfa).toMatchObject({ state: "OK", passkey: true });
      const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "auth.login.success", actorId: user.id }, orderBy: { seq: "desc" } });
      expect(JSON.stringify(audit.details)).toContain('"method":"passkey"');

      // Le défi ne sert qu'une fois.
      const replay = await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: real.challengeId, response: authenticator.get(real.options, userHandleOf(user.id)) });
      expect(replay.statusCode).toBe(400);
    });

    it("satisfait un rôle qui exige le second facteur", async () => {
      await setMode("FULL");
      await prisma.role.update({ where: { key: "president" }, data: { requiresMfa: true } });
      try {
        const user = await newUser(["president"]);
        const { authenticator } = await registerKey(await login(user.email), false);
        const real = (await call("POST", "/auth/passkeys/login/options", undefined, { email: user.email })).json();
        const response = await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: real.challengeId, response: authenticator.get(real.options, userHandleOf(user.id)) });
        expect(response.statusCode).toBe(200);
        expect(response.json().mfa).toMatchObject({ state: "OK", required: true });
        expect(response.json().permissions).toContain("reports:view");
      } finally {
        await prisma.role.update({ where: { key: "president" }, data: { requiresMfa: false } });
      }
    });

    it("sans saisir l'adresse : l'appareil choisit le compte, et l'identifiant du compte doit être le bon", async () => {
      await setMode("FULL", true);
      expect((await call("GET", "/auth/methods")).json()).toEqual({ passkeys: { mode: "FULL", usernameless: true } });
      const user = await newUser();
      const other = await newUser();
      const { authenticator } = await registerKey(await login(user.email));

      const optionsResponse = (await call("POST", "/auth/passkeys/login/options", undefined, {})).json();
      expect(optionsResponse.options.allowCredentials ?? []).toEqual([]);

      // L'appareil annonce un autre compte que le propriétaire de la clé : refusé.
      const wrong = await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: optionsResponse.challengeId, response: authenticator.get(optionsResponse.options, userHandleOf(other.id)) });
      expect(wrong.statusCode).toBe(401);

      const second = (await call("POST", "/auth/passkeys/login/options", undefined, {})).json();
      const ok = await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: second.challengeId, response: authenticator.get(second.options, userHandleOf(user.id)) });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().user.id).toBe(user.id);
    });

    it("refuse un compte désactivé, une clé retirée et un domaine d'enregistrement différent", async () => {
      await setMode("FULL");
      const user = await newUser();
      const session = await login(user.email);
      const { authenticator } = await registerKey(session);
      const attempt = async () => {
        const real = (await call("POST", "/auth/passkeys/login/options", undefined, { email: user.email })).json();
        return call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: real.challengeId, response: authenticator.get(real.options, userHandleOf(user.id)) });
      };

      expect((await call("POST", `/users/${user.id}/disable`, admin)).statusCode).toBe(204);
      expect((await attempt()).statusCode).toBe(401);
      expect((await call("POST", `/users/${user.id}/enable`, admin)).statusCode).toBe(204);
      expect((await attempt()).statusCode).toBe(200);

      const fresh = await login(user.email);
      const keyId = (await call("GET", "/auth/passkeys", fresh)).json().items[0].id as string;
      // En mode complet la session par mot de passe reste partielle (clé enregistrée) : on la vérifie d'abord.
      expect((await verifyWithKey(fresh, authenticator, user.id)).statusCode).toBe(204);
      expect((await call("POST", `/auth/passkeys/${keyId}/revoke`, fresh, { password: PASSWORD })).statusCode).toBe(204);
      expect((await attempt()).statusCode).toBe(401);
    });

    it("ralentit les tentatives répétées comme la connexion par mot de passe", async () => {
      await setMode("FULL");
      const user = await newUser();
      const { authenticator } = await registerKey(await login(user.email));
      const ip = "203.0.113.77";
      let status = 0;
      for (let i = 0; i < 30 && status !== 429; i++) {
        const real = (await call("POST", "/auth/passkeys/login/options", undefined, { email: user.email }, ip)).json();
        if (!real.challengeId) {
          status = 429;
          break;
        }
        const response = await call("POST", "/auth/passkeys/login/verify", undefined, { challengeId: real.challengeId, response: authenticator.get(real.options, userHandleOf(user.id), { origin: "https://faux.test" }) }, ip);
        status = response.statusCode;
      }
      expect(status).toBe(429);
    });
  });
});

describe("Clés d'accès (domaine inutilisable)", () => {
  it("refuse de les activer sans adresse publique https, avec une explication, mais accepte de les désactiver", async () => {
    for (const [publicUrl, fragment] of [
      [null, "n'est pas renseignée"],
      ["http://compta.asso.test", "pas en https"],
    ] as const) {
      const { app, db } = await boot(publicUrl);
      try {
        const { call, login } = helpers(app);
        const prisma = app.get(PrismaService);
        const token = (await app.get(SetupService).ensureToken())!;
        await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
        await prisma.role.updateMany({ data: { requiresMfa: false } });
        const admin = await login("admin@asso.test");

        const view = (await call("GET", "/security/passkeys", admin)).json();
        expect(view.domain.ok).toBe(false);

        const refused = await call("PUT", "/security/passkeys", admin, { passkeyMode: "SECOND_FACTOR", passkeyUsernameless: false });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().message).toContain(fragment);
        expect(refused.json().message).toContain("PUBLIC_URL");
        expect((await call("GET", "/security/passkeys", admin)).json().mode).toBe("DISABLED");
        expect((await call("PUT", "/security/passkeys", admin, { passkeyMode: "DISABLED", passkeyUsernameless: false })).statusCode).toBe(200);
      } finally {
        await app.close();
        await db.drop();
      }
    }
  }, 120_000);
});
