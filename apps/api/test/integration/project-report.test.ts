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

describe("Engagements et rapport budgétaire de projet (base vierge)", () => {
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

  const budgetLine = (over: Record<string, unknown> = {}) => ({
    kind: "CHARGE",
    label: "Poste",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amount: "1000.00",
    ...over,
  });
  /** Budget approuvé : préparé par le trésorier, approuvé par le bureau. */
  const approvedBudget = async (projectId: string, lines: object[]) => {
    const created = await call("POST", `/projects/${projectId}/budgets`, treasurer, { label: "Budget" });
    expect(created.statusCode, created.body).toBe(201);
    expect((await call("PUT", `/budgets/${created.json().id}`, treasurer, { lines })).statusCode).toBe(200);
    expect((await call("POST", `/budgets/${created.json().id}/approve`, boardMember, {})).statusCode).toBe(200);
  };
  const project = async (code: string) => (await call("POST", "/projects", treasurer, { code, name: code })).json().id as string;
  const commit = async (projectId: string, over: Record<string, unknown> = {}) => {
    const response = await call("POST", `/projects/${projectId}/commitments`, treasurer, {
      label: "Devis",
      amount: "300.00",
      committedOn: "2026-02-01",
      accountId: ids.c606,
      ...over,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  /** Dépense comptabilisée D charge / C banque, ventilée sur un projet. */
  const spend = async (projectId: string, amount: string, over: { date?: string; account?: string } = {}) => {
    const entry = await call("POST", "/entries", treasurer, {
      journalId: ids.OD,
      date: over.date ?? "2026-03-01",
      label: "Facture",
      lines: [
        { accountId: over.account ?? ids.c606, debit: amount, allocations: [{ projectId, amount }] },
        { accountId: ids.bank, credit: amount },
      ],
    });
    expect(entry.statusCode, entry.body).toBe(201);
    expect((await call("POST", `/entries/${entry.json().id}/post`, treasurer, {})).statusCode).toBe(200);
    return entry.json().id as string;
  };
  const report = async (projectId: string, fiscalYearId?: string, session: Session = treasurer) =>
    call("GET", `/projects/${projectId}/budget-report${fiscalYearId ? `?fiscalYearId=${fiscalYearId}` : ""}`, session);
  const charge606 = (body: { charges: { rows: { accountNumber: string | null }[] } }) => body.charges.rows.find((r) => r.accountNumber === "606") as Record<string, string | boolean | null>;

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
      ["c606", "606", "Achats"],
      ["c607", "607", "Fournitures"],
      ["s706", "706", "Prestations"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.fy2026 = (await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).json().id;
    ids.fy2027 = (await call("POST", "/fiscal-years", treasurer, { label: "2027", start: "2027-01-01", end: "2027-12-31" })).json().id;
    ids.festival = await project("FESTIVAL");
    ids.autre = await project("AUTRE");
    await approvedBudget(ids.festival!, [
      budgetLine({ label: "Achats", accountId: ids.c606, amount: "1000.00" }),
      budgetLine({ kind: "PRODUCT", label: "Prestations", accountId: ids.s706, amount: "800.00" }),
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("engagements", () => {
    it("réserve la lecture à projects:view et l'écriture à budgets:update", async () => {
      expect((await call("GET", `/projects/${ids.festival}/commitments`)).statusCode).toBe(401);
      expect((await call("GET", `/projects/${ids.festival}/commitments`, reader)).statusCode).toBe(200);
      const body = { label: "Devis", amount: "300.00", committedOn: "2026-02-01" };
      expect((await call("POST", `/projects/${ids.festival}/commitments`, reader, body)).statusCode).toBe(403);
      expect((await call("POST", `/projects/${ids.festival}/commitments`, boardMember, body)).statusCode).toBe(403);
      const created = await commit(ids.festival!);
      ids.devis = created.id;
      expect(created).toMatchObject({ state: "OPEN", engaged: true, amount: "300.00", accountNumber: "606" });
    });

    it("refuse un montant nul, un libellé vide, un compte qui n'est pas de charges et un projet archivé", async () => {
      const post = (over: object) =>
        call("POST", `/projects/${ids.festival}/commitments`, treasurer, { label: "X", amount: "10", committedOn: "2026-02-01", ...over });
      expect((await post({ amount: "0" })).statusCode).toBe(400);
      expect((await post({ amount: "12,5" })).statusCode).toBe(400);
      expect((await post({ label: " " })).statusCode).toBe(400);
      expect((await post({ committedOn: "demain" })).statusCode).toBe(400);
      const wrongClass = await post({ accountId: ids.s706 });
      expect(wrongClass.statusCode).toBe(409);
      expect(wrongClass.json().message).toContain("classe 6");
      expect((await post({ accountId: randomUUID() })).statusCode).toBe(409);
      const archived = await project("ARCHIVE");
      await call("PATCH", `/projects/${archived}`, treasurer, { status: "ARCHIVED" });
      expect((await call("POST", `/projects/${archived}/commitments`, treasurer, { label: "X", amount: "10", committedOn: "2026-02-01" })).json().message).toContain("archivé");
    });

    it("modifie un engagement ouvert", async () => {
      const edited = await call("PATCH", `/commitments/${ids.devis}`, treasurer, { label: "Devis traiteur", note: "Accepté par mail" });
      expect(edited.json()).toMatchObject({ label: "Devis traiteur", note: "Accepté par mail", amount: "300.00" });
    });
  });

  describe("rapport budgétaire et anti double comptage (CA-14)", () => {
    it("montre budget, engagé, réalisé et reste, avec la formule et son périmètre", async () => {
      const response = await report(ids.festival!);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json();
      expect(body.budget).toMatchObject({ number: 1 });
      expect(body.formula).toContain("budget − dépensé");
      expect(body.formula).toContain("toute la vie du projet");
      expect(charge606(body)).toMatchObject({ budget: "1000.00", engaged: "300.00", actual: "0.00", remaining: "700.00" });
      expect(body.charges.total).toEqual({ budget: "1000.00", engaged: "300.00", actual: "0.00", remaining: "700.00" });
      expect(body.products.total).toEqual({ budget: "800.00", engaged: null, actual: "0.00", remaining: "800.00" });
    });

    it("compte le réalisé en plus de l'engagement tant que celui-ci n'est pas soldé", async () => {
      ids.facture = await spend(ids.festival!, "200.00");
      const body = (await report(ids.festival!)).json();
      expect(charge606(body)).toMatchObject({ budget: "1000.00", engaged: "300.00", actual: "200.00", remaining: "500.00" });
    });

    it("refuse de solder par une écriture non comptabilisée, ou sans dépense sur ce projet", async () => {
      const draft = await call("POST", "/entries", treasurer, {
        journalId: ids.OD,
        date: "2026-03-05",
        label: "Brouillon",
        lines: [
          { accountId: ids.c606, debit: "50.00", allocations: [{ projectId: ids.festival, amount: "50.00" }] },
          { accountId: ids.bank, credit: "50.00" },
        ],
      });
      const notPosted = await call("POST", `/commitments/${ids.devis}/settle`, treasurer, { entryId: draft.json().id });
      expect(notPosted.statusCode).toBe(409);
      expect(notPosted.json().message).toContain("pas comptabilisée");

      const elsewhere = await spend(ids.autre!, "75.00");
      const wrongProject = await call("POST", `/commitments/${ids.devis}/settle`, treasurer, { entryId: elsewhere });
      expect(wrongProject.statusCode).toBe(409);
      expect(wrongProject.json().message).toContain("aucune dépense affectée à ce projet");
      expect((await call("POST", `/commitments/${ids.devis}/settle`, treasurer, { entryId: randomUUID() })).statusCode).toBe(409);
      expect((await call("GET", `/projects/${ids.festival}/commitments`, treasurer)).json()[0]).toMatchObject({ state: "OPEN" });
    });

    it("propose seulement les écritures qui peuvent solder l'engagement, et exige entries:view", async () => {
      const candidates = (await call("GET", `/commitments/${ids.devis}/entry-candidates`, treasurer)).json();
      expect(candidates.map((c: { id: string }) => c.id)).toEqual([ids.facture]);
      expect(candidates[0]).toMatchObject({ projectAmount: "200.00", journalCode: "OD" });
      expect((await call("GET", `/commitments/${ids.devis}/entry-candidates`, reader)).statusCode).toBe(403);
      expect((await call("POST", `/commitments/${ids.devis}/settle`, boardMember, { entryId: ids.facture })).statusCode).toBe(403);
    });

    it("solde l'engagement : il cesse de compter, la dépense réelle le remplace (jamais les deux)", async () => {
      const settled = await call("POST", `/commitments/${ids.devis}/settle`, treasurer, { entryId: ids.facture });
      expect(settled.statusCode, settled.body).toBe(200);
      expect(settled.json()).toMatchObject({ state: "SETTLED", engaged: false, settledEntry: { id: ids.facture, journalCode: "OD" } });
      const body = (await report(ids.festival!)).json();
      expect(charge606(body)).toMatchObject({ budget: "1000.00", engaged: "0.00", actual: "200.00", remaining: "800.00" });
      expect(body.charges.total).toEqual({ budget: "1000.00", engaged: "0.00", actual: "200.00", remaining: "800.00" });
    });

    it("ne laisse plus modifier, resolder ni supprimer un engagement soldé, en API comme en base", async () => {
      expect((await call("PATCH", `/commitments/${ids.devis}`, treasurer, { amount: "1.00" })).statusCode).toBe(409);
      const again = await call("POST", `/commitments/${ids.devis}/settle`, treasurer, { entryId: ids.facture });
      expect(again.statusCode).toBe(409);
      expect(again.json().message).toContain("déjà soldé");
      expect((await call("POST", `/commitments/${ids.devis}/cancel`, treasurer, { reason: "Test" })).statusCode).toBe(409);
      expect(await sqlError(`UPDATE "Commitment" SET "amount" = 1 WHERE "id" = '${ids.devis}'`)).toContain("ne se modifie plus");
      expect(await sqlError(`DELETE FROM "Commitment" WHERE "id" = '${ids.devis}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`TRUNCATE "Commitment"`)).toBeTruthy();
      expect(await sqlError(`UPDATE "Commitment" SET "status" = 'OPEN', "settledEntryId" = NULL, "settledAt" = NULL WHERE "id" = '${ids.devis}'`)).toContain("ne revient pas en arrière");
    });

    it("rouvre l'engagement si l'écriture de solde est contrepassée : il ne disparaît pas des deux côtés", async () => {
      expect((await call("POST", `/entries/${ids.facture}/reverse`, treasurer, {})).statusCode).toBe(201);
      const listed = (await call("GET", `/projects/${ids.festival}/commitments`, treasurer)).json()[0];
      expect(listed).toMatchObject({ state: "REOPENED", engaged: true });
      const body = (await report(ids.festival!)).json();
      expect(charge606(body)).toMatchObject({ engaged: "300.00", actual: "0.00", remaining: "700.00" });

      const reversed = await call("POST", `/commitments/${ids.devis}/settle`, treasurer, { entryId: ids.facture });
      expect(reversed.statusCode).toBe(409);
      expect(reversed.json().message).toContain("pas comptabilisée");
    });

    it("annule un engagement rouvert avec un motif, et il cesse de compter", async () => {
      expect((await call("POST", `/commitments/${ids.devis}/cancel`, treasurer, {})).statusCode).toBe(400);
      const cancelled = await call("POST", `/commitments/${ids.devis}/cancel`, treasurer, { reason: "Commande abandonnée" });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(cancelled.json()).toMatchObject({ state: "CANCELLED", engaged: false, cancelReason: "Commande abandonnée", settledEntry: null });
      expect(charge606((await report(ids.festival!)).json())).toMatchObject({ engaged: "0.00", remaining: "1000.00" });
      expect((await call("POST", `/commitments/${ids.devis}/cancel`, treasurer, { reason: "Encore" })).statusCode).toBe(409);
      expect((await call("PATCH", `/commitments/${ids.devis}`, treasurer, { label: "X" })).statusCode).toBe(409);
      expect((await call("POST", `/commitments/${ids.devis}/settle`, treasurer, { entryId: randomUUID() })).statusCode).toBe(409);
    });

    it("ne solde qu'une fois quand deux soldes arrivent ensemble", async () => {
      const racing = await commit(ids.festival!, { label: "Course", amount: "40.00" });
      const first = await spend(ids.festival!, "20.00");
      const second = await spend(ids.festival!, "20.00");
      const results = await Promise.all([first, second].map((entryId) => call("POST", `/commitments/${racing.id}/settle`, treasurer, { entryId })));
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const body = (await report(ids.festival!)).json();
      // Les deux dépenses sont au réalisé ; l'engagement soldé n'est plus compté : une seule fois chacune.
      expect(charge606(body)).toMatchObject({ engaged: "0.00", actual: "40.00" });
    });

    it("compte les recettes au réalisé et rend leur reste à recevoir", async () => {
      const entry = await call("POST", "/entries", treasurer, {
        journalId: ids.OD,
        date: "2026-04-01",
        label: "Recette",
        lines: [
          { accountId: ids.bank, debit: "500.00" },
          { accountId: ids.s706, credit: "500.00", allocations: [{ projectId: ids.festival, amount: "500.00" }] },
        ],
      });
      await call("POST", `/entries/${entry.json().id}/post`, treasurer, {});
      const body = (await report(ids.festival!)).json();
      expect(body.products.rows[0]).toMatchObject({ accountNumber: "706", budget: "800.00", actual: "500.00", remaining: "300.00", engaged: null });
    });

    it("n'oublie aucune dépense : un compte absent du budget apparaît à part et compte dans le total", async () => {
      await spend(ids.festival!, "30.00", { account: ids.c607! });
      const body = (await report(ids.festival!)).json();
      const other = body.charges.rows.find((r: { accountNumber: string }) => r.accountNumber === "607");
      expect(other).toMatchObject({ outOfBudget: true, budget: null, actual: "30.00", remaining: null, note: "Compte non indiqué dans le budget" });
      expect(body.charges.total).toMatchObject({ budget: "1000.00", actual: "70.00", remaining: "930.00" });
    });
  });

  describe("vues annuelle et globale, absence de budget", () => {
    it("répartit une ligne à cheval sur deux exercices au prorata des jours, et date les engagements", async () => {
      ids.annuel = await project("ANNUEL");
      await approvedBudget(ids.annuel, [budgetLine({ label: "Achats", accountId: ids.c606, amount: "3650.00", periodStart: "2026-07-01", periodEnd: "2027-06-30" })]);
      await spend(ids.annuel, "100.00", { date: "2026-09-01" });
      await spend(ids.annuel, "50.00", { date: "2027-02-01" });
      await commit(ids.annuel, { label: "Devis 2027", amount: "25.00", committedOn: "2027-03-01" });

      const global = (await report(ids.annuel)).json();
      expect(global.scope.kind).toBe("GLOBAL");
      expect(charge606(global)).toMatchObject({ budget: "3650.00", actual: "150.00", engaged: "25.00", remaining: "3475.00" });

      const y2026 = (await report(ids.annuel, ids.fy2026)).json();
      expect(y2026.scope).toMatchObject({ kind: "YEAR", fiscalYear: { label: "2026" } });
      expect(y2026.formula).toContain("exercice 2026");
      expect(charge606(y2026)).toMatchObject({ budget: "1840.00", actual: "100.00", engaged: "0.00", remaining: "1740.00" });
      expect(y2026.warnings.join(" ")).toContain("au prorata du nombre de jours");

      const y2027 = (await report(ids.annuel, ids.fy2027)).json();
      expect(charge606(y2027)).toMatchObject({ budget: "1810.00", actual: "50.00", engaged: "25.00", remaining: "1735.00" });
      expect(y2027.fiscalYears.map((y: { label: string }) => y.label)).toEqual(["2026", "2027"]);
      expect((await report(ids.annuel, randomUUID())).statusCode).toBe(404);
      expect((await report(ids.annuel, "pas-un-id")).statusCode).toBe(400);
    });

    it("sans budget en vigueur, montre le réalisé seul avec un avertissement, jamais des zéros trompeurs", async () => {
      const sans = await project("SANS");
      await spend(sans, "60.00");
      const body = (await report(sans)).json();
      expect(body.budget).toBeNull();
      expect(body.warnings[0]).toContain("Aucun budget n'est en vigueur");
      expect(body.charges.total).toEqual({ budget: null, engaged: "0.00", actual: "60.00", remaining: null });
      expect(body.charges.rows[0]).toMatchObject({ actual: "60.00", budget: null, remaining: null });
    });

    it("signale les postes de budget sans compte et neutralise les formules dans l'export CSV", async () => {
      const libelle = await project("LIBELLE");
      await approvedBudget(libelle, [budgetLine({ label: "=1+1", amount: "50.00" }), budgetLine({ label: "Achats", accountId: ids.c606, amount: "100.00" })]);
      await spend(libelle, "10.00");
      const body = (await report(libelle)).json();
      expect(body.warnings.join(" ")).toContain("1 poste(s) du budget n'ont pas de compte");
      const noAccount = body.charges.rows.find((r: { label: string }) => r.label === "=1+1");
      expect(noAccount).toMatchObject({ budget: "50.00", actual: null, remaining: null });
      expect(body.charges.total).toMatchObject({ budget: "150.00", actual: "10.00", remaining: "140.00" });

      const csv = await call("GET", `/projects/${libelle}/budget-report/csv`, reader);
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.headers["content-disposition"]).toContain("budget-libelle.csv");
      expect(csv.headers["cache-control"]).toBe("no-store");
      expect(csv.body.startsWith("\uFEFF")).toBe(true);
      expect(csv.body).toContain("'=1+1");
      expect(csv.body).toContain("Dépenses (charges)");
      expect(csv.body).toContain("140,00");
      expect(await prisma.auditEvent.count({ where: { action: "report.exported" } })).toBeGreaterThanOrEqual(1);
    });
  });

  describe("portée projet et audit", () => {
    it("ne révèle ni le rapport, ni les engagements d'un projet hors portée", async () => {
      const email = `scoped-${randomUUID()}@test.invalid`;
      const user = await users.createUser({ email, displayName: "S", password: PASSWORD });
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "project-manager" } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id, projectId: ids.autre! } });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: "198.51.100.91" });
      const scoped = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
      expect((await report(ids.festival!, undefined, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.festival}/budget-report/csv`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.festival}/commitments`, scoped)).statusCode).toBe(404);
      expect((await report(ids.autre!, undefined, scoped)).statusCode).toBe(200);
      expect((await call("GET", `/projects/${ids.autre}/commitments`, scoped)).statusCode).toBe(200);
    });

    it("trace les engagements sans recopier de montant", async () => {
      const events = await prisma.auditEvent.findMany({ where: { action: { startsWith: "commitment." } } });
      expect(new Set(events.map((e) => e.action))).toEqual(new Set(["commitment.created", "commitment.updated", "commitment.settled", "commitment.cancelled"]));
      expect(JSON.stringify(events.map((e) => e.details))).not.toContain("300.00");
      expect(events.find((e) => e.action === "commitment.cancelled")?.justification).toBe("Commande abandonnée");
    });
  });
});
