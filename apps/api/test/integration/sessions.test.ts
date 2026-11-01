import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module.js";
import { LoginThrottleService } from "../../src/auth/login-throttle.service.js";
import { hashSessionToken } from "../../src/auth/session-tokens.js";
import { SessionService } from "../../src/auth/session.service.js";
import { UsersService } from "../../src/auth/users.service.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import type { TestingModule } from "@nestjs/testing";

const PASSWORD = "une phrase de passe correcte";
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

describe("SessionService (base réelle)", () => {
  let moduleRef: TestingModule;
  let sessions: SessionService;
  let users: UsersService;
  let prisma: PrismaService;

  const newUser = () =>
    users.createUser({ email: `s-${randomUUID()}@test.invalid`, displayName: "S", password: PASSWORD });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    await moduleRef.init();
    sessions = moduleRef.get(SessionService);
    users = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("crée une session dont seul l'empreinte du jeton est stockée", async () => {
    const user = await newUser();
    const created = await sessions.create(user.id, { ipAddress: "203.0.113.7", userAgent: "test" });
    const stored = await prisma.session.findUniqueOrThrow({ where: { id: created.sessionId } });
    expect(stored.tokenHash).toBe(hashSessionToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(stored.ipAddress).toBe("203.0.113.7");
  });

  it("valide une session active et renvoie l'utilisateur sans secret", async () => {
    const user = await newUser();
    const { token, csrfToken } = await sessions.create(user.id);
    const valid = await sessions.validate(token);
    expect(valid?.user).toMatchObject({ id: user.id, email: user.email });
    expect(valid?.user).not.toHaveProperty("passwordHash");
    expect(valid?.csrfToken).toBe(csrfToken);
    await expect(sessions.validate("jeton-inconnu")).resolves.toBeNull();
  });

  it("expire après 2 h d'inactivité, mais la glissée prolonge la session", async () => {
    const user = await newUser();
    const start = new Date();
    const { token } = await sessions.create(user.id, {}, start);

    await expect(sessions.validate(token, new Date(start.getTime() + minutes(119)))).resolves.not.toBeNull();
    // L'activité à 119 min a repoussé l'échéance d'inactivité : 200 min après le début reste valide.
    await expect(sessions.validate(token, new Date(start.getTime() + minutes(200)))).resolves.not.toBeNull();
    // Plus de 2 h sans activité : expirée.
    await expect(sessions.validate(token, new Date(start.getTime() + minutes(200 + 121)))).resolves.toBeNull();
  });

  it("expire à la durée maximale de 12 h même en cas d'activité continue", async () => {
    const user = await newUser();
    const start = new Date();
    const { token } = await sessions.create(user.id, {}, start);
    for (let h = 1; h <= 11; h += 1) {
      await expect(sessions.validate(token, new Date(start.getTime() + hours(h)))).resolves.not.toBeNull();
    }
    await expect(sessions.validate(token, new Date(start.getTime() + hours(12) + 1000))).resolves.toBeNull();
  });

  it("refuse une session révoquée ou dont le compte est désactivé", async () => {
    const user = await newUser();
    const a = await sessions.create(user.id);
    await sessions.revoke(a.sessionId);
    await expect(sessions.validate(a.token)).resolves.toBeNull();

    const b = await sessions.create(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    await expect(sessions.validate(b.token)).resolves.toBeNull();
  });

  it("déconnecte partout : révoque toutes les sessions actives d'un utilisateur", async () => {
    const user = await newUser();
    const a = await sessions.create(user.id);
    const b = await sessions.create(user.id);
    const other = await sessions.create((await newUser()).id);

    await expect(sessions.revokeAllForUser(user.id)).resolves.toBe(2);
    await expect(sessions.validate(a.token)).resolves.toBeNull();
    await expect(sessions.validate(b.token)).resolves.toBeNull();
    await expect(sessions.validate(other.token)).resolves.not.toBeNull();
  });
});

describe("LoginThrottleService (base réelle)", () => {
  let moduleRef: TestingModule;
  let throttle: LoginThrottleService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    await moduleRef.init();
    throttle = moduleRef.get(LoginThrottleService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const email = () => `t-${randomUUID()}@test.invalid`;
  const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

  it("tolère 5 échecs puis impose un délai croissant par compte", async () => {
    const e = email();
    const now = new Date();
    for (let i = 0; i < 5; i += 1) await throttle.record(e, undefined, false, now);
    await expect(throttle.check(e, undefined, now)).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });

    await throttle.record(e, undefined, false, now);
    await expect(throttle.check(e, undefined, now)).resolves.toEqual({ allowed: false, retryAfterSeconds: 2 });
    // Le délai écoulé, la tentative suivante est permise : aucun verrouillage définitif.
    await expect(throttle.check(e, undefined, new Date(now.getTime() + 3000))).resolves.toMatchObject({ allowed: true });

    await throttle.record(e, undefined, false, now);
    await expect(throttle.check(e, undefined, now)).resolves.toEqual({ allowed: false, retryAfterSeconds: 4 });
  });

  it("oublie les échecs au-delà de 15 minutes", async () => {
    const e = email();
    const now = new Date();
    for (let i = 0; i < 12; i += 1) await throttle.record(e, undefined, false, now);
    await expect(throttle.check(e, undefined, new Date(now.getTime() + minutes(16)))).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("remet le compteur à zéro après une connexion réussie", async () => {
    const e = email();
    const now = new Date();
    for (let i = 0; i < 8; i += 1) await throttle.record(e, undefined, false, now);
    await throttle.record(e, undefined, true, new Date(now.getTime() + 1000));
    await expect(throttle.check(e, undefined, new Date(now.getTime() + 2000))).resolves.toMatchObject({ allowed: true });
  });

  it("limite aussi par adresse IP, plus tolérante, quelle que soit l'adresse email", async () => {
    const address = ip();
    const now = new Date();
    for (let i = 0; i < 20; i += 1) await throttle.record(email(), address, false, now);
    await expect(throttle.check(email(), address, now)).resolves.toMatchObject({ allowed: true });

    await throttle.record(email(), address, false, now);
    await expect(throttle.check(email(), address, now)).resolves.toEqual({ allowed: false, retryAfterSeconds: 2 });
    await expect(throttle.check(email(), ip(), now)).resolves.toMatchObject({ allowed: true });
  });

  it("traite une adresse inconnue comme une adresse connue (aucune fuite d'existence)", async () => {
    const e = email();
    const now = new Date();
    for (let i = 0; i < 6; i += 1) await throttle.record(e, undefined, false, now);
    await expect(throttle.check(e, undefined, now)).resolves.toMatchObject({ allowed: false });
  });
});
