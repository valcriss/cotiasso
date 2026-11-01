import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { UsersService } from "../../src/auth/users.service.js";

const PASSWORD = "une phrase de passe correcte";
const COOKIE = "__Host-cotiasso_session";

describe("Authentification HTTP (base réelle)", () => {
  let app: NestFastifyApplication;
  let users: UsersService;
  let prisma: PrismaService;

  // Chaque test utilise sa propre adresse IP pour ne pas partager le compteur anti-brute-force.
  const newIp = () => `198.51.100.${randomInt(1, 250)}`;

  const call = (
    method: "GET" | "POST",
    url: string,
    options: { ip?: string; cookie?: string; csrf?: string; body?: unknown } = {},
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: options.ip ?? newIp(),
      headers: {
        ...(options.cookie && { cookie: options.cookie }),
        ...(options.csrf && { "x-csrf-token": options.csrf }),
      },
      ...(options.body !== undefined && { payload: options.body as Record<string, unknown> }),
    });

  const sessionCookie = (setCookie: string | string[] | undefined): string => {
    const header = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
    return header.split(";")[0]!;
  };

  const newAccount = async () => {
    const email = `h-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "H", password: PASSWORD });
    return { email, user };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue({ ...readEnv(), cookieSecure: true })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    users = app.get(UsersService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuse par défaut : une route sans session répond 401, /health reste publique", async () => {
    expect((await call("GET", "/auth/me")).statusCode).toBe(401);
    expect((await call("GET", "/health")).statusCode).toBe(200);
  });

  it("répond de la même façon pour un mauvais mot de passe et un compte inconnu", async () => {
    const { email } = await newAccount();
    const wrong = await call("POST", "/auth/login", { body: { email, password: "mauvais mot de passe" } });
    const unknown = await call("POST", "/auth/login", {
      body: { email: `x-${randomUUID()}@test.invalid`, password: PASSWORD },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it("rejette un corps de requête invalide", async () => {
    expect((await call("POST", "/auth/login", { body: { email: 42, password: "x" } })).statusCode).toBe(400);
    expect((await call("POST", "/auth/login", { body: {} })).statusCode).toBe(400);
  });

  it("ouvre une session avec un cookie httpOnly, Secure, SameSite=Lax", async () => {
    const { email, user } = await newAccount();
    const login = await call("POST", "/auth/login", { body: { email: email.toUpperCase(), password: PASSWORD } });
    expect(login.statusCode).toBe(200);

    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toContain(`${COOKIE}=`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=43200"]) {
      expect(setCookie).toContain(flag);
    }
    expect(setCookie).not.toContain("Domain=");

    const body = login.json();
    expect(body.user).toMatchObject({ id: user.id, email });
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("passwordHash");

    const me = await call("GET", "/auth/me", { cookie: sessionCookie(login.headers["set-cookie"]) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(user.id);
  });

  it("exige le jeton CSRF sur les requêtes modifiantes, puis déconnecte et révoque", async () => {
    const { email } = await newAccount();
    const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
    const cookie = sessionCookie(login.headers["set-cookie"]);
    const csrf = login.json().csrfToken as string;

    expect((await call("POST", "/auth/logout", { cookie })).statusCode).toBe(403);
    expect((await call("POST", "/auth/logout", { cookie, csrf: "faux" })).statusCode).toBe(403);
    expect((await call("GET", "/auth/me", { cookie })).statusCode).toBe(200);

    const logout = await call("POST", "/auth/logout", { cookie, csrf });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await call("GET", "/auth/me", { cookie })).statusCode).toBe(401);
  });

  it("impose un délai croissant après 5 échecs, même avec le bon mot de passe", async () => {
    const { email } = await newAccount();
    const ip = newIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await call("POST", "/auth/login", { ip, body: { email, password: "mauvais mot de passe" } })).statusCode).toBe(401);
    }
    const sixth = await call("POST", "/auth/login", { ip, body: { email, password: "mauvais mot de passe" } });
    expect(sixth.statusCode).toBe(401);

    const blocked = await call("POST", "/auth/login", { ip, body: { email, password: PASSWORD } });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("audite les connexions sans y écrire de secret", async () => {
    const { email, user } = await newAccount();
    await call("POST", "/auth/login", { body: { email, password: "mauvais mot de passe" } });
    const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
    const cookie = sessionCookie(login.headers["set-cookie"]);

    const events = await prisma.auditEvent.findMany({ where: { objectId: user.id, action: "auth.login.success" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe(user.id);

    const dump = JSON.stringify(await prisma.auditEvent.findMany({ where: { actorId: user.id } }));
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(cookie.split("=")[1]!);
  });
});
