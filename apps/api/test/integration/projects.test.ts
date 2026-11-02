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

type Method = "GET" | "POST" | "PUT" | "PATCH";

describe("Projets et ventilation analytique (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let reader: Session;
  let boardMember: Session;
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

  /** Écriture « charge » : D 606 / C 512, ventilée comme demandé. */
  const expense = (amount: string, allocations?: { projectId: string; amount: string }[], date = "2026-03-01") => ({
    journalId: ids.OD,
    date,
    label: "Achat",
    lines: [
      { accountId: ids.charges, debit: amount, ...(allocations && { allocations }) },
      { accountId: ids.bank, credit: amount },
    ],
  });
  const draft = async (body: object) => {
    const response = await call("POST", "/entries", treasurer, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const post = (id: string) => call("POST", `/entries/${id}/post`, treasurer, {});

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
      ["charges", "606", "Achats"],
      ["sales", "706", "Prestations"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.fy2026 = (await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).json().id;
    ids.fy2027 = (await call("POST", "/fiscal-years", treasurer, { label: "2027", start: "2027-01-01", end: "2027-12-31" })).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("projets", () => {
    it("réserve la lecture à projects:view et la modification à projects:update", async () => {
      expect((await call("GET", "/projects")).statusCode).toBe(401);
      expect((await call("GET", "/projects", reader)).statusCode).toBe(200);
      expect((await call("POST", "/projects", reader, { code: "X", name: "X" })).statusCode).toBe(403);
      expect((await call("POST", "/projects", boardMember, { code: "X", name: "X" })).statusCode).toBe(403);
      expect((await call("POST", "/projects", treasurer, { code: "ATELIERS", name: "Ateliers" })).statusCode).toBe(201);
    });

    it("installe le projet permanent « Fonctionnement », seul de son espèce", async () => {
      const list = (await call("GET", "/projects", treasurer)).json();
      expect(list[0]).toMatchObject({ code: "FONCT", permanent: true, status: "ACTIVE" });
      expect(list.filter((p: { permanent: boolean }) => p.permanent)).toHaveLength(1);
      ids.fonct = list[0].id;
      expect(await sqlError(`INSERT INTO "Project" ("id","code","name","permanent") VALUES (gen_random_uuid(),'AUTRE','Autre',true)`)).toContain("Project_one_permanent");
    });

    it("crée et modifie un projet, refuse un code pris ou mal formé, des dates inversées ou un responsable inconnu", async () => {
      const created = await call("POST", "/projects", treasurer, { code: "FESTIVAL", name: "Festival", startDate: "2026-06-01", endDate: "2026-06-30" });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ code: "FESTIVAL", status: "PREPARATION", permanent: false, startDate: "2026-06-01" });
      ids.festival = created.json().id;
      ids.ateliers = (await call("GET", "/projects", treasurer)).json().find((p: { code: string }) => p.code === "ATELIERS").id;

      expect((await call("POST", "/projects", treasurer, { code: "FESTIVAL", name: "Doublon" })).statusCode).toBe(409);
      expect((await call("POST", "/projects", treasurer, { code: "mal formé", name: "X" })).statusCode).toBe(400);
      expect((await call("POST", "/projects", treasurer, { code: "INVERSE", name: "X", startDate: "2026-02-01", endDate: "2026-01-01" })).statusCode).toBe(409);
      expect((await call("POST", "/projects", treasurer, { code: "RESP", name: "X", managerId: randomUUID() })).statusCode).toBe(409);
      expect((await call("POST", "/projects", treasurer, { code: "EXTRA", name: "X", permanent: true })).statusCode).toBe(400);

      const updated = await call("PATCH", `/projects/${ids.festival}`, treasurer, { status: "ACTIVE", description: "Été 2026" });
      expect(updated.json()).toMatchObject({ status: "ACTIVE", description: "Été 2026" });
      expect((await call("PATCH", `/projects/${ids.festival}`, treasurer, { code: "AUTRE" })).statusCode).toBe(400);
      expect((await call("PATCH", `/projects/${randomUUID()}`, treasurer, { name: "?" })).statusCode).toBe(404);
    });

    it("protège le projet permanent et ne supprime jamais un projet", async () => {
      expect((await call("PATCH", `/projects/${ids.fonct}`, treasurer, { status: "ARCHIVED" })).statusCode).toBe(409);
      expect(await sqlError(`UPDATE "Project" SET "status"='ARCHIVED' WHERE "permanent"`)).toContain("permanent reste actif");
      expect(await sqlError(`UPDATE "Project" SET "permanent"=false WHERE "permanent"`)).toContain("permanent");
      expect(await sqlError(`UPDATE "Project" SET "code"='NOUVEAU' WHERE id='${ids.festival}'`)).toContain("code");
      expect(await sqlError(`DELETE FROM "Project"`)).toContain("on l'archive");
      expect(await sqlError(`TRUNCATE "Project" CASCADE`)).toContain("TRUNCATE refusé");
    });
  });

  describe("obligation de projet (CA-06)", () => {
    it("est active par défaut : brouillon autorisé, comptabilisation refusée sur une charge sans projet", async () => {
      expect((await call("GET", "/accounting/settings", boardMember)).json()).toEqual({ projectRequired: true });
      const entry = await draft(expense("80.00"));
      const refused = await post(entry.id);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().issues[0].code).toBe("PROJECT_REQUIRED");
      // Message à trois temps : où, pourquoi, que faire.
      expect(refused.json().issues[0].message).toMatch(/^Ligne 1 \(compte \d+\)/);
      expect(refused.json().issues[0].message).toContain("pour savoir ce que chaque activité coûte et rapporte");
      expect(refused.json().issues[0].message).toContain("« Fonctionnement »");
      expect((await call("GET", `/entries/${entry.id}`, treasurer)).json().status).toBe("DRAFT");
      // La base refuse aussi, hors du service.
      expect(await sqlError(`UPDATE "JournalEntry" SET "status"='POSTED' WHERE id='${entry.id}'`)).toContain("Projet obligatoire");
    });

    it("comptabilise une charge ventilée sur un projet, et une ligne de trésorerie n'en a pas besoin", async () => {
      const entry = await draft(expense("80.00", [{ projectId: ids.fonct!, amount: "80.00" }]));
      const posted = await post(entry.id);
      expect(posted.statusCode, posted.body).toBe(200);
      expect(posted.json().lines[0].allocations).toEqual([{ projectId: ids.fonct, projectCode: "FONCT", amount: "80.00" }]);
      expect(posted.json().lines[1].allocations).toEqual([]);
    });

    it("se désactive par paramètre, réservé à settings.accounting:admin", async () => {
      expect((await call("PUT", "/accounting/settings", boardMember, { projectRequired: false })).statusCode).toBe(403);
      expect((await call("PUT", "/accounting/settings", treasurer, { projectRequired: "non" })).statusCode).toBe(400);
      // L'API générique des paramètres ne donne aucun accès à cette rubrique, quel que soit le droit.
      expect([403, 404]).toContain((await call("PUT", "/settings/accounting", treasurer, { projectRequired: false })).statusCode);
      expect((await call("GET", "/accounting/settings", boardMember)).json()).toEqual({ projectRequired: true });

      expect((await call("PUT", "/accounting/settings", treasurer, { projectRequired: false })).json()).toMatchObject({ changed: true, value: { projectRequired: false } });
      const entry = await draft(expense("10.00"));
      expect((await post(entry.id)).statusCode).toBe(200);

      expect((await call("PUT", "/accounting/settings", treasurer, { projectRequired: true })).statusCode).toBe(200);
      const strict = await draft(expense("10.00"));
      expect((await post(strict.id)).statusCode).toBe(422);
    });
  });

  describe("ventilation", () => {
    it("répartit une ligne entre plusieurs projets, à hauteur exacte de son montant", async () => {
      const entry = await draft(
        expense("100.00", [
          { projectId: ids.festival!, amount: "60.00" },
          { projectId: ids.ateliers!, amount: "40.00" },
        ]),
      );
      const posted = await post(entry.id);
      expect(posted.statusCode, posted.body).toBe(200);
      expect(posted.json().lines[0].allocations.map((a: { projectCode: string; amount: string }) => [a.projectCode, a.amount])).toEqual([
        ["ATELIERS", "40.00"],
        ["FESTIVAL", "60.00"],
      ]);
    });

    it("refuse un total qui ne correspond pas au montant, sans rien comptabiliser", async () => {
      const short = await draft(expense("100.00", [{ projectId: ids.festival!, amount: "99.99" }]));
      const refused = await post(short.id);
      expect(refused.statusCode).toBe(422);
      expect(JSON.stringify(refused.json())).toContain("ventilation");
      expect((await call("GET", `/entries/${short.id}`, treasurer)).json()).toMatchObject({ status: "DRAFT", number: null });

      const over = await draft(expense("100.00", [{ projectId: ids.festival!, amount: "60.00" }, { projectId: ids.ateliers!, amount: "60.00" }]));
      expect((await post(over.id)).statusCode).toBe(422);
    });

    it("refuse une ventilation invalide dès la saisie", async () => {
      const bad = (allocations: unknown[]) => call("POST", "/entries", treasurer, expense("10.00", allocations as never));
      expect((await bad([{ projectId: ids.festival, amount: "0.00" }])).statusCode).toBe(400);
      expect((await bad([{ projectId: ids.festival, amount: "-5.00" }])).statusCode).toBe(400);
      expect((await bad([{ projectId: ids.festival, amount: "5" }, { projectId: ids.festival, amount: "5" }])).statusCode).toBe(400);
      expect((await bad([{ projectId: "pas-un-uuid", amount: "5" }])).statusCode).toBe(400);
      expect((await bad([{ projectId: randomUUID(), amount: "10.00" }])).statusCode).toBe(409);
    });

    it("ne ventile que les lignes de charge ou de produit, vers un projet non archivé", async () => {
      const onBank = await call("POST", "/entries", treasurer, {
        journalId: ids.OD,
        date: "2026-03-02",
        label: "Banque ventilée",
        lines: [{ accountId: ids.charges, debit: "5.00" }, { accountId: ids.bank, credit: "5.00", allocations: [{ projectId: ids.festival, amount: "5.00" }] }],
      });
      expect(onBank.statusCode).toBe(409);
      expect(onBank.json().message).toContain("classes 6 et 7");

      const archived = (await call("POST", "/projects", treasurer, { code: "VIEUX", name: "Vieux", status: "ARCHIVED" })).json();
      const toArchived = await call("POST", "/entries", treasurer, expense("5.00", [{ projectId: archived.id, amount: "5.00" }]));
      expect(toArchived.statusCode).toBe(409);
      expect(toArchived.json().message).toContain("archivé");
    });

    it("modifie la ventilation d'un brouillon, jamais celle d'une écriture comptabilisée", async () => {
      const entry = await draft(expense("30.00", [{ projectId: ids.festival!, amount: "30.00" }]));
      const updated = await call("PUT", `/entries/${entry.id}`, treasurer, {
        ...expense("30.00", [{ projectId: ids.ateliers!, amount: "30.00" }]),
        version: entry.version,
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().lines[0].allocations[0].projectCode).toBe("ATELIERS");

      const posted = (await post(entry.id)).json();
      expect(await sqlError(`UPDATE "AnalyticalAllocation" SET "amount"=1 WHERE "lineId" IN (SELECT id FROM "JournalLine" WHERE "entryId"='${posted.id}')`)).toContain("immuable");
      expect(await sqlError(`DELETE FROM "AnalyticalAllocation" WHERE "lineId" IN (SELECT id FROM "JournalLine" WHERE "entryId"='${posted.id}')`)).toContain("immuable");
      // Refusé par le déclencheur, ou par PostgreSQL lui-même depuis qu'une autre table (les dépenses affectées aux subventions)
      // référence cette table : dans les deux cas, la table ne peut pas être vidée.
      expect(await sqlError(`TRUNCATE "AnalyticalAllocation"`)).toMatch(/TRUNCATE refusé|cannot truncate a table referenced in a foreign key/);
    });
  });

  describe("synthèse par projet", () => {
    it("totalise charges et produits, annuellement et globalement, contrepassation comprise", async () => {
      // FESTIVAL : une charge de 70 en 2026 (contrepassée), un produit de 500 en 2027.
      const charge = (await post((await draft(expense("70.00", [{ projectId: ids.festival!, amount: "70.00" }], "2026-09-01"))).id)).json();
      const reversal = await call("POST", `/entries/${charge.id}/reverse`, treasurer, { date: "2026-09-02" });
      expect(reversal.statusCode, reversal.body).toBe(201);
      expect(reversal.json().lines[0].allocations).toEqual([{ projectId: ids.festival, projectCode: "FESTIVAL", amount: "70.00" }]);

      const income = await draft({
        journalId: ids.OD,
        date: "2027-05-05",
        label: "Billetterie",
        lines: [{ accountId: ids.bank, debit: "500.00" }, { accountId: ids.sales, credit: "500.00", allocations: [{ projectId: ids.festival, amount: "500.00" }] }],
      });
      expect((await post(income.id)).statusCode).toBe(200);

      const summary = (await call("GET", `/projects/${ids.festival}/summary`, reader)).json();
      // Charges 2026 : 60 (ventilation à 60 d'un test précédent) + 70 − 70 ; produits 2027 : 500.
      expect(summary.years.map((y: { label: string }) => y.label)).toEqual(["2026", "2027"]);
      expect(summary.years[0]).toMatchObject({ charges: "60.00", produits: "0.00", result: "-60.00" });
      expect(summary.years[1]).toMatchObject({ charges: "0.00", produits: "500.00", result: "500.00" });
      expect(summary.total).toEqual({ charges: "60.00", produits: "500.00", result: "440.00" });

      const only2027 = (await call("GET", `/projects/${ids.festival}/summary?fiscalYearId=${ids.fy2027}`, reader)).json();
      expect(only2027.total).toEqual({ charges: "0.00", produits: "500.00", result: "500.00" });
      expect((await call("GET", `/projects/${randomUUID()}/summary`, reader)).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.festival}/summary?fiscalYearId=nimporte`, reader)).statusCode).toBe(400);
    });
  });

  it("trace la gestion des projets dans l'audit", async () => {
    const actions = new Set((await prisma.auditEvent.findMany({ where: { objectType: "Project" } })).map((e) => e.action));
    expect(actions.has("project.created")).toBe(true);
    expect(actions.has("project.updated")).toBe(true);
  });
});
