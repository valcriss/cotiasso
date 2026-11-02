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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

describe("Financeurs et subventions (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let reader: Session;
  let boardMember: Session;
  let manager: Session;
  const ids: Record<string, string> = {};

  const call = (method: Method, url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `p-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "P", password: PASSWORD });
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
      return String((error as Error).message);
    }
    return null;
  };

  const newFunder = async (name: string, type = "LOCAL_AUTHORITY") => {
    const response = await call("POST", "/funders", treasurer, { name, type });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  };
  const newProject = async (code: string) => (await call("POST", "/projects", treasurer, { code, name: code })).json().id as string;
  const newGrant = async (over: Record<string, unknown> = {}) => {
    const response = await call("POST", "/grants", treasurer, {
      funderId: ids.region,
      title: "Aide au festival",
      requestedAmount: "1000.00",
      requestedOn: "2026-02-01",
      allocations: [
        { projectId: ids.a, amount: "600.00" },
        { projectId: ids.b, amount: "400.00" },
      ],
      ...over,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
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
    reader = await userWith("reader");
    boardMember = await userWith("board-member");
    ids.a = await newProject("ATELIERS");
    ids.b = await newProject("FESTIVAL");
    ids.c = await newProject("EXPOS");
    ids.region = await newFunder("Région");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("financeurs", () => {
    it("réserve la lecture à grants:view et l'écriture à grants:manage", async () => {
      expect((await call("GET", "/funders")).statusCode).toBe(401);
      expect((await call("GET", "/funders", reader)).statusCode).toBe(403);
      expect((await call("GET", "/funders", boardMember)).statusCode).toBe(200);
      expect((await call("POST", "/funders", boardMember, { name: "X", type: "STATE" })).statusCode).toBe(403);
      const list = (await call("GET", "/funders", treasurer)).json();
      expect(list).toEqual([expect.objectContaining({ name: "Région", type: "LOCAL_AUTHORITY", archived: false, grantCount: 0 })]);
    });

    it("refuse un nom vide, un type inconnu, un email mal formé et un nom déjà pris (casse ignorée)", async () => {
      const post = (body: object) => call("POST", "/funders", treasurer, { name: "Fondation", type: "FOUNDATION", ...body });
      expect((await post({ name: " " })).statusCode).toBe(400);
      expect((await post({ type: "AUTRE" })).statusCode).toBe(400);
      expect((await post({ email: "pas-un-email" })).statusCode).toBe(400);
      expect((await post({})).statusCode).toBe(201);
      const duplicate = await post({ name: "  RÉGION " });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().message).toContain("porte déjà ce nom");
      expect((await post({ name: "région" })).statusCode).toBe(409);
    });

    it("modifie un financeur, l'archive une fois, et ne le réactive ni ne le supprime", async () => {
      ids.mairie = await newFunder("Mairie", "LOCAL_AUTHORITY");
      const edited = await call("PATCH", `/funders/${ids.mairie}`, treasurer, { contactName: "Mme Durand", email: "culture@mairie.test" });
      expect(edited.json()).toMatchObject({ contactName: "Mme Durand", email: "culture@mairie.test" });
      const archived = await call("POST", `/funders/${ids.mairie}/archive`, treasurer, {});
      expect(archived.json().archived).toBe(true);
      expect((await call("POST", `/funders/${ids.mairie}/archive`, treasurer, {})).statusCode).toBe(409);
      expect(await sqlError(`UPDATE "Funder" SET "archivedAt" = NULL WHERE "id" = '${ids.mairie}'`)).toContain("ne se réactive pas");
      expect(await sqlError(`DELETE FROM "Funder" WHERE "id" = '${ids.mairie}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`TRUNCATE "Funder" CASCADE`)).toBeTruthy();
    });
  });

  describe("cycle de vie d'une subvention", () => {
    it("crée une demande répartie entre des projets, réservée à grants:manage", async () => {
      expect((await call("POST", "/grants", boardMember, { funderId: ids.region, title: "X", requestedAmount: "10" })).statusCode).toBe(403);
      const grant = await newGrant({ reference: "RF-2026-14", periodStart: "2026-06-01", periodEnd: "2026-12-31", conditions: "Bilan avant le 31/03/2027" });
      ids.g1 = grant.id;
      expect(grant).toMatchObject({
        status: "REQUESTED",
        funder: { name: "Région" },
        requestedAmount: "1000.00",
        grantedAmount: null,
        reference: "RF-2026-14",
        allocatedTotal: "1000.00",
      });
      expect(grant.allocations.map((a: { projectCode: string; amount: string }) => [a.projectCode, a.amount])).toEqual([["ATELIERS", "600.00"], ["FESTIVAL", "400.00"]]);
    });

    it("refuse les demandes invalides avec un message clair", async () => {
      const post = (over: object) => call("POST", "/grants", treasurer, { funderId: ids.region, title: "T", requestedAmount: "50", ...over });
      expect((await post({ requestedAmount: "0" })).statusCode).toBe(400);
      expect((await post({ requestedAmount: "12,5" })).statusCode).toBe(400);
      expect((await post({ title: " " })).statusCode).toBe(400);
      expect((await post({ periodStart: "2026-07-01", periodEnd: "2026-06-01" })).statusCode).toBe(400);
      expect((await post({ allocations: [{ projectId: ids.a, amount: "10" }, { projectId: ids.a, amount: "5" }] })).statusCode).toBe(400);
      expect((await post({ allocations: [{ projectId: randomUUID(), amount: "10" }] })).statusCode).toBe(409);
      expect((await post({ funderId: randomUUID() })).statusCode).toBe(409);
      const archived = await post({ funderId: ids.mairie });
      expect(archived.statusCode).toBe(409);
      expect(archived.json().message).toContain("archivé");
      const sameReference = await post({ reference: "rf-2026-14" });
      expect(sameReference.statusCode).toBe(409);
      expect(sameReference.json().message).toContain("déjà une subvention avec cette référence");
      // La même référence chez un autre financeur est permise.
      const other = await newFunder("Département");
      expect((await post({ funderId: other, reference: "RF-2026-14" })).statusCode).toBe(201);
    });

    it("modifie la demande, la passe en instruction une seule fois, et change librement la répartition", async () => {
      const edited = await call("PATCH", `/grants/${ids.g1}`, treasurer, { requestedAmount: "1200.00", note: "Dossier déposé" });
      expect(edited.json()).toMatchObject({ requestedAmount: "1200.00", note: "Dossier déposé" });
      expect((await call("POST", `/grants/${ids.g1}/review`, treasurer, {})).json().status).toBe("UNDER_REVIEW");
      expect((await call("POST", `/grants/${ids.g1}/review`, treasurer, {})).statusCode).toBe(409);
      const regrouped = await call("PUT", `/grants/${ids.g1}/allocations`, treasurer, { allocations: [{ projectId: ids.a, amount: "700.00" }, { projectId: ids.b, amount: "500.00" }] });
      expect(regrouped.json().allocatedTotal).toBe("1200.00");
      expect((await call("PUT", `/grants/${ids.g1}/allocations`, treasurer, { allocations: [{ projectId: ids.a, amount: "1" }, { projectId: ids.a, amount: "2" }] })).statusCode).toBe(400);
    });

    it("exige, à l'accord, des parts dont la somme égale exactement le montant accordé", async () => {
      const mismatch = await call("POST", `/grants/${ids.g1}/grant`, treasurer, { grantedAmount: "900.00", decidedOn: "2026-03-15" });
      expect(mismatch.statusCode).toBe(409);
      expect(mismatch.json().message).toContain("1200.00 €");
      expect(mismatch.json().message).toContain("900.00 €");
      expect((await call("GET", `/grants/${ids.g1}`, treasurer)).json().status).toBe("UNDER_REVIEW");

      const empty = await newGrant({ allocations: [], title: "Sans projet" });
      const none = await call("POST", `/grants/${empty.id}/grant`, treasurer, { grantedAmount: "100.00", decidedOn: "2026-03-15" });
      expect(none.statusCode).toBe(409);
      expect(none.json().message).toContain("quels projets");

      expect((await call("POST", `/grants/${ids.g1}/grant`, treasurer, { grantedAmount: "900.00", decidedOn: "2026-01-15" })).json().message).toContain("précède");
    });

    it("enregistre l'accord en corrigeant la répartition au passage", async () => {
      const granted = await call("POST", `/grants/${ids.g1}/grant`, treasurer, {
        grantedAmount: "900.00",
        decidedOn: "2026-03-15",
        allocations: [{ projectId: ids.a, amount: "500.00" }, { projectId: ids.b, amount: "400.00" }],
      });
      expect(granted.statusCode, granted.body).toBe(200);
      expect(granted.json()).toMatchObject({ status: "GRANTED", grantedAmount: "900.00", decidedOn: "2026-03-15", allocatedTotal: "900.00" });
      expect((await call("POST", `/grants/${ids.g1}/grant`, treasurer, { grantedAmount: "900.00", decidedOn: "2026-03-16" })).statusCode).toBe(409);
    });

    it("fige l'accord : montant, dates, financeur et répartition ne changent plus, en API comme en base", async () => {
      const amountChange = await call("PATCH", `/grants/${ids.g1}`, treasurer, { requestedAmount: "5000.00" });
      expect(amountChange.statusCode).toBe(409);
      expect(amountChange.json().message).toContain("avenants ne sont pas encore pris en charge");
      expect((await call("PATCH", `/grants/${ids.g1}`, treasurer, { funderId: ids.region })).statusCode).toBe(409);
      expect((await call("PUT", `/grants/${ids.g1}/allocations`, treasurer, { allocations: [{ projectId: ids.c, amount: "900.00" }] })).statusCode).toBe(409);
      const complete = await call("PATCH", `/grants/${ids.g1}`, treasurer, { title: "Aide au festival 2026", conditions: "Bilan avant le 31/03/2027", note: "Convention signée" });
      expect(complete.json()).toMatchObject({ title: "Aide au festival 2026", note: "Convention signée" });
      expect((await call("POST", `/grants/${ids.g1}/cancel`, treasurer, { reason: "Test" })).json().message).toContain("on la clôture");
      expect((await call("POST", `/grants/${ids.g1}/refuse`, treasurer, { decidedOn: "2026-04-01", reason: "Test" })).statusCode).toBe(409);

      expect(await sqlError(`UPDATE "Grant" SET "grantedAmount" = 1 WHERE "id" = '${ids.g1}'`)).toContain("ne change plus");
      expect(await sqlError(`UPDATE "Grant" SET "decidedOn" = '2026-01-01' WHERE "id" = '${ids.g1}'`)).toContain("ne change plus");
      expect(await sqlError(`UPDATE "GrantProjectAllocation" SET "amount" = 1 WHERE "grantId" = '${ids.g1}'`)).toContain("répartition");
      expect(await sqlError(`DELETE FROM "GrantProjectAllocation" WHERE "grantId" = '${ids.g1}'`)).toContain("répartition");
      expect(await sqlError(`INSERT INTO "GrantProjectAllocation" ("id","grantId","projectId","amount") VALUES (gen_random_uuid(),'${ids.g1}','${ids.c}',1)`)).toContain("répartition");
      expect(await sqlError(`UPDATE "Grant" SET "status" = 'UNDER_REVIEW', "grantedAmount" = NULL, "decidedOn" = NULL WHERE "id" = '${ids.g1}'`)).toContain("ne peut pas passer");
    });

    it("refuse, en base, un accord dont les parts ne totalisent pas le montant accordé", async () => {
      const grant = await newGrant({ title: "Contrôle SQL" });
      expect(await sqlError(`UPDATE "Grant" SET "status" = 'GRANTED', "grantedAmount" = 999, "decidedOn" = '2026-03-01' WHERE "id" = '${grant.id}'`)).toContain("somme des parts");
      ids.sql = grant.id;
    });

    it("clôture une subvention accordée en choisissant le sort du reliquat, sans écriture comptable", async () => {
      expect((await call("POST", `/grants/${ids.g1}/close`, treasurer, { closedOn: "2027-04-01", residual: "REFUND" })).statusCode).toBe(400);
      expect((await call("POST", `/grants/${ids.g1}/close`, treasurer, { closedOn: "2027-04-01", residual: "AUTRE" })).statusCode).toBe(400);
      const early = await call("POST", `/grants/${ids.g1}/close`, treasurer, { closedOn: "2026-01-01", residual: "NONE" });
      expect(early.statusCode).toBe(409);
      expect((await call("POST", `/grants/${ids.sql}/close`, treasurer, { closedOn: "2027-04-01", residual: "NONE" })).json().message).toContain("accordée");

      const entriesBefore = await prisma.journalEntry.count();
      const closed = await call("POST", `/grants/${ids.g1}/close`, treasurer, { closedOn: "2027-04-01", residual: "REFUND", note: "150 € à rembourser avant le 30/06/2027" });
      expect(closed.statusCode, closed.body).toBe(200);
      expect(closed.json()).toMatchObject({ status: "CLOSED", closedOn: "2027-04-01", residual: "REFUND", residualNote: "150 € à rembourser avant le 30/06/2027" });
      expect(await prisma.journalEntry.count()).toBe(entriesBefore);
    });

    it("ne laisse plus qu'une note à compléter sur une subvention terminée", async () => {
      expect((await call("PATCH", `/grants/${ids.g1}`, treasurer, { note: "Remboursé le 12/06" })).json().note).toBe("Remboursé le 12/06");
      expect((await call("PATCH", `/grants/${ids.g1}`, treasurer, { title: "Autre" })).statusCode).toBe(409);
      expect((await call("POST", `/grants/${ids.g1}/close`, treasurer, { closedOn: "2027-05-01", residual: "NONE" })).statusCode).toBe(409);
      expect(await sqlError(`UPDATE "Grant" SET "residual" = 'NONE' WHERE "id" = '${ids.g1}'`)).toContain("ne change plus");
      expect(await sqlError(`UPDATE "Grant" SET "status" = 'GRANTED' WHERE "id" = '${ids.g1}'`)).toContain("ne change plus");
    });

    it("refuse une demande avec un motif, et annule une demande abandonnée avec un motif", async () => {
      const refused = await newGrant({ title: "À refuser" });
      expect((await call("POST", `/grants/${refused.id}/refuse`, treasurer, { decidedOn: "2026-04-01" })).statusCode).toBe(400);
      const done = await call("POST", `/grants/${refused.id}/refuse`, treasurer, { decidedOn: "2026-04-01", reason: "Enveloppe épuisée" });
      expect(done.json()).toMatchObject({ status: "REFUSED", reason: "Enveloppe épuisée", grantedAmount: null });
      expect((await call("PATCH", `/grants/${refused.id}`, treasurer, { title: "X" })).statusCode).toBe(409);
      expect((await call("POST", `/grants/${refused.id}/cancel`, treasurer, { reason: "Encore" })).statusCode).toBe(409);

      const cancelled = await newGrant({ title: "À annuler" });
      expect((await call("POST", `/grants/${cancelled.id}/cancel`, treasurer, {})).statusCode).toBe(400);
      const gone = await call("POST", `/grants/${cancelled.id}/cancel`, treasurer, { reason: "Projet abandonné" });
      expect(gone.json()).toMatchObject({ status: "CANCELLED", reason: "Projet abandonné" });
    });

    it("ne supprime jamais une subvention", async () => {
      expect(await sqlError(`DELETE FROM "Grant" WHERE "id" = '${ids.g1}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`TRUNCATE "Grant" CASCADE`)).toBeTruthy();
      expect(await sqlError(`TRUNCATE "GrantProjectAllocation"`)).toBeTruthy();
    });
  });

  describe("visibilité et portée projet", () => {
    let scoped: Session;

    beforeAll(async () => {
      const email = `scoped-${randomUUID()}@test.invalid`;
      const user = await users.createUser({ email, displayName: "S", password: PASSWORD });
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "project-manager" } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id, projectId: ids.c! } });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: "198.51.100.61" });
      scoped = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
      // Une subvention financée à la fois sur EXPOS (la portée) et sur ATELIERS, une autre sans lien avec EXPOS.
      ids.shared = (await newGrant({ title: "Partagée", allocations: [{ projectId: ids.c, amount: "300.00" }, { projectId: ids.a, amount: "700.00" }] })).id;
    });

    it("liste et filtre les subventions pour un droit global", async () => {
      const all = (await call("GET", "/grants", treasurer)).json();
      expect(all.length).toBeGreaterThanOrEqual(6);
      expect((await call("GET", "/grants?status=CLOSED", treasurer)).json().map((g: { id: string }) => g.id)).toEqual([ids.g1]);
      const byFunder = (await call("GET", `/grants?funderId=${ids.region}`, treasurer)).json();
      expect(byFunder.every((g: { funder: { id: string } }) => g.funder.id === ids.region)).toBe(true);
      const byProject = (await call("GET", `/grants?projectId=${ids.c}`, treasurer)).json();
      expect(byProject.map((g: { id: string }) => g.id)).toEqual([ids.shared]);
      expect((await call("GET", "/grants?status=BIDON", treasurer)).statusCode).toBe(400);
      expect((await call("GET", "/grants", reader)).statusCode).toBe(403);
      expect((await call("GET", "/grants", boardMember)).statusCode).toBe(200);
    });

    it("ne montre à un responsable de projet que les subventions de sa portée, en lecture, entières", async () => {
      const visible = (await call("GET", "/grants", scoped)).json();
      expect(visible.map((g: { id: string }) => g.id)).toEqual([ids.shared]);
      // Il voit la subvention entière : montant total et autres projets financés compris.
      expect(visible[0]).toMatchObject({ requestedAmount: "1000.00", allocatedTotal: "1000.00" });
      expect(visible[0].allocations.map((a: { projectCode: string }) => a.projectCode)).toEqual(["ATELIERS", "EXPOS"]);
      expect((await call("GET", `/grants/${ids.shared}`, scoped)).statusCode).toBe(200);
      expect((await call("GET", `/grants/${ids.g1}`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.c}/grants`, scoped)).json().map((g: { id: string }) => g.id)).toEqual([ids.shared]);
      expect((await call("GET", `/projects/${ids.a}/grants`, scoped)).statusCode).toBe(404);
      // Filtrer sur un projet hors portée ne montre que ce qu'il peut déjà voir : la subvention partagée, entière.
      expect((await call("GET", `/grants?projectId=${ids.a}`, scoped)).json().map((g: { id: string }) => g.id)).toEqual([ids.shared]);
      expect((await call("GET", `/grants?projectId=${ids.b}`, scoped)).json()).toEqual([]);
    });

    it("ne lui laisse ni écrire, ni lister les financeurs (droit global)", async () => {
      expect((await call("POST", "/grants", scoped, { funderId: ids.region, title: "X", requestedAmount: "10" })).statusCode).toBe(403);
      expect((await call("PATCH", `/grants/${ids.shared}`, scoped, { note: "x" })).statusCode).toBe(403);
      expect((await call("POST", `/grants/${ids.shared}/review`, scoped, {})).statusCode).toBe(403);
      expect((await call("GET", "/funders", scoped)).statusCode).toBe(403);
      expect((await call("GET", `/projects/${ids.c}/grants`, reader)).statusCode).toBe(403);
    });
  });

  describe("audit", () => {
    it("trace les financeurs et les subventions sans recopier de montant", async () => {
      const events = await prisma.auditEvent.findMany({ where: { OR: [{ action: { startsWith: "grant." } }, { action: { startsWith: "funder." } }] } });
      const actions = new Set(events.map((e) => e.action));
      for (const action of ["funder.created", "funder.updated", "funder.archived", "grant.created", "grant.updated", "grant.allocations-set", "grant.reviewed", "grant.granted", "grant.refused", "grant.cancelled", "grant.closed"]) {
        expect(actions.has(action), action).toBe(true);
      }
      const serialized = JSON.stringify(events.map((e) => e.details));
      for (const amount of ["1200.00", "900.00", "500.00"]) expect(serialized).not.toContain(amount);
      expect(events.find((e) => e.action === "grant.refused")?.justification).toBe("Enveloppe épuisée");
      expect(events.find((e) => e.action === "grant.closed")?.details).toMatchObject({ residual: "REFUND" });
    });
  });
});
