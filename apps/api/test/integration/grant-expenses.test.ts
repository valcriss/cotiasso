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

describe("Dépenses affectées aux subventions et compte rendu (base vierge)", () => {
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

  const newProject = async (code: string) => (await call("POST", "/projects", treasurer, { code, name: code })).json().id as string;
  /** Subvention accordée sur les projets donnés (parts égales au montant accordé). */
  const grantedGrant = async (title: string, parts: { projectId: string; amount: string }[], extra: Record<string, unknown> = {}) => {
    const total = parts.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2);
    const created = await call("POST", "/grants", treasurer, { funderId: ids.region, title, requestedAmount: total, allocations: parts, ...extra });
    expect(created.statusCode, created.body).toBe(201);
    const decided = await call("POST", `/grants/${created.json().id}/grant`, treasurer, { grantedAmount: total, decidedOn: "2026-03-15" });
    expect(decided.statusCode, decided.body).toBe(200);
    return decided.json().id as string;
  };
  /** Écriture D charge / C banque, ventilée comme demandé ; comptabilisée sauf si `draft`. */
  const spend = async (account: string, amount: string, allocations: { projectId: string; amount: string }[], date = "2026-03-01", draft = false) => {
    const entry = await call("POST", "/entries", treasurer, {
      journalId: ids.OD,
      date,
      label: "Facture traiteur",
      lines: [
        { accountId: account, debit: amount, allocations },
        { accountId: ids.bank, credit: amount },
      ],
    });
    expect(entry.statusCode, entry.body).toBe(201);
    if (!draft) expect((await call("POST", `/entries/${entry.json().id}/post`, treasurer, {})).statusCode).toBe(200);
    return entry.json().id as string;
  };
  /** Identifiant de la part de dépense d'un projet dans une écriture. */
  const part = async (entryId: string, projectId: string) =>
    (await prisma.analyticalAllocation.findFirstOrThrow({ where: { projectId, line: { entryId } } })).id;
  const attach = (grantId: string, body: object, session: Session = treasurer) => call("POST", `/grants/${grantId}/expenses`, session, body);
  const expenses = async (grantId: string, session: Session = treasurer) => (await call("GET", `/grants/${grantId}/expenses`, session)).json();
  const candidates = async (grantId: string) => (await call("GET", `/grants/${grantId}/expense-candidates`, treasurer)).json();

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

    for (const journal of await prisma.journal.findMany()) ids[journal.code] = journal.id;
    for (const [key, number, label] of [
      ["bank", "512", "Banque"],
      ["achats", "606", "Achats"],
      ["fournitures", "607", "Fournitures"],
      ["ventes", "706", "Prestations"],
      ["formule", "608", "=SOMME(A1)"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" });
    await call("POST", "/fiscal-years", treasurer, { label: "2027", start: "2027-01-01", end: "2027-12-31" });
    ids.a = await newProject("ATELIERS");
    ids.b = await newProject("FESTIVAL");
    ids.c = await newProject("EXPOS");
    ids.region = (await call("POST", "/funders", treasurer, { name: "Région", type: "LOCAL_AUTHORITY" })).json().id;
    ids.fa = (await call("POST", "/financial-accounts", treasurer, { name: "Banque", type: "BANK", accountId: ids.bank, openedOn: "2025-01-01", openingBalance: "0.00" })).json().id;

    // Les dépenses : e1 (606, 300 €, ATELIERS), e2 (607, 200 € partagés ATELIERS 120 / EXPOS 80), e3 (606, 100 €, FESTIVAL, 2027),
    // une recette (706), un brouillon (606, 50 €).
    ids.e1 = await spend(ids.achats!, "300.00", [{ projectId: ids.a!, amount: "300.00" }]);
    ids.e2 = await spend(ids.fournitures!, "200.00", [{ projectId: ids.a!, amount: "120.00" }, { projectId: ids.c!, amount: "80.00" }], "2026-04-01");
    ids.e3 = await spend(ids.achats!, "100.00", [{ projectId: ids.b!, amount: "100.00" }], "2027-02-01");
    ids.e4 = await spend(ids.formule!, "40.00", [{ projectId: ids.a!, amount: "40.00" }], "2026-05-01");
    ids.draft = await spend(ids.achats!, "50.00", [{ projectId: ids.a!, amount: "50.00" }], "2026-06-01", true);
    const product = await call("POST", "/entries", treasurer, {
      journalId: ids.OD,
      date: "2026-05-05",
      label: "Recette",
      lines: [
        { accountId: ids.bank, debit: "500.00" },
        { accountId: ids.ventes, credit: "500.00", allocations: [{ projectId: ids.a, amount: "500.00" }] },
      ],
    });
    await call("POST", `/entries/${product.json().id}/post`, treasurer, {});
    ids.product = product.json().id;
    ids.g = await grantedGrant("Aide aux ateliers et au festival", [{ projectId: ids.a!, amount: "500.00" }, { projectId: ids.b!, amount: "400.00" }], {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    ids.h = await grantedGrant("Aide aux expositions", [{ projectId: ids.c!, amount: "300.00" }]);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("choix de la dépense", () => {
    it("réserve la lecture à grants:view, l'écriture à grants:manage et la liste des dépenses à entries:view", async () => {
      expect((await call("GET", `/grants/${ids.g}/expenses`)).statusCode).toBe(401);
      expect((await call("GET", `/grants/${ids.g}/expenses`, reader)).statusCode).toBe(403);
      expect((await call("GET", `/grants/${ids.g}/expenses`, boardMember)).statusCode).toBe(200);
      expect((await attach(ids.g!, { allocationId: randomUUID(), amount: "1" }, boardMember)).statusCode).toBe(403);
      expect((await call("GET", `/grants/${ids.g}/expense-candidates`, boardMember)).statusCode).toBe(403);
      expect((await call("GET", `/grants/${ids.g}/expense-candidates`, treasurer)).statusCode).toBe(200);
      expect((await call("GET", `/grants/${randomUUID()}/expenses`, treasurer)).statusCode).toBe(404);
    });

    it("ne propose que les charges comptabilisées des projets financés, avec la part encore libre", async () => {
      const list = await candidates(ids.g!);
      const found = list.map((c: { allocationId: string }) => c.allocationId);
      expect(found).toContain(await part(ids.e1!, ids.a!));
      expect(found).toContain(await part(ids.e2!, ids.a!));
      expect(found).toContain(await part(ids.e3!, ids.b!));
      // Jamais : la part d'un projet que la subvention ne finance pas, une recette, un brouillon.
      expect(found).not.toContain(await part(ids.e2!, ids.c!));
      expect(found).not.toContain(await part(ids.product!, ids.a!));
      expect(found).not.toContain(await part(ids.draft!, ids.a!));
      const first = list.find((c: { entry: { id: string } }) => c.entry.id === ids.e1);
      expect(first).toMatchObject({ amount: "300.00", remaining: "300.00", account: { number: "606" }, project: { code: "ATELIERS" }, outOfPeriod: false });
      expect(list.find((c: { entry: { id: string } }) => c.entry.id === ids.e3).outOfPeriod).toBe(true);
    });
  });

  describe("affectation", () => {
    it("affecte une part d'une dépense : le total affecté monte, la part libre baisse", async () => {
      const done = await attach(ids.g!, { allocationId: await part(ids.e1!, ids.a!), amount: "250.00" });
      expect(done.statusCode, done.body).toBe(201);
      expect(done.json()).toMatchObject({ granted: "900.00", spent: "250.00", overGranted: false, warnings: [] });
      expect(done.json().expenses[0]).toMatchObject({ amount: "250.00", counted: true, reversed: false, outOfPeriod: false, account: { number: "606" }, project: { code: "ATELIERS" } });
      ids.fund1 = done.json().expenses[0].id;
      const left = (await candidates(ids.g!)).find((c: { entry: { id: string } }) => c.entry.id === ids.e1);
      expect(left.remaining).toBe("50.00");
    });

    it("ne laisse jamais affecter plus que le montant de la dépense, toutes subventions confondues", async () => {
      const tooMuch = await attach(ids.g!, { allocationId: await part(ids.e1!, ids.a!), amount: "60.00" });
      expect(tooMuch.statusCode).toBe(409);
      expect(tooMuch.json().message).toContain("Il ne reste que 50.00 €");
      expect(await sqlError(`INSERT INTO "FundingExpenseAllocation" ("id","grantId","allocationId","amount") VALUES (gen_random_uuid(),'${ids.g}','${await part(ids.e1!, ids.a!)}',60)`)).toContain("dépassent le montant de la dépense");

      // Une seconde subvention finance aussi ATELIERS : elle partage le même plafond.
      ids.g2 = await grantedGrant("Autre aide aux ateliers", [{ projectId: ids.a!, amount: "200.00" }]);
      expect((await attach(ids.g2!, { allocationId: await part(ids.e1!, ids.a!), amount: "50.00" })).statusCode).toBe(201);
      const full = await attach(ids.g2!, { allocationId: await part(ids.e1!, ids.a!), amount: "1.00" });
      expect(full.statusCode).toBe(409);
      expect(full.json().message).toContain("Il ne reste que 0.00 €");
      expect((await candidates(ids.g!)).map((c: { entry: { id: string } }) => c.entry.id)).not.toContain(ids.e1);
    });

    it("refuse une dépense d'un projet non financé, une recette, un brouillon et une dépense inconnue", async () => {
      const otherProject = await attach(ids.g!, { allocationId: await part(ids.e2!, ids.c!), amount: "10.00" });
      expect(otherProject.statusCode).toBe(409);
      expect(otherProject.json().message).toContain("projet que la subvention ne finance pas");
      const income = await attach(ids.g!, { allocationId: await part(ids.product!, ids.a!), amount: "10.00" });
      expect(income.statusCode).toBe(409);
      expect(income.json().message).toContain("une charge");
      const notPosted = await attach(ids.g!, { allocationId: await part(ids.draft!, ids.a!), amount: "10.00" });
      expect(notPosted.statusCode).toBe(409);
      expect(notPosted.json().message).toContain("comptabilisée");
      expect((await attach(ids.g!, { allocationId: randomUUID(), amount: "10.00" })).statusCode).toBe(404);
      expect((await attach(ids.g!, { allocationId: await part(ids.e2!, ids.a!), amount: "0" })).statusCode).toBe(400);
      expect((await attach(ids.g!, { allocationId: "pas-un-id", amount: "5" })).statusCode).toBe(400);
    });

    it("signale une dépense hors de la période financée sans la refuser", async () => {
      const done = await attach(ids.g!, { allocationId: await part(ids.e3!, ids.b!), amount: "100.00" });
      expect(done.statusCode, done.body).toBe(201);
      const hors = done.json().expenses.find((e: { entry: { date: string } }) => e.entry.date === "2027-02-01");
      expect(hors).toMatchObject({ outOfPeriod: true, counted: true });
      expect(done.json().warnings.join(" ")).toContain("1 dépense(s) affectée(s) sont datées hors de la période financée");
      ids.fund3 = hors.id;
    });

    it("signale un dépassement du montant accordé, avec un motif de cofinancement possible, sans bloquer", async () => {
      const small = await grantedGrant("Petite aide", [{ projectId: ids.a!, amount: "100.00" }]);
      const done = await attach(small, { allocationId: await part(ids.e2!, ids.a!), amount: "120.00", coFinancingReason: "Complété par les fonds propres de l'association" });
      expect(done.statusCode, done.body).toBe(201);
      expect(done.json()).toMatchObject({ granted: "100.00", spent: "120.00", overGranted: true, overBy: "20.00" });
      expect(done.json().warnings.join(" ")).toContain("dépassent le montant accordé (100.00 €) de 20.00 €");
      expect(done.json().expenses[0].coFinancingReason).toBe("Complété par les fonds propres de l'association");
      ids.small = small;
    });
  });

  describe("écritures contrepassées, annulation et clôture", () => {
    it("ne compte plus une dépense dont l'écriture a été contrepassée, et le dit", async () => {
      const entry = await spend(ids.achats!, "80.00", [{ projectId: ids.a!, amount: "80.00" }], "2026-07-01");
      const done = await attach(ids.g!, { allocationId: await part(entry, ids.a!), amount: "80.00" });
      const spentBefore = Number(done.json().spent);
      expect((await call("POST", `/entries/${entry}/reverse`, treasurer, {})).statusCode).toBe(201);
      const view = await expenses(ids.g!);
      const reversed = view.expenses.find((e: { entry: { id: string } }) => e.entry.id === entry);
      expect(reversed).toMatchObject({ reversed: true, counted: false, cancelled: false });
      expect(Number(view.spent)).toBe(spentBefore - 80);
      expect(view.warnings.join(" ")).toContain("1 affectation(s) concernent une écriture annulée");
      // La dépense contrepassée et son écriture inverse ne sont pas proposées.
      expect((await candidates(ids.g!)).map((c: { entry: { id: string } }) => c.entry.id)).not.toContain(entry);
      // On peut annuler l'affectation devenue inutile.
      expect((await call("POST", `/grant-expenses/${reversed.id}/cancel`, treasurer, { reason: "Écriture annulée" })).statusCode).toBe(200);
    });

    it("annule une affectation avec un motif, qui reste dans l'historique, et libère la dépense", async () => {
      expect((await call("POST", `/grant-expenses/${ids.fund3}/cancel`, treasurer, {})).statusCode).toBe(400);
      expect((await call("POST", `/grant-expenses/${ids.fund3}/cancel`, treasurer, { reason: "ab" })).statusCode).toBe(400);
      const done = await call("POST", `/grant-expenses/${ids.fund3}/cancel`, treasurer, { reason: "Mauvaise subvention" });
      expect(done.statusCode, done.body).toBe(200);
      const cancelled = done.json().expenses.find((e: { id: string }) => e.id === ids.fund3);
      expect(cancelled).toMatchObject({ cancelled: true, counted: false, cancelReason: "Mauvaise subvention" });
      expect(done.json().warnings.join(" ")).not.toContain("hors de la période");
      expect((await call("POST", `/grant-expenses/${ids.fund3}/cancel`, treasurer, { reason: "Encore" })).statusCode).toBe(409);
      expect((await candidates(ids.g!)).map((c: { entry: { id: string } }) => c.entry.id)).toContain(ids.e3);
    });

    it("ne supprime ni ne modifie jamais une affectation, en base", async () => {
      expect(await sqlError(`DELETE FROM "FundingExpenseAllocation" WHERE "id" = '${ids.fund3}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`UPDATE "FundingExpenseAllocation" SET "amount" = 1 WHERE "id" = '${ids.fund3}'`)).toContain("ne se modifie pas");
      expect(await sqlError(`UPDATE "FundingExpenseAllocation" SET "cancelReason" = 'autre' WHERE "id" = '${ids.fund3}'`)).toContain("annulée ne change plus");
      expect(await sqlError(`TRUNCATE "FundingExpenseAllocation"`)).toBeTruthy();
    });

    it("ne change plus rien une fois la subvention clôturée", async () => {
      expect((await call("POST", `/grants/${ids.small}/close`, treasurer, { closedOn: "2027-04-01", residual: "NONE" })).statusCode).toBe(200);
      const late = await attach(ids.small!, { allocationId: await part(ids.e4!, ids.a!), amount: "10.00" });
      expect(late.statusCode).toBe(409);
      expect(late.json().message).toContain("pas encore clôturée");
      const target = (await expenses(ids.small!)).expenses[0];
      const cancel = await call("POST", `/grant-expenses/${target.id}/cancel`, treasurer, { reason: "Trop tard" });
      expect(cancel.statusCode).toBe(409);
      expect(cancel.json().message).toContain("clôturée");
      expect((await expenses(ids.small!)).spent).toBe("120.00");
    });
  });

  describe("compte rendu, reliquat et visibilité", () => {
    it("calcule le reliquat : reçu − dépenses affectées, sans aucune écriture", async () => {
      const entriesBefore = await prisma.journalEntry.count();
      const t = await call("POST", `/financial-accounts/${ids.fa}/transactions`, treasurer, { operationDate: "2026-05-10", amount: "400.00", label: "Virement Région" });
      expect((await call("POST", `/grants/${ids.g}/payments`, treasurer, { transactionId: t.json().id, amount: "400.00" })).statusCode).toBe(201);
      const finance = (await call("GET", `/grants/${ids.g}/finance`, treasurer)).json();
      // Seule l'affectation de 250 € compte : les deux autres ont été annulées ou contrepassées.
      expect(finance).toMatchObject({ received: "400.00", spent: "250.00", residual: "150.00" });
      expect(await prisma.journalEntry.count()).toBe(entriesBefore);
    });

    it("regroupe les dépenses par poste et filtre par période", async () => {
      const supplies = await spend(ids.fournitures!, "120.00", [{ projectId: ids.a!, amount: "120.00" }], "2026-04-15");
      expect((await attach(ids.g!, { allocationId: await part(supplies, ids.a!), amount: "120.00" })).statusCode).toBe(201);
      const all = (await call("GET", `/grants/${ids.g}/report`, treasurer)).json();
      expect(all.grant).toMatchObject({ title: "Aide aux ateliers et au festival", funder: "Région", periodStart: "2026-01-01", periodEnd: "2026-12-31" });
      expect(all.groups).toEqual([
        { accountNumber: "606", accountLabel: "Achats", count: 1, amount: "250.00" },
        { accountNumber: "607", accountLabel: "Fournitures", count: 1, amount: "120.00" },
      ]);
      expect(all).toMatchObject({ spent: "370.00", received: "400.00", residual: "30.00", granted: "900.00", overGranted: false });

      const april = (await call("GET", `/grants/${ids.g}/report?from=2026-04-01&to=2026-04-30`, treasurer)).json();
      expect(april.groups).toEqual([{ accountNumber: "607", accountLabel: "Fournitures", count: 1, amount: "120.00" }]);
      expect(april).toMatchObject({ spent: "120.00", received: "0.00", residual: "-120.00", period: { from: "2026-04-01", to: "2026-04-30" } });
      expect((await call("GET", `/grants/${ids.g}/report?from=2026-05-01&to=2026-04-01`, treasurer)).statusCode).toBe(409);
      expect((await call("GET", `/grants/${ids.g}/report?from=demain`, treasurer)).statusCode).toBe(400);
    });

    it("exporte le compte rendu en CSV sûr, tracé dans l'audit", async () => {
      await attach(ids.g!, { allocationId: await part(ids.e4!, ids.a!), amount: "40.00" });
      const csv = await call("GET", `/grants/${ids.g}/report/csv`, boardMember);
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.headers["content-disposition"]).toContain("compte-rendu-aide-aux-ateliers-et-au-festival.csv");
      expect(csv.headers["cache-control"]).toBe("no-store");
      expect(csv.body.startsWith("\uFEFF")).toBe(true);
      expect(csv.body).toContain("Dépenses affectées par poste");
      expect(csv.body).toContain("606;Achats;1;250,00");
      // Un libellé de compte qui commence par « = » est neutralisé : un tableur ne l'exécutera pas.
      expect(csv.body).toContain("'=SOMME(A1)");
      expect(csv.body).toContain("Reliquat (reçu − dépenses affectées)");
      expect((await call("GET", `/grants/${ids.g}/report/csv`, reader)).statusCode).toBe(403);
      expect(await prisma.auditEvent.count({ where: { action: "report.exported" } })).toBeGreaterThanOrEqual(1);
    });

    it("limite la lecture à la portée, et ne montre le libellé des écritures que pour ses propres projets", async () => {
      const email = `scoped-${randomUUID()}@test.invalid`;
      const user = await users.createUser({ email, displayName: "S", password: PASSWORD });
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "project-manager" } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id, projectId: ids.c! } });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: "198.51.100.63" });
      const scoped = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };

      // Une subvention qui finance EXPOS (la portée) et ATELIERS, avec une dépense de chacun.
      const shared = await grantedGrant("Partagée", [{ projectId: ids.a!, amount: "200.00" }, { projectId: ids.c!, amount: "100.00" }]);
      const both = await spend(ids.fournitures!, "140.00", [{ projectId: ids.a!, amount: "60.00" }, { projectId: ids.c!, amount: "80.00" }], "2026-04-20");
      expect((await attach(shared, { allocationId: await part(both, ids.a!), amount: "60.00" })).statusCode).toBe(201);
      expect((await attach(shared, { allocationId: await part(both, ids.c!), amount: "80.00" })).statusCode).toBe(201);
      const view = await expenses(shared, scoped);
      const own = view.expenses.find((e: { project: { code: string } }) => e.project.code === "EXPOS");
      const other = view.expenses.find((e: { project: { code: string } }) => e.project.code === "ATELIERS");
      expect(own.entry.label).toBe("Facture traiteur");
      expect(other.entry.label).toBeNull();
      expect(other).toMatchObject({ amount: "60.00", account: { number: "607" } });
      expect((await expenses(shared, treasurer)).expenses.every((e: { entry: { label: string | null } }) => e.entry.label === "Facture traiteur")).toBe(true);

      expect((await call("GET", `/grants/${ids.g}/expenses`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/grants/${ids.g}/report`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/grants/${ids.g}/report/csv`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/grants/${shared}/report`, scoped)).statusCode).toBe(200);
      expect((await attach(shared, { allocationId: await part(both, ids.c!), amount: "1" }, scoped)).statusCode).toBe(403);
      expect((await call("GET", `/grants/${shared}/expense-candidates`, scoped)).statusCode).toBe(403);
    });

    it("trace les affectations sans recopier de montant", async () => {
      const events = await prisma.auditEvent.findMany({ where: { action: { startsWith: "grant.expense." } } });
      expect(new Set(events.map((e) => e.action))).toEqual(new Set(["grant.expense.attached", "grant.expense.cancelled"]));
      const serialized = JSON.stringify(events.map((e) => e.details));
      for (const amount of ["250.00", "120.00", "100.00", "80.00"]) expect(serialized).not.toContain(amount);
      expect(events.find((e) => e.action === "grant.expense.cancelled" && e.justification === "Mauvaise subvention")).toBeTruthy();
      expect(events.some((e) => (e.details as { coFinanced?: boolean }).coFinanced === true)).toBe(true);
    });
  });
});
