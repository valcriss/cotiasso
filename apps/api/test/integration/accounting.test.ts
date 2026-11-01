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

describe("Comptabilité : exercices, journaux et plan de comptes (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let viewer: Session;
  let outsider: Session;

  const call = (method: "GET" | "POST" | "PATCH", url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const userWith = async (roleKey: string | null): Promise<Session> => {
    const email = `c-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "C", password: PASSWORD });
    if (roleKey) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    }
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
      return String((error as Error).message);
    }
    return null;
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
    await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD },
    });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    treasurer = await userWith("treasurer");
    viewer = await userWith("board-member");
    outsider = await userWith(null);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("refuse l'accès sans session ou sans droit, et réserve l'écriture à settings.accounting:admin", async () => {
    expect((await call("GET", "/accounts")).statusCode).toBe(401);
    expect((await call("GET", "/accounts", outsider)).statusCode).toBe(403);
    expect((await call("GET", "/accounts", viewer)).statusCode).toBe(200);
    expect((await call("POST", "/accounts", viewer, { number: "512", label: "Banque" })).statusCode).toBe(403);
    expect((await call("POST", "/fiscal-years", viewer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).statusCode).toBe(403);
    expect((await call("POST", "/journals", viewer, { code: "XX", label: "X", type: "MISC" })).statusCode).toBe(403);
  });

  it("installe les journaux de départ", async () => {
    const codes = (await call("GET", "/journals", treasurer)).json().map((j: { code: string }) => j.code);
    expect(codes).toEqual(["AC", "AN", "OD", "PR"]);
  });

  describe("exercices", () => {
    it("crée un exercice de durée libre et le relit en dates ISO", async () => {
      const response = await call("POST", "/fiscal-years", treasurer, { label: "Premier exercice", start: "2025-09-01", end: "2026-12-31" });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ label: "Premier exercice", start: "2025-09-01", end: "2026-12-31", status: "OPEN" });
      expect((await call("GET", "/fiscal-years", viewer)).json()).toHaveLength(1);
    });

    it("refuse les dates invalides ou inversées", async () => {
      for (const body of [
        { label: "X", start: "2027-02-30", end: "2027-12-31" },
        { label: "X", start: "2027-12-31", end: "2027-01-01" },
        { label: "X", start: "demain", end: "2027-12-31" },
        { label: " ", start: "2027-01-01", end: "2027-12-31" },
        { label: "X", start: "2027-01-01", end: "2027-12-31", status: "CLOSED" },
      ]) {
        expect((await call("POST", "/fiscal-years", treasurer, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it("refuse un chevauchement, bornes incluses, avec un message lisible", async () => {
      const overlap = await call("POST", "/fiscal-years", treasurer, { label: "Chevauche", start: "2026-12-31", end: "2027-06-30" });
      expect(overlap.statusCode).toBe(409);
      expect(overlap.json().message).toContain("Premier exercice");
      expect((await call("POST", "/fiscal-years", treasurer, { label: "2027", start: "2027-01-01", end: "2027-12-31" })).statusCode).toBe(201);
    });

    it("la base refuse elle-même un chevauchement, même hors du service", async () => {
      const error = await sqlError(
        `INSERT INTO "FiscalYear" ("id","label","start","end") VALUES (gen_random_uuid(),'Direct','2027-06-01','2028-06-01')`,
      );
      expect(error).toContain("FiscalYear_no_overlap");
    });

    it("modifie un exercice ouvert sans le faire chevaucher son voisin", async () => {
      const [first, second] = (await call("GET", "/fiscal-years", treasurer)).json();
      expect((await call("PATCH", `/fiscal-years/${first.id}`, treasurer, { end: "2027-03-01" })).statusCode).toBe(409);
      const renamed = await call("PATCH", `/fiscal-years/${second.id}`, treasurer, { label: "Exercice 2027" });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().label).toBe("Exercice 2027");
      expect((await call("PATCH", `/fiscal-years/${randomUUID()}`, treasurer, { label: "?" })).statusCode).toBe(404);
      expect((await call("PATCH", "/fiscal-years/pas-un-uuid", treasurer, { label: "?" })).statusCode).toBe(400);
    });

    it("garde la progression du statut : fermeture annulable, clôture seulement dans l'ordre et avec le report des soldes", async () => {
      const [, second] = (await call("GET", "/fiscal-years", treasurer)).json();
      expect(await sqlError(`UPDATE "FiscalYear" SET "status"='CLOSED' WHERE id='${second.id}'`)).toContain("en cours de clôture");
      expect(await sqlError(`UPDATE "FiscalYear" SET "status"='CLOSING' WHERE id='${second.id}'`)).toBeNull();
      expect(await sqlError(`UPDATE "FiscalYear" SET "end"='2027-11-30' WHERE id='${second.id}'`)).toContain("dates");
      expect((await call("PATCH", `/fiscal-years/${second.id}`, treasurer, { label: "Trop tard" })).statusCode).toBe(409);
      // Une fermeture à la saisie s'annule ; la clôture définitive exige les à-nouveaux de l'exercice suivant.
      expect(await sqlError(`UPDATE "FiscalYear" SET "status"='CLOSED' WHERE id='${second.id}'`)).toContain("précédent");
      expect(await sqlError(`UPDATE "FiscalYear" SET "status"='OPEN' WHERE id='${second.id}'`)).toBeNull();
    });

    it("ne supprime jamais un exercice", async () => {
      expect(await sqlError(`DELETE FROM "FiscalYear"`)).toContain("ne se supprime pas");
    });
  });

  describe("journaux", () => {
    it("crée un journal et refuse un code déjà pris ou mal formé", async () => {
      expect((await call("POST", "/journals", treasurer, { code: "BQ-1", label: "Banque principale", type: "BANK" })).statusCode).toBe(201);
      expect((await call("POST", "/journals", treasurer, { code: "BQ-1", label: "Doublon", type: "BANK" })).statusCode).toBe(409);
      expect((await call("POST", "/journals", treasurer, { code: "bq 2", label: "Mal formé", type: "BANK" })).statusCode).toBe(400);
      expect((await call("POST", "/journals", treasurer, { code: "ZZ", label: "Inconnu", type: "AUTRE" })).statusCode).toBe(400);
    });

    it("désactive un journal mais ne change ni son code ni son type, et ne le supprime pas", async () => {
      const journal = (await call("GET", "/journals", treasurer)).json().find((j: { code: string }) => j.code === "BQ-1");
      const off = await call("PATCH", `/journals/${journal.id}`, treasurer, { active: false });
      expect(off.json().active).toBe(false);
      expect((await call("PATCH", `/journals/${journal.id}`, treasurer, { code: "BQ-9" })).statusCode).toBe(400);
      expect(await sqlError(`UPDATE "Journal" SET "code"='BQ-9' WHERE id='${journal.id}'`)).toContain("ne changent pas");
      expect(await sqlError(`UPDATE "Journal" SET "type"='CASH' WHERE id='${journal.id}'`)).toContain("ne changent pas");
      expect(await sqlError(`DELETE FROM "Journal"`)).toContain("on le désactive");
    });
  });

  describe("plan de comptes", () => {
    it("crée, désactive et classe un compte ; le numéro est définitif", async () => {
      const created = await call("POST", "/accounts", treasurer, { number: "512", label: "Banque", reportLine: "Trésorerie" });
      expect(created.statusCode).toBe(201);
      expect((await call("POST", "/accounts", treasurer, { number: "512", label: "Doublon" })).statusCode).toBe(409);
      const id = created.json().id;
      const patched = await call("PATCH", `/accounts/${id}`, treasurer, { active: false, reportLine: null });
      expect(patched.json()).toMatchObject({ active: false, reportLine: null });
      expect((await call("PATCH", `/accounts/${id}`, treasurer, { number: "513" })).statusCode).toBe(400);
      expect(await sqlError(`UPDATE "Account" SET "number"='513' WHERE id='${id}'`)).toContain("ne change pas");
      expect(await sqlError(`DELETE FROM "Account"`)).toContain("on le désactive");
    });

    it("refuse un numéro hors format, côté API comme côté base", async () => {
      for (const number of ["12", "012", "9999", "51A", "123456789", " 512"]) {
        expect((await call("POST", "/accounts", treasurer, { number, label: "Mal formé" })).statusCode, number).toBe(400);
      }
      expect(await sqlError(`INSERT INTO "Account" ("id","number","label") VALUES (gen_random_uuid(),'12','X')`)).toContain("Account_number_format");
    });

    it("importe un plan, sans écraser l'existant, et reste idempotent", async () => {
      const accounts = [
        { number: "512", label: "Ne doit pas écraser" },
        { number: "530", label: "Caisse" },
        { number: "706", label: "Prestations de services" },
      ];
      expect((await call("POST", "/accounts/import", treasurer, { accounts })).json()).toEqual({ created: 2, skipped: 1 });
      expect((await call("POST", "/accounts/import", treasurer, { accounts })).json()).toEqual({ created: 0, skipped: 3 });
      const listed = (await call("GET", "/accounts", viewer)).json();
      expect(listed.find((a: { number: string }) => a.number === "512").label).toBe("Banque");
    });

    it("importe tout ou rien : un doublon ou une ligne invalide n'écrit rien", async () => {
      const before = await prisma.account.count();
      expect((await call("POST", "/accounts/import", treasurer, { accounts: [{ number: "601", label: "A" }, { number: "601", label: "B" }] })).statusCode).toBe(409);
      expect((await call("POST", "/accounts/import", treasurer, { accounts: [{ number: "602", label: "A" }, { number: "x", label: "B" }] })).statusCode).toBe(400);
      expect((await call("POST", "/accounts/import", treasurer, { accounts: [] })).statusCode).toBe(400);
      expect(await prisma.account.count()).toBe(before);
    });
  });

  it("trace les modifications dans l'audit sans contenu inutile", async () => {
    const actions = (await prisma.auditEvent.findMany({ where: { action: { startsWith: "fiscal-year." } } })).map((e) => e.action);
    expect(actions).toContain("fiscal-year.created");
    expect(actions).toContain("fiscal-year.updated");
    const imported = await prisma.auditEvent.findFirstOrThrow({ where: { action: "account.imported" } });
    expect(imported.details).toEqual({ created: 2, skipped: 1 });
    expect((await call("GET", "/audit/verify", treasurer)).statusCode).toBeLessThan(500);
  });
});
