import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
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
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

describe("Portée projet des droits (ADR 0022, base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let admin: Session;
  let treasurer: Session;
  const ids: Record<string, string> = {};

  const call = (method: Method, url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const login = async (email: string): Promise<Session> => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: PASSWORD },
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    });
    return { cookie: String(response.headers["set-cookie"]).split(";")[0]!, csrf: response.json().csrfToken };
  };
  const newUser = async (roleKey?: string) => {
    const email = `u-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "Personne", password: PASSWORD });
    if (roleKey) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    }
    return { id: user.id, email };
  };
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  const assign = (userId: string, body: object) => call("POST", `/users/${userId}/assignments`, admin, body);

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
    await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD },
    });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    admin = await login("admin@asso.test");
    const t = await newUser("treasurer");
    treasurer = await login(t.email);
    ids.a = (await call("POST", "/projects", treasurer, { code: "ATELIERS", name: "Ateliers" })).json().id;
    ids.b = (await call("POST", "/projects", treasurer, { code: "FESTIVAL", name: "Festival" })).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("attribution à portée projet", () => {
    it("refuse un rôle sans droit applicable à un projet, un projet inconnu et un doublon, en l'expliquant", async () => {
      const person = await newUser();
      const noScope = await assign(person.id, { roleId: await roleId("technical-admin"), projectId: ids.a });
      expect(noScope.statusCode).toBe(400);
      expect(noScope.json().message).toContain("aucun droit applicable à un projet");
      expect((await assign(person.id, { roleId: await roleId("project-manager"), projectId: randomUUID() })).statusCode).toBe(400);

      const first = await assign(person.id, { roleId: await roleId("project-manager"), projectId: ids.a });
      expect(first.statusCode, first.body).toBe(201);
      expect(first.json().projectId).toBe(ids.a);
      const twice = await assign(person.id, { roleId: await roleId("project-manager"), projectId: ids.a });
      expect(twice.statusCode).toBe(400);
      expect(twice.json().message).toContain("déjà ce rôle");
      // Même rôle sur un autre projet, ou globalement : permis.
      expect((await assign(person.id, { roleId: await roleId("project-manager"), projectId: ids.b })).statusCode).toBe(201);
    });

    it("liste le projet de l'attribution et le détaille dans les accès effectifs", async () => {
      const person = await newUser();
      await assign(person.id, { roleId: await roleId("project-manager"), projectId: ids.a });
      const listed = (await call("GET", "/users", admin)).json().find((u: { id: string }) => u.id === person.id);
      expect(listed.roleAssignments[0]).toMatchObject({ project: { code: "ATELIERS" }, role: { key: "project-manager" } });

      const access = (await call("GET", `/users/${person.id}/access`, admin)).json();
      expect(access.permissions).toEqual([]);
      expect(access.projectPermissions.map((p: { permission: string; projectCode: string }) => `${p.permission}@${p.projectCode}`)).toEqual([
        "projects:update@ATELIERS",
        "projects:view@ATELIERS",
      ]);
      expect(access.projectPermissions[0].grantedBy).toMatchObject({ roleKey: "project-manager" });
    });
  });

  describe("droits d'une personne limitée à un projet", () => {
    let scoped: Session;
    let person: { id: string; email: string };

    beforeAll(async () => {
      person = await newUser();
      await assign(person.id, { roleId: await roleId("project-manager"), projectId: ids.a });
      scoped = await login(person.email);
    });

    it("n'a aucun droit global : le reste du rôle ne fuit pas", async () => {
      const me = (await call("GET", "/auth/me", scoped)).json();
      expect(me.permissions).toEqual([]);
      expect(me.projectPermissions).toEqual({ "projects:view": [ids.a], "projects:update": [ids.a] });
      // Le rôle « chef de projet » porte d'autres droits (documents…), jamais accordés globalement par une portée projet.
      expect((await call("GET", "/documents", scoped)).statusCode).toBe(403);
      expect((await call("GET", "/entries", scoped)).statusCode).toBe(403);
    });

    it("ne voit que son projet : la liste est filtrée et un autre projet est introuvable", async () => {
      const list = (await call("GET", "/projects", scoped)).json();
      expect(list.map((p: { code: string }) => p.code)).toEqual(["ATELIERS"]);
      expect((await call("GET", `/projects/${ids.a}`, scoped)).statusCode).toBe(200);
      expect((await call("GET", `/projects/${ids.a}/summary`, scoped)).statusCode).toBe(200);
      expect((await call("GET", `/projects/${ids.b}`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.b}/summary`, scoped)).statusCode).toBe(404);
    });

    it("modifie son projet mais pas les autres, et ne crée pas de projet (droit global)", async () => {
      expect((await call("PATCH", `/projects/${ids.a}`, scoped, { name: "Ateliers d'été" })).statusCode).toBe(200);
      expect((await call("PATCH", `/projects/${ids.b}`, scoped, { name: "Piraté" })).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.b}`, treasurer)).json().name).toBe("Festival");
      expect((await call("POST", "/projects", scoped, { code: "NOUVEAU", name: "Nouveau" })).statusCode).toBe(403);
    });

    it("perd l'accès dès que l'attribution est révoquée", async () => {
      const mine = (await call("GET", "/users", admin)).json().find((u: { id: string }) => u.id === person.id).roleAssignments[0];
      expect((await call("DELETE", `/assignments/${mine.id}`, admin)).statusCode).toBe(204);
      expect((await call("GET", "/projects", scoped)).statusCode).toBe(403);
      expect((await call("GET", `/projects/${ids.a}`, scoped)).statusCode).toBe(403);
    });
  });

  describe("droits globaux et autres garanties", () => {
    it("un droit global voit tous les projets", async () => {
      const list = (await call("GET", "/projects", treasurer)).json();
      expect(list.map((p: { code: string }) => p.code).sort()).toEqual(["ATELIERS", "FESTIVAL", "FONCT"]);
      expect((await call("PATCH", `/projects/${ids.b}`, treasurer, { name: "Festival d'automne" })).statusCode).toBe(200);
    });

    it("une portée expirée n'accorde rien", async () => {
      const person = await newUser();
      await prisma.roleAssignment.create({
        data: {
          userId: person.id,
          roleId: await roleId("project-manager"),
          projectId: ids.a!,
          startsAt: new Date(Date.now() - 7_200_000),
          endsAt: new Date(Date.now() - 3_600_000),
        },
      });
      const session = await login(person.email);
      expect((await call("GET", "/projects", session)).statusCode).toBe(403);
      expect((await call("GET", "/auth/me", session)).json().projectPermissions).toEqual({});
    });

    it("une attribution à portée projet ne compte pas comme administrateur", async () => {
      // Seul compte administrateur : le retirer reste refusé même si d'autres comptes ont une portée projet.
      const adminAssignment = (await call("GET", "/users", admin)).json().find((u: { email: string }) => u.email === "admin@asso.test").roleAssignments[0];
      const refused = await call("DELETE", `/assignments/${adminAssignment.id}`, admin);
      expect(refused.statusCode).toBe(409);
    });

    it("refuse en SQL de changer l'utilisateur, le rôle ou le projet d'une attribution", async () => {
      const person = await newUser();
      const created = (await assign(person.id, { roleId: await roleId("project-manager"), projectId: ids.a })).json();
      const run = async (sql: string) => {
        try {
          await prisma.$executeRawUnsafe(sql);
        } catch (error) {
          return String((error as Error).message) + String((error as { cause?: unknown }).cause ?? "");
        }
        return null;
      };
      expect(await run(`UPDATE "RoleAssignment" SET "projectId" = '${ids.b}' WHERE id = '${created.id}'`)).toContain("ne changent pas");
      expect(await run(`UPDATE "RoleAssignment" SET "projectId" = NULL WHERE id = '${created.id}'`)).toContain("ne changent pas");
      // La révocation, elle, reste permise.
      expect(await run(`UPDATE "RoleAssignment" SET "revokedAt" = now() WHERE id = '${created.id}'`)).toBeNull();
    });
  });
});
