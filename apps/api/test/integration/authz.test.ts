import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { DiscoveryModule, DiscoveryService, Reflector } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { IS_PUBLIC } from "../../src/auth/public.decorator.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { AUTHENTICATED_ONLY, REQUIRED_PERMISSIONS } from "../../src/authz/decorators.js";
import { DEFAULT_ROLES } from "../../src/authz/default-roles.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

describe("Autorisation (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let adminId: string;
  let admin: Session;

  interface Session {
    cookie: string;
    csrf: string;
    userId: string;
  }

  const call = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    session?: Session,
    body?: unknown,
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: {
        ...(session && { cookie: session.cookie }),
        ...(session && method !== "GET" && { "x-csrf-token": session.csrf }),
      },
      ...(body !== undefined && { payload: body as Record<string, unknown> }),
    });

  const login = async (email: string): Promise<Session> => {
    const response = await call("POST", "/auth/login", undefined, { email, password: PASSWORD });
    expect(response.statusCode).toBe(200);
    return {
      cookie: String(response.headers["set-cookie"]).split(";")[0]!,
      csrf: response.json().csrfToken as string,
      userId: response.json().user.id as string,
    };
  };

  const newUser = async (): Promise<{ email: string; id: string }> => {
    const email = `u-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "U", password: PASSWORD });
    return { email, id: user.id };
  };

  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;

  const giveRole = async (userId: string, key: string) => {
    await prisma.roleAssignment.create({ data: { userId, roleId: await roleId(key) } });
  };

  beforeAll(async () => {
    db = await createTempDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
      .overrideProvider(ENV)
      .useValue({ ...readEnv(), databaseUrl: db.url, cookieSecure: true })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    users = app.get(UsersService);

    // Installation réelle : le premier compte reçoit le rôle d'administration.
    const token = (await app.get(SetupService).ensureToken())!;
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD },
    });
    expect(setup.statusCode).toBe(201);
    adminId = setup.json().user.id;
    // Ces tests portent sur les droits et les comptes, pas sur le second facteur : les rôles par défaut l'exigent, on le désactive ici.
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    admin = await login("admin@asso.test");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("installe les rôles par défaut et donne au premier compte le rôle d'administrateur technique", async () => {
    const keys = (await prisma.role.findMany()).map((r) => r.key).sort();
    expect(keys).toEqual(DEFAULT_ROLES.map((r) => r.key).sort());

    const me = await call("GET", "/auth/me", admin);
    const technicalAdmin = DEFAULT_ROLES.find((r) => r.key === "technical-admin")!;
    expect((me.json().permissions as string[]).toSorted()).toEqual(technicalAdmin.permissions.toSorted());
    expect(me.json().permissions).not.toContain("entries:post");

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "setup.completed" } });
    expect(audit.details).toMatchObject({ role: "technical-admin" });
  });

  it("refuse par défaut : un compte sans rôle n'accède à rien d'autre qu'à son propre profil", async () => {
    const { email } = await newUser();
    const session = await login(email);
    expect((await call("GET", "/auth/me", session)).json().permissions).toEqual([]);
    expect((await call("GET", "/roles", session)).statusCode).toBe(403);
    expect((await call("GET", "/users", session)).statusCode).toBe(403);
    expect((await call("GET", "/authz/permissions", session)).statusCode).toBe(200);
    expect((await call("GET", "/roles")).statusCode).toBe(401);
  });

  it("applique les permissions du rôle : lecture ouverte au président, administration refusée", async () => {
    const { email, id } = await newUser();
    await giveRole(id, "president");
    const president = await login(email);

    expect((await call("GET", "/roles", president)).statusCode).toBe(200);
    expect((await call("GET", `/users/${adminId}/access`, president)).statusCode).toBe(200);
    expect(
      (await call("POST", "/roles", president, { key: "x", name: "X", description: "", permissions: [] })).statusCode,
    ).toBe(403);
    expect((await call("POST", `/users/${id}/assignments`, president, { roleId: await roleId("reader") })).statusCode).toBe(403);
  });

  it("ignore les attributions révoquées, expirées ou futures, et les comptes désactivés", async () => {
    const { email, id } = await newUser();
    const treasurer = await roleId("treasurer");
    const now = Date.now();
    await prisma.roleAssignment.createMany({
      data: [
        { userId: id, roleId: treasurer, revokedAt: new Date(now - 1000) },
        { userId: id, roleId: treasurer, startsAt: new Date(now - 7_200_000), endsAt: new Date(now - 3_600_000) },
        { userId: id, roleId: treasurer, startsAt: new Date(now + 3_600_000) },
      ],
    });
    const session = await login(email);
    expect((await call("GET", "/auth/me", session)).json().permissions).toEqual([]);

    await giveRole(id, "reader");
    expect((await call("GET", "/auth/me", session)).json().permissions.toSorted()).toEqual(["documents:view", "projects:view"]);

    await prisma.user.update({ where: { id }, data: { status: "DISABLED" } });
    expect((await call("GET", "/auth/me", session)).statusCode).toBe(401);
  });

  it("explique l'origine d'un droit dans les accès effectifs", async () => {
    const { id } = await newUser();
    await giveRole(id, "president");
    await giveRole(id, "treasurer");
    const access = (await call("GET", `/users/${id}/access`, admin)).json().permissions as {
      permission: string;
      grantedBy: { roleKey: string }[];
    }[];
    const view = access.find((a) => a.permission === "entries:view")!;
    expect(view.grantedBy.map((g) => g.roleKey).sort()).toEqual(["president", "treasurer"]);
    const post = access.find((a) => a.permission === "entries:post")!;
    expect(post.grantedBy.map((g) => g.roleKey)).toEqual(["treasurer"]);
  });

  it("permet à un administrateur de créer un rôle, d'attribuer et de révoquer, avec audit", async () => {
    const created = await call("POST", "/roles", admin, {
      key: "auditor",
      name: "Auditeur",
      description: "Lecture seule",
      permissions: ["audit:view", "reports:view"],
    });
    expect(created.statusCode).toBe(201);

    expect((await call("POST", "/roles", admin, { key: "auditor", name: "Doublon", permissions: [] })).statusCode).toBe(409);
    expect((await call("POST", "/roles", admin, { key: "Mauvaise Cle", name: "X", permissions: [] })).statusCode).toBe(400);
    expect((await call("POST", "/roles", admin, { key: "inconnu", name: "X", permissions: ["tout:faire"] })).statusCode).toBe(400);

    const { id } = await newUser();
    const assignment = await call("POST", `/users/${id}/assignments`, admin, { roleId: created.json().id });
    expect(assignment.statusCode).toBe(201);
    expect((await call("DELETE", `/assignments/${assignment.json().id}`, admin)).statusCode).toBe(204);
    expect((await call("DELETE", `/assignments/${assignment.json().id}`, admin)).statusCode).toBe(404);

    const actions = (await prisma.auditEvent.findMany({ where: { actorId: adminId } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["role.created", "role.assigned", "role.revoked"]));
  });

  it("ne supprime jamais une attribution : l'historique des droits est conservé", async () => {
    const { id } = await newUser();
    await giveRole(id, "reader");
    const assignment = await prisma.roleAssignment.findFirstOrThrow({ where: { userId: id } });
    await expect(prisma.roleAssignment.delete({ where: { id: assignment.id } })).rejects.toThrow(/ne se supprime pas/);
  });

  it("protège le dernier administrateur : révocation et retrait de la permission refusés", async () => {
    const adminAssignment = await prisma.roleAssignment.findFirstOrThrow({ where: { userId: adminId, revokedAt: null } });
    expect((await call("DELETE", `/assignments/${adminAssignment.id}`, admin)).statusCode).toBe(409);

    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "technical-admin" } });
    const withoutAdmin = adminRole.permissions.filter((p) => p !== "users:admin");
    const edit = await call("PUT", `/roles/${adminRole.id}`, admin, {
      name: adminRole.name,
      description: adminRole.description,
      permissions: withoutAdmin,
    });
    expect(edit.statusCode).toBe(409);
    await expect(prisma.role.findUniqueOrThrow({ where: { key: "technical-admin" } })).resolves.toMatchObject({
      permissions: adminRole.permissions,
    });
  });

  it("autorise la révocation quand un autre administrateur actif existe", async () => {
    const { email, id } = await newUser();
    await giveRole(id, "technical-admin");
    const second = await login(email);

    const adminAssignment = await prisma.roleAssignment.findFirstOrThrow({ where: { userId: adminId, revokedAt: null } });
    expect((await call("DELETE", `/assignments/${adminAssignment.id}`, second)).statusCode).toBe(204);

    // Le second est désormais le dernier : il ne peut pas se révoquer lui-même.
    const own = await prisma.roleAssignment.findFirstOrThrow({ where: { userId: id, revokedAt: null } });
    expect((await call("DELETE", `/assignments/${own.id}`, second)).statusCode).toBe(409);

    // Rétablit l'état pour les tests suivants.
    await giveRole(adminId, "technical-admin");
  });

  it("sérialise les révocations concurrentes : un administrateur reste toujours", async () => {
    const a = await newUser();
    const b = await newUser();
    await giveRole(a.id, "technical-admin");
    await giveRole(b.id, "technical-admin");
    // Tous les administrateurs actuels, y compris le compte d'installation.
    const assignments = await prisma.roleAssignment.findMany({
      where: { revokedAt: null, role: { permissions: { has: "users:admin" } } },
    });
    expect(assignments.length).toBeGreaterThanOrEqual(3);

    const sessionB = await login(b.email);
    const results = await Promise.all(assignments.map((x) => call("DELETE", `/assignments/${x.id}`, sessionB)));
    expect(results.some((r) => r.statusCode === 409)).toBe(true);

    const remaining = await prisma.roleAssignment.count({
      where: { revokedAt: null, role: { permissions: { has: "users:admin" } }, user: { status: "ACTIVE" } },
    });
    expect(remaining).toBeGreaterThanOrEqual(1);
  });

  it("déclare explicitement l'accès de chaque route : une route sans déclaration serait refusée", () => {
    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);
    const undeclared: string[] = [];
    let routes = 0;

    for (const wrapper of discovery.getControllers()) {
      const prototype = wrapper.metatype?.prototype as Record<string, unknown> | undefined;
      if (!prototype) continue;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === "constructor" || typeof handler !== "function" || Reflect.getMetadata("path", handler) === undefined) continue;
        routes += 1;
        const targets = [handler, wrapper.metatype!];
        const declared = [IS_PUBLIC, AUTHENTICATED_ONLY, REQUIRED_PERMISSIONS].some(
          (key) => reflector.getAllAndOverride(key, targets) !== undefined,
        );
        if (!declared) undeclared.push(`${wrapper.metatype!.name}.${name}`);
      }
    }
    expect(routes).toBeGreaterThan(10);
    expect(undeclared).toEqual([]);
  });
});
