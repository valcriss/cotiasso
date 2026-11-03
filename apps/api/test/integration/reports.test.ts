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

describe("États de lecture : grand livre, balance, livre-journal (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let boardMember: Session;
  let reader: Session;
  const ids: Record<string, string> = {};

  const call = (method: "GET" | "POST" | "PUT", url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `r-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "R", password: PASSWORD });
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

  const entry = async (date: string, label: string, debit: [string, string], credit: [string, string], post = true) => {
    const created = await call("POST", "/entries", treasurer, {
      journalId: ids.OD,
      date,
      label,
      lines: [
        { accountId: ids[debit[0]], debit: debit[1] },
        { accountId: ids[credit[0]], credit: credit[1] },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    if (!post) return created.json();
    const posted = await call("POST", `/entries/${created.json().id}/post`, treasurer, {});
    expect(posted.statusCode, posted.body).toBe(200);
    return posted.json();
  };
  const get = (url: string, session = treasurer) => call("GET", url, session);
  const q = (path: string, extra = "") => `/reports/${path}?fiscalYearId=${ids.fy2026}${extra}`;

  it("refuse d'écraser une prévision budgétaire modifiée entre-temps", async () => {
    const url = `/annual-budgets/${ids.fy2027}`;
    const estimate = { code: "PRO_COTIS", label: "Cotisations", expected: "0.00" };
    const results = await Promise.all([
      call("PUT", url + "/estimate", treasurer, { ...estimate, amount: "100.00" }),
      call("PUT", url + "/estimate", treasurer, { ...estimate, amount: "200.00" }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const budget = await get(url);
    expect(budget.json().history).toHaveLength(1);
    expect(budget.json().estimates).toEqual(results.find((result) => result.statusCode === 200)!.json().estimates);
  });

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
    reader = await userWith("reader");

    for (const journal of await prisma.journal.findMany()) ids[journal.code] = journal.id;
    for (const [key, number, label] of [
      ["bank", "512", "Banque"],
      ["fonds", "102", "Fonds associatifs"],
      ["sales", "706", "Prestations"],
      ["charges", "606", "Achats"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.fy2026 = (await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).json().id;
    ids.fy2027 = (await call("POST", "/fiscal-years", treasurer, { label: "2027", start: "2027-01-01", end: "2027-12-31" })).json().id;

    await entry("2026-01-10", "Apport", ["bank", "1000.00"], ["fonds", "1000.00"]);
    await entry("2026-03-15", "Cotisations", ["bank", "300.00"], ["sales", "300.00"]);
    await entry("2026-06-01", "Fournitures", ["charges", "120.00"], ["bank", "120.00"]);
    const wrong = await entry("2026-07-01", "Erreur", ["charges", "50.00"], ["bank", "50.00"]);
    await call("POST", `/entries/${wrong.id}/reverse`, treasurer, { date: "2026-07-02" });
    // Un brouillon ne figure jamais dans les états.
    await entry("2026-08-01", "Brouillon", ["bank", "5.00"], ["sales", "5.00"], false);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("exige entries:view : les états détaillent les écritures", async () => {
    for (const path of ["ledger", "trial-balance", "journal"]) {
      expect((await call("GET", q(path))).statusCode).toBe(401);
      expect((await get(q(path), reader)).statusCode, path).toBe(403);
      expect((await get(q(path), boardMember)).statusCode, path).toBe(200);
    }
  });

  it("refuse des paramètres invalides ou un exercice inconnu", async () => {
    expect((await get("/reports/ledger")).statusCode).toBe(400);
    expect((await get("/reports/ledger?fiscalYearId=pas-un-uuid")).statusCode).toBe(400);
    expect((await get(q("ledger", "&prefix=9"))).statusCode).toBe(400);
    expect((await get(q("ledger", "&prefix=51%27%3B"))).statusCode).toBe(400);
    expect((await get(q("ledger", "&from=hier"))).statusCode).toBe(400);
    expect((await get(q("ledger", "&inconnu=1"))).statusCode).toBe(400);
    expect((await get(`/reports/trial-balance?fiscalYearId=${randomUUID()}`)).statusCode).toBe(404);
  });

  describe("grand livre", () => {
    it("détaille un compte avec son solde cumulé, contrepassation comprise, sans le brouillon", async () => {
      const { accounts } = (await get(q("ledger", `&accountId=${ids.bank}`))).json();
      expect(accounts).toHaveLength(1);
      const bank = accounts[0];
      expect(bank).toMatchObject({ number: "512", totalDebit: "1350.00", totalCredit: "170.00", balance: "1180.00" });
      expect(bank.lines.map((l: { date: string; debit: string; credit: string; balance: string }) => [l.date, l.debit, l.credit, l.balance])).toEqual([
        ["2026-01-10", "1000.00", "0.00", "1000.00"],
        ["2026-03-15", "300.00", "0.00", "1300.00"],
        ["2026-06-01", "0.00", "120.00", "1180.00"],
        ["2026-07-01", "0.00", "50.00", "1130.00"],
        ["2026-07-02", "50.00", "0.00", "1180.00"],
      ]);
      expect(bank.lines[0]).toMatchObject({ journalCode: "OD", entryNumber: 1, entryLabel: "Apport" });
    });

    it("filtre par classe de comptes et par période", async () => {
      const charges = (await get(q("ledger", "&prefix=6"))).json().accounts;
      expect(charges.map((a: { number: string }) => a.number)).toEqual(["606"]);
      expect(charges[0]).toMatchObject({ totalDebit: "170.00", totalCredit: "50.00", balance: "120.00" });

      const spring = (await get(q("ledger", "&to=2026-03-31"))).json().accounts;
      expect(spring.map((a: { number: string }) => a.number)).toEqual(["102", "512", "706"]);
      expect(spring.find((a: { number: string }) => a.number === "512").balance).toBe("1300.00");
      expect((await get(q("ledger", "&from=2026-12-01"))).json().accounts).toEqual([]);
    });
  });

  describe("balance", () => {
    it("totalise débit, crédit et soldes par compte, et vérifie l'équilibre", async () => {
      const balance = (await get(q("trial-balance"))).json();
      expect(balance.rows.map((r: { number: string }) => r.number)).toEqual(["102", "512", "606", "706"]);
      const byNumber = Object.fromEntries(balance.rows.map((r: { number: string }) => [r.number, r]));
      expect(byNumber["512"]).toMatchObject({ debit: "1350.00", credit: "170.00", debitBalance: "1180.00", creditBalance: "0.00" });
      expect(byNumber["102"]).toMatchObject({ debit: "0.00", credit: "1000.00", debitBalance: "0.00", creditBalance: "1000.00" });
      expect(byNumber["606"]).toMatchObject({ debit: "170.00", credit: "50.00", debitBalance: "120.00" });
      expect(balance.totals).toEqual({ debit: "1520.00", credit: "1520.00", debitBalance: "1300.00", creditBalance: "1300.00" });
      expect(balance.balanced).toBe(true);
    });

    it("se restreint à une période ou une classe", async () => {
      const upTo = (await get(q("trial-balance", "&to=2026-01-31"))).json();
      expect(upTo.rows.map((r: { number: string }) => r.number)).toEqual(["102", "512"]);
      expect(upTo.totals.debit).toBe("1000.00");
      const income = (await get(q("trial-balance", "&prefix=7"))).json();
      expect(income.rows).toHaveLength(1);
      expect(income.balanced).toBe(false);
    });

    it("reste cohérent avec le grand livre : mêmes lignes, même solde", async () => {
      const balance = (await get(q("trial-balance"))).json();
      const ledger = (await get(q("ledger"))).json().accounts;
      for (const row of balance.rows) {
        const account = ledger.find((a: { number: string }) => a.number === row.number);
        expect(account.totalDebit, row.number).toBe(row.debit);
        expect(account.totalCredit, row.number).toBe(row.credit);
      }
    });
  });

  describe("livre-journal", () => {
    it("liste les écritures comptabilisées ou contrepassées dans l'ordre de numérotation, avec leurs totaux", async () => {
      const { entries } = (await get(q("journal", `&journalId=${ids.OD}`))).json();
      expect(entries.map((e: { number: number; status: string }) => [e.number, e.status])).toEqual([
        [1, "POSTED"],
        [2, "POSTED"],
        [3, "POSTED"],
        [4, "REVERSED"],
        [5, "POSTED"],
      ]);
      expect(entries[3]).toMatchObject({ label: "Erreur", totalDebit: "50.00", totalCredit: "50.00" });
      expect(entries[4]).toMatchObject({ kind: "REVERSAL", date: "2026-07-02" });
      expect(entries[0].lines).toEqual([
        { accountNumber: "512", accountLabel: "Banque", label: null, debit: "1000.00", credit: "0.00" },
        { accountNumber: "102", accountLabel: "Fonds associatifs", label: null, debit: "0.00", credit: "1000.00" },
      ]);
    });

    it("filtre par journal et par période, et n'inclut aucun brouillon", async () => {
      expect((await get(q("journal", `&journalId=${ids.AC}`))).json().entries).toEqual([]);
      const june = (await get(q("journal", "&from=2026-06-01&to=2026-06-30"))).json().entries;
      expect(june.map((e: { label: string }) => e.label)).toEqual(["Fournitures"]);
      const all = (await get(q("journal"))).json().entries;
      expect(all.map((e: { label: string }) => e.label)).not.toContain("Brouillon");
    });
  });

  it("un exercice sans écriture donne des états vides, pas une erreur", async () => {
    const empty = `fiscalYearId=${ids.fy2027}`;
    expect((await get(`/reports/ledger?${empty}`)).json()).toEqual({ accounts: [] });
    expect((await get(`/reports/journal?${empty}`)).json()).toEqual({ entries: [] });
    const balance = (await get(`/reports/trial-balance?${empty}`)).json();
    expect(balance).toMatchObject({ rows: [], balanced: true });
  });
});
