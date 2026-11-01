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

describe("Clôture d'exercice : fermeture, à-nouveaux, ordre et double report (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
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
    const email = `k-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "K", password: PASSWORD });
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

  const posted = async (date: string, debit: [string, string], credit: [string, string], journal = "OD") => {
    const created = await call("POST", "/entries", treasurer, {
      journalId: ids[journal],
      date,
      label: `Écriture ${debit[0]}/${credit[0]}`,
      lines: [
        { accountId: ids[debit[0]], debit: debit[1] },
        { accountId: ids[credit[0]], credit: credit[1] },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const response = await call("POST", `/entries/${created.json().id}/post`, treasurer);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  const closing = (year: string, action = "") => `/fiscal-years/${ids[year]}/closing${action}`;
  const linesOf = async (entryId: string) =>
    (await call("GET", `/entries/${entryId}`, treasurer)).json().lines.map(
      (l: { accountNumber: string; debit: string; credit: string }) => `${l.accountNumber} D${l.debit} C${l.credit}`,
    );

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
    // Ces tests ne portent pas sur l'analytique : l'obligation de projet (active par défaut) est levée.
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");

    for (const journal of await prisma.journal.findMany()) ids[journal.code] = journal.id;
    // 606 n'a volontairement pas de rubrique de rapport : le contrôle doit le signaler sans bloquer.
    for (const [key, number, label, reportLine] of [
      ["bank", "512", "Banque", "Trésorerie"],
      ["fonds", "102", "Fonds associatifs", "Fonds propres"],
      ["sales", "706", "Prestations", "Produits"],
      ["charges", "606", "Achats", null],
      ["surplus", "120", "Report à nouveau excédentaire", "Fonds propres"],
      ["deficit", "129", "Report à nouveau déficitaire", "Fonds propres"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label, ...(reportLine && { reportLine }) })).json().id;
    }
    ids.fy2026 = (await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("réserve la clôture à fiscal-years:close", async () => {
    expect((await call("GET", closing("fy2026"))).statusCode).toBe(401);
    expect((await call("GET", closing("fy2026"), boardMember)).statusCode).toBe(403);
    expect((await call("POST", closing("fy2026", "/start"), boardMember)).statusCode).toBe(403);
    expect((await call("POST", closing("fy2026", "/close"), boardMember, {})).statusCode).toBe(403);
    expect((await call("GET", closing("fy2026"), treasurer)).statusCode).toBe(200);
    expect((await call("GET", `/fiscal-years/${randomUUID()}/closing`, treasurer)).statusCode).toBe(404);
  });

  describe("exercice 2026", () => {
    it("prépare : apport, produit, charge, et une écriture contrepassée qui s'annule", async () => {
      await posted("2026-01-10", ["bank", "1000.00"], ["fonds", "1000.00"]);
      await posted("2026-03-15", ["bank", "300.00"], ["sales", "300.00"]);
      await posted("2026-06-01", ["charges", "120.00"], ["bank", "120.00"]);
      const wrong = await posted("2026-07-01", ["charges", "50.00"], ["bank", "50.00"]);
      expect((await call("POST", `/entries/${wrong.id}/reverse`, treasurer, { date: "2026-07-02" })).statusCode).toBe(201);
    });

    it("bloque tant qu'il reste un brouillon ou que l'exercice suivant manque", async () => {
      const draft = await call("POST", "/entries", treasurer, {
        journalId: ids.OD,
        date: "2026-12-01",
        label: "Brouillon oublié",
        lines: [{ accountId: ids.bank, debit: "5.00" }],
      });
      const report = (await call("GET", closing("fy2026"), treasurer)).json();
      expect(report).toMatchObject({ status: "OPEN", canStart: false, canClose: false });
      const codes = report.checks.map((c: { code: string }) => c.code);
      expect(codes).toEqual(expect.arrayContaining(["DRAFTS_REMAIN", "NO_NEXT_YEAR"]));
      expect((await call("POST", closing("fy2026", "/start"), treasurer)).statusCode).toBe(409);
      expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.fy2026! } })).status).toBe("OPEN");

      expect((await call("DELETE", `/entries/${draft.json().id}`, treasurer)).statusCode).toBe(204);
      ids.fy2027 = (await call("POST", "/fiscal-years", treasurer, { label: "2027", start: "2027-01-01", end: "2027-12-31" })).json().id;
    });

    it("montre ce qui sera reporté : deux comptes de bilan et un excédent, avec un avertissement non bloquant", async () => {
      const report = (await call("GET", closing("fy2026"), treasurer)).json();
      expect(report).toMatchObject({ canStart: true, preview: { accountCount: 2, result: { kind: "SURPLUS", amount: "180.00" } } });
      expect(report.checks).toHaveLength(1);
      expect(report.checks[0]).toMatchObject({ code: "UNCLASSIFIED_ACCOUNTS", level: "WARNING" });
    });

    it("ferme à la saisie : plus de comptabilisation, annulable tant que la clôture n'est pas définitive", async () => {
      expect((await call("POST", closing("fy2026", "/start"), treasurer)).json().status).toBe("CLOSING");
      expect((await call("POST", closing("fy2026", "/start"), treasurer)).statusCode).toBe(409);

      const late = await call("POST", "/entries", treasurer, {
        journalId: ids.OD,
        date: "2026-12-20",
        label: "Trop tard",
        lines: [{ accountId: ids.bank, debit: "1.00" }, { accountId: ids.sales, credit: "1.00" }],
      });
      const refused = await call("POST", `/entries/${late.json().id}/post`, treasurer);
      expect(refused.statusCode).toBe(422);
      expect(JSON.stringify(refused.json())).toContain("pas ouvert");

      // La fermeture s'annule : la saisie reprend normalement.
      expect((await call("POST", closing("fy2026", "/cancel"), treasurer)).json().status).toBe("OPEN");
      expect((await call("POST", `/entries/${late.json().id}/post`, treasurer)).statusCode).toBe(200);
      expect((await call("POST", closing("fy2026", "/cancel"), treasurer)).statusCode).toBe(409);
      expect((await call("POST", closing("fy2026", "/start"), treasurer)).json().status).toBe("CLOSING");
    });

    it("refuse de clôturer sans exercice fermé, sans compte de résultat valable, et n'écrit rien", async () => {
      expect((await call("POST", closing("fy2027", "/close"), treasurer, {})).statusCode).toBe(409);

      const counters = await prisma.entryCounter.count();
      for (const body of [
        {},
        { deficitAccountId: ids.deficit },
        { surplusAccountId: ids.charges },
        { surplusAccountId: randomUUID() },
        { surplusAccountId: ids.surplus, extra: true },
      ]) {
        const response = await call("POST", closing("fy2026", "/close"), treasurer, body);
        expect([400, 409], JSON.stringify(body)).toContain(response.statusCode);
      }
      expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.fy2026! } })).status).toBe("CLOSING");
      expect(await prisma.journalEntry.count({ where: { kind: "OPENING" } })).toBe(0);
      expect(await prisma.entryCounter.count()).toBe(counters);
    });

    it("refuse de clôturer tant qu'un brouillon est apparu pendant la fermeture", async () => {
      const draft = await call("POST", "/entries", treasurer, {
        journalId: ids.OD,
        date: "2026-12-25",
        label: "Brouillon tardif",
        lines: [{ accountId: ids.bank, debit: "2.00" }],
      });
      const response = await call("POST", closing("fy2026", "/close"), treasurer, { surplusAccountId: ids.surplus });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("brouillon");
      expect(await sqlError(`UPDATE "FiscalYear" SET "status"='CLOSED' WHERE id='${ids.fy2026}'`)).toContain("brouillons");
      await call("DELETE", `/entries/${draft.json().id}`, treasurer);
    });

    it("clôture : à-nouveaux comptabilisés dans l'exercice suivant, résultat en excédent (CA-12)", async () => {
      const response = await call("POST", closing("fy2026", "/close"), treasurer, { surplusAccountId: ids.surplus });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().result).toEqual({ kind: "SURPLUS", amount: "181.00" });

      const year = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.fy2026! } });
      expect(year.status).toBe("CLOSED");
      expect(year.closedAt).toBeTruthy();

      const opening = (await call("GET", `/entries/${response.json().openingEntryId}`, treasurer)).json();
      expect(opening).toMatchObject({
        kind: "OPENING",
        status: "POSTED",
        journalCode: "AN",
        date: "2027-01-01",
        fiscalYearId: ids.fy2027,
        number: 1,
        totalDebit: "1181.00",
        totalCredit: "1181.00",
      });
      // 512 : 1000 + 300 + 1 − 120 − 50 + 50 (contrepassée) ; seuls les comptes de bilan et le résultat sont reportés.
      const lines = await linesOf(opening.id);
      expect(lines).toHaveLength(3);
      expect(lines).toEqual(expect.arrayContaining(["120 D0.00 C181.00", "102 D0.00 C1000.00", "512 D1181.00 C0.00"]));
    });

    it("fige l'exercice clôturé", async () => {
      const late = await call("POST", "/entries", treasurer, {
        journalId: ids.OD,
        date: "2026-12-30",
        label: "Après clôture",
        lines: [{ accountId: ids.bank, debit: "1.00" }, { accountId: ids.sales, credit: "1.00" }],
      });
      expect(late.statusCode).toBe(409);
      expect(late.json().message).toContain("clôturé");
      expect((await call("POST", closing("fy2026", "/cancel"), treasurer)).statusCode).toBe(409);
      expect((await call("PATCH", `/fiscal-years/${ids.fy2026}`, treasurer, { label: "Altéré" })).statusCode).toBe(409);
      expect(await sqlError(`UPDATE "FiscalYear" SET "label"='Altéré' WHERE id='${ids.fy2026}'`)).toContain("clôturé");
    });

    it("ne reporte jamais deux fois", async () => {
      expect((await call("POST", closing("fy2026", "/close"), treasurer, { surplusAccountId: ids.surplus })).statusCode).toBe(409);
      const duplicate = await sqlError(
        `INSERT INTO "JournalEntry" ("id","fiscalYearId","journalId","date","label","kind","carriesFromId") VALUES (gen_random_uuid(),'${ids.fy2027}','${ids.AN}','2027-01-01','Doublon','OPENING','${ids.fy2026}')`,
      );
      expect(duplicate).toContain("carriesFromId");
      expect(await sqlError(`INSERT INTO "JournalEntry" ("id","fiscalYearId","journalId","date","label","kind","carriesFromId") VALUES (gen_random_uuid(),'${ids.fy2027}','${ids.AN}','2027-01-01','Faux','NORMAL','${ids.fy2026}')`)).toContain("JournalEntry_carry_is_opening");
    });
  });

  describe("exercice 2027 : déficit et ordre des clôtures", () => {
    it("reporte un déficit au débit du compte choisi, soldes de l'à-nouveaux compris", async () => {
      await posted("2027-04-01", ["charges", "500.00"], ["bank", "500.00"]);
      ids.fy2028 = (await call("POST", "/fiscal-years", treasurer, { label: "2028", start: "2028-01-01", end: "2028-12-31" })).json().id;

      // 2028 ne se ferme pas avant 2027, ni directement par SQL.
      const before = (await call("GET", closing("fy2028"), treasurer)).json();
      expect(before.checks.map((c: { code: string }) => c.code)).toContain("PREVIOUS_NOT_CLOSED");
      expect((await call("POST", closing("fy2028", "/start"), treasurer)).statusCode).toBe(409);
      await prisma.fiscalYear.update({ where: { id: ids.fy2028! }, data: { status: "CLOSING" } });
      expect(await sqlError(`UPDATE "FiscalYear" SET "status"='CLOSED' WHERE id='${ids.fy2028}'`)).toContain("précédent");
      await prisma.fiscalYear.update({ where: { id: ids.fy2028! }, data: { status: "OPEN" } });

      expect((await call("POST", closing("fy2027", "/start"), treasurer)).json().status).toBe("CLOSING");
      const missing = await call("POST", closing("fy2027", "/close"), treasurer, { surplusAccountId: ids.surplus });
      expect(missing.statusCode).toBe(409);
      expect(missing.json().message).toContain("déficit");

      const response = await call("POST", closing("fy2027", "/close"), treasurer, { deficitAccountId: ids.deficit });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().result).toEqual({ kind: "DEFICIT", amount: "500.00" });
      const opening = (await call("GET", `/entries/${response.json().openingEntryId}`, treasurer)).json();
      // 512 : 1181 − 500 ; 129 déficit au débit ; 102 et 120 repris de l'à-nouveaux de 2027.
      expect(opening).toMatchObject({ fiscalYearId: ids.fy2028, date: "2028-01-01", totalDebit: "1181.00", totalCredit: "1181.00" });
      expect(await linesOf(opening.id)).toEqual(expect.arrayContaining(["129 D500.00 C0.00", "512 D681.00 C0.00"]));
      expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.fy2027! } })).status).toBe("CLOSED");
    });

    it("refuse de fermer le dernier exercice faute d'exercice suivant", async () => {
      expect((await call("POST", closing("fy2028", "/start"), treasurer)).statusCode).toBe(409);
    });
  });

  it("trace chaque étape dans l'audit", async () => {
    const actions = (await prisma.auditEvent.findMany({ where: { objectType: "FiscalYear" } })).map((e) => e.action);
    for (const action of ["fiscal-year.closing-started", "fiscal-year.closing-cancelled", "fiscal-year.closed"]) {
      expect(actions, action).toContain(action);
    }
  });
});
