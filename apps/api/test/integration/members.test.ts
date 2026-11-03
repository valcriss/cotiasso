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

describe("Membres : fiches, catégories, fonctions et oubli (ADR 0023, base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let boardMember: Session;
  let reader: Session;

  const call = (method: Method, url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `m-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "T", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: PASSWORD },
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    });
    return { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
  };
  const sqlError = async (statement: string) => {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      return String((error as Error).message) + String((error as { cause?: unknown }).cause ?? "");
    }
    return null;
  };
  const newMember = async (overrides: Record<string, unknown> = {}) => {
    const response = await call("POST", "/members", treasurer, { firstName: "Marie", lastName: "Dupont", ...overrides });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; version: number; [key: string]: unknown };
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
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("fiches", () => {
    it("réserve la consultation à members:view et la gestion à members:manage", async () => {
      expect((await call("GET", "/members")).statusCode).toBe(401);
      expect((await call("GET", "/members", reader)).statusCode).toBe(403);
      expect((await call("GET", "/members", boardMember)).statusCode).toBe(200);
      expect((await call("POST", "/members", boardMember, { firstName: "A", lastName: "B" })).statusCode).toBe(403);
      expect((await call("POST", "/member-categories", boardMember, { name: "Adulte" })).statusCode).toBe(403);
    });

    it("crée un membre avec le strict nécessaire, refuse un nom manquant et un email invalide", async () => {
      const member = await newMember();
      expect(member).toMatchObject({ firstName: "Marie", lastName: "Dupont", status: "ACTIVE", email: null, hasAccount: false, anonymized: false, currentOffices: [], version: 1 });
      expect((await call("POST", "/members", treasurer, { firstName: "Marie" })).statusCode).toBe(400);
      const invalid = await call("POST", "/members", treasurer, { firstName: "A", lastName: "B", email: "pas-un-email" });
      expect(invalid.statusCode).toBe(400);
      expect(JSON.stringify(invalid.json())).toContain("Adresse email invalide");
      expect((await call("POST", "/members", treasurer, { firstName: "A", lastName: "B", inconnu: 1 })).statusCode).toBe(400);
    });

    it("refuse un doublon d'email sans tenir compte de la casse, et l'explique", async () => {
      await newMember({ firstName: "Paul", lastName: "Martin", email: "Paul.Martin@asso.fr" });
      const twice = await call("POST", "/members", treasurer, { firstName: "Autre", lastName: "Personne", email: "paul.martin@ASSO.fr" });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("adresse email");
    });

    it("modifie avec contrôle de version, et refuse une modification périmée", async () => {
      const member = await newMember({ firstName: "Léa", lastName: "Bernard" });
      const updated = await call("PATCH", `/members/${member.id}`, treasurer, { version: 1, phone: "0600000000", city: "Lyon" });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json()).toMatchObject({ phone: "0600000000", city: "Lyon", version: 2 });
      const stale = await call("PATCH", `/members/${member.id}`, treasurer, { version: 1, city: "Paris" });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().message).toContain("modifiée entre-temps");
    });

    it("liste, recherche et filtre par statut et par catégorie", async () => {
      const category = (await call("POST", "/member-categories", treasurer, { name: "Étudiant" })).json();
      const a = await newMember({ firstName: "Zoé", lastName: "Aubert", categoryId: category.id });
      await newMember({ firstName: "Yan", lastName: "Zorro" });
      const byName = (await call("GET", "/members?q=aubert", boardMember)).json();
      expect(byName.members.map((m: { id: string }) => m.id)).toEqual([a.id]);
      expect(byName.members[0].categoryName).toBe("Étudiant");
      const byCategory = (await call("GET", `/members?categoryId=${category.id}`, boardMember)).json();
      expect(byCategory.members).toHaveLength(1);
      const sorted = (await call("GET", "/members?limit=2", boardMember)).json();
      expect(sorted.members).toHaveLength(2);
      expect(sorted.next).not.toBeNull();
      const second = (await call("GET", `/members?limit=200&after=${sorted.next}`, boardMember)).json();
      expect(second.members.length).toBeGreaterThan(0);
    });
  });

  describe("sortie, oubli et garanties", () => {
    it("marque un membre sorti (date de sortie par défaut aujourd'hui), puis le réactive", async () => {
      const member = await newMember({ firstName: "Hugo", lastName: "Leroy", joinedOn: "2020-01-01" });
      const former = await call("PATCH", `/members/${member.id}`, treasurer, { version: 1, status: "FORMER" });
      expect(former.statusCode, former.body).toBe(200);
      expect(former.json().status).toBe("FORMER");
      expect(former.json().leftOn).toBe(new Date().toISOString().slice(0, 10));
      const back = await call("PATCH", `/members/${member.id}`, treasurer, { version: 2, status: "ACTIVE" });
      expect(back.json()).toMatchObject({ status: "ACTIVE", leftOn: null });
      // Une date de sortie avant l'entrée est refusée par la base.
      const before = await call("PATCH", `/members/${member.id}`, treasurer, { version: 3, status: "FORMER", leftOn: "2019-01-01" });
      expect(before.statusCode).toBe(409);
      expect(before.json().message).toContain("précède");
    });

    it("anonymise un membre sorti, avec un motif, de façon irréversible, et garde son identifiant", async () => {
      const member = await newMember({ firstName: "Nina", lastName: "Roux", email: "nina@asso.fr", phone: "0611111111", addressLine: "1 rue des Fleurs", note: "Allergique" });
      const early = await call("POST", `/members/${member.id}/anonymize`, treasurer, { reason: "Demande de la personne" });
      expect(early.statusCode).toBe(409);
      expect(early.json().message).toContain("sorti");

      await call("PATCH", `/members/${member.id}`, treasurer, { version: 1, status: "FORMER" });
      expect((await call("POST", `/members/${member.id}/anonymize`, treasurer, { reason: "ok" })).statusCode).toBe(400);
      const done = await call("POST", `/members/${member.id}/anonymize`, treasurer, { reason: "Demande de la personne" });
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json()).toMatchObject({ id: member.id, firstName: "Ancien", lastName: "membre", email: null, phone: null, addressLine: null, note: null, anonymized: true });
      expect((await call("POST", `/members/${member.id}/anonymize`, treasurer, { reason: "Encore une fois" })).statusCode).toBe(409);
      const edit = await call("PATCH", `/members/${member.id}`, treasurer, { version: 3, firstName: "Nina" });
      expect(edit.statusCode).toBe(409);
      expect(edit.json().message).toContain("anonymisé");
      // L'adresse email redevient disponible.
      expect((await call("POST", "/members", treasurer, { firstName: "Nina", lastName: "Nouvelle", email: "nina@asso.fr" })).statusCode).toBe(201);
      // Le motif est audité, sans les données effacées.
      const events = await prisma.auditEvent.findMany({ where: { action: "member.anonymized", objectId: member.id } });
      expect(events).toHaveLength(1);
      expect(events[0]!.justification).toBe("Demande de la personne");
      expect(JSON.stringify(events)).not.toContain("0611111111");
    });

    it("ne supprime jamais un membre, ne rend pas une anonymisation réversible et refuse le TRUNCATE", async () => {
      const member = await newMember({ firstName: "Tom", lastName: "Petit" });
      expect(await sqlError(`DELETE FROM "Member" WHERE id = '${member.id}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`TRUNCATE "Member"`)).not.toBeNull();
      await call("PATCH", `/members/${member.id}`, treasurer, { version: 1, status: "FORMER" });
      await call("POST", `/members/${member.id}/anonymize`, treasurer, { reason: "Demande de la personne" });
      expect(await sqlError(`UPDATE "Member" SET "anonymizedAt" = NULL WHERE id = '${member.id}'`)).toContain("irréversible");
      expect(await sqlError(`UPDATE "Member" SET "firstName" = 'Tom' WHERE id = '${member.id}'`)).toContain("anonymisé");
    });
  });

  describe("catégories", () => {
    it("crée, renomme et désactive une catégorie, refuse un doublon", async () => {
      const created = await call("POST", "/member-categories", treasurer, { name: "Adulte" });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json()).toMatchObject({ name: "Adulte", active: true, memberCount: 0 });
      const twice = await call("POST", "/member-categories", treasurer, { name: "Adulte" });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("déjà ce nom");
      const renamed = await call("PATCH", `/member-categories/${created.json().id}`, treasurer, { name: "Adulte (plein tarif)", active: false });
      expect(renamed.json()).toMatchObject({ name: "Adulte (plein tarif)", active: false });
      expect((await call("GET", "/member-categories", boardMember)).statusCode).toBe(200);
    });
  });

  describe("catalogue de fonctions et mandats", () => {
    const unique = () => randomUUID().slice(0, 8);
    const newRole = async (name: string) => {
      const created = await call("POST", "/office-roles", treasurer, { name });
      expect(created.statusCode, created.body).toBe(201);
      return created.json() as { id: string; name: string };
    };

    it("crée une fonction, refuse un doublon à la casse et aux accents près, la renomme et l'archive", async () => {
      const suffix = unique();
      const created = await newRole(`Présidente ${suffix}`);
      expect(created).toMatchObject({ name: `Présidente ${suffix}`, active: true, mandateCount: 0 });
      const twice = await call("POST", "/office-roles", treasurer, { name: `  PRESIDENTE   ${suffix.toUpperCase()}` });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("déjà ce nom");
      const renamed = await call("PATCH", `/office-roles/${created.id}`, treasurer, { name: `Président·e ${suffix}` });
      expect(renamed.json()).toMatchObject({ name: `Président·e ${suffix}` });
      const archived = await call("PATCH", `/office-roles/${created.id}`, treasurer, { active: false });
      expect(archived.json()).toMatchObject({ active: false });
      expect((await call("GET", "/office-roles", boardMember)).statusCode).toBe(200);
      expect((await call("POST", "/office-roles", boardMember, { name: `Interdite ${suffix}` })).statusCode).toBe(403);
      expect((await call("PATCH", `/office-roles/${randomUUID()}`, treasurer, { active: false })).statusCode).toBe(404);
    });

    it("n'attribue plus une fonction archivée mais garde lisibles les mandats passés", async () => {
      const member = await newMember({ firstName: "Louis", lastName: "Vidal" });
      const role = await newRole(`Secrétaire ${unique()}`);
      const added = await call("POST", `/members/${member.id}/offices`, treasurer, { officeRoleId: role.id, startsOn: "2019-01-01", endsOn: "2020-12-31" });
      expect(added.statusCode, added.body).toBe(201);
      await call("PATCH", `/office-roles/${role.id}`, treasurer, { active: false });
      const refused = await call("POST", `/members/${member.id}/offices`, treasurer, { officeRoleId: role.id, startsOn: "2021-01-01" });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("archivée");
      const detail = (await call("GET", `/members/${member.id}`, boardMember)).json();
      expect(detail.offices[0]).toMatchObject({ title: role.name });
      // Changer un mandat vers une fonction archivée est refusé de la même façon.
      const other = await newRole(`Vice-présidente ${unique()}`);
      const second = await call("POST", `/members/${member.id}/offices`, treasurer, { officeRoleId: other.id, startsOn: "2021-01-01" });
      expect((await call("PATCH", `/member-offices/${second.json().id}`, treasurer, { officeRoleId: role.id })).statusCode).toBe(409);
    });

    it("ajoute un mandat en cours, le montre sur la fiche, le termine, le corrige et le retire", async () => {
      const member = await newMember({ firstName: "Claire", lastName: "Morel" });
      const role = await newRole(`Trésorière ${unique()}`);
      const added = await call("POST", `/members/${member.id}/offices`, treasurer, { officeRoleId: role.id, startsOn: "2020-01-01" });
      expect(added.statusCode, added.body).toBe(201);
      expect(added.json()).toMatchObject({ officeRoleId: role.id, title: role.name, endsOn: null, current: true });
      const detail = (await call("GET", `/members/${member.id}`, boardMember)).json();
      expect(detail.member.currentOffices).toEqual([role.name]);
      expect(detail.offices).toHaveLength(1);
      expect((await call("GET", "/office-roles", boardMember)).json().find((r: { id: string }) => r.id === role.id)).toMatchObject({ mandateCount: 1 });

      const ended = await call("PATCH", `/member-offices/${added.json().id}`, treasurer, { endsOn: "2021-06-30" });
      expect(ended.json()).toMatchObject({ endsOn: "2021-06-30", current: false });
      expect((await call("GET", `/members/${member.id}`, boardMember)).json().member.currentOffices).toEqual([]);

      const invalid = await call("POST", `/members/${member.id}/offices`, treasurer, { officeRoleId: role.id, startsOn: "2022-01-01", endsOn: "2021-01-01" });
      expect(invalid.statusCode).toBe(400);
      expect((await call("POST", `/members/${member.id}/offices`, treasurer, { title: "Texte libre", startsOn: "2022-01-01" })).statusCode).toBe(400);
      expect((await call("POST", `/members/${member.id}/offices`, treasurer, { officeRoleId: randomUUID(), startsOn: "2022-01-01" })).statusCode).toBe(404);
      expect((await call("DELETE", `/member-offices/${added.json().id}`, treasurer)).statusCode).toBe(204);
      expect((await call("GET", `/members/${member.id}`, boardMember)).json().offices).toHaveLength(0);
      expect((await call("DELETE", `/member-offices/${randomUUID()}`, treasurer)).statusCode).toBe(404);
    });
  });
});
