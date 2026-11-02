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

describe("Parcours simplifiés : catégories, saisie guidée et vue d'ensemble (ADR 0028, base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let boardMember: Session;
  let reader: Session;
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
    const email = `l-${randomUUID()}@test.invalid`;
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
    boardMember = await userWith("board-member");
    reader = await userWith("reader");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("sur une base vide, la vue d'ensemble dit quoi faire en premier", async () => {
    const response = await call("GET", "/overview", treasurer);
    expect(response.statusCode).toBe(200);
    const overview = response.json();
    expect(overview.setup).toEqual({ fiscalYear: false, accounts: false, financialAccount: false, categories: false });
    expect(overview.todo.map((t: { code: string }) => t.code)).toEqual(["NO_FISCAL_YEAR", "NO_FINANCIAL_ACCOUNT"]);
  });

  it("la vue d'ensemble n'est jamais refusée à un utilisateur connecté et reste filtrée selon ses droits", async () => {
    expect((await call("GET", "/overview")).statusCode).toBe(401);
    const response = await call("GET", "/overview", reader);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cash: null, month: null, todo: [] });
  });

  describe("modèle de démarrage et catégories", () => {
    it("n'est réservé qu'à l'administration de la comptabilité", async () => {
      expect((await call("POST", "/starter-template", boardMember)).statusCode).toBe(403);
      expect((await call("POST", "/starter-template")).statusCode).toBe(401);
    });

    it("installe le plan et les catégories, puis ne change rien en relançant", async () => {
      await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: true } } });
      const first = await call("POST", "/starter-template", treasurer);
      expect(first.statusCode, first.body).toBe(200);
            expect(first.json().accountsCreated).toBeGreaterThan(15);
      expect(first.json().categoriesCreated).toBeGreaterThan(10);

      const second = await call("POST", "/starter-template", treasurer);
      expect(second.json()).toEqual({ accountsCreated: 0, categoriesCreated: 0 });

      const list = (await call("GET", "/operation-categories", boardMember)).json();
      expect(list.length).toBe(first.json().categoriesCreated);
      expect(list.find((c: { label: string }) => c.label === "Assurance")).toMatchObject({ direction: "OUT", account: { number: "616" } });
    });

    it("refuse un compte qui ne correspond pas au sens, un doublon, et désactive sans supprimer", async () => {
      const accounts = (await call("GET", "/accounts", treasurer)).json() as { id: string; number: string }[];
      const id = (n: string) => accounts.find((a) => a.number === n)!.id;
      const wrong = await call("POST", "/operation-categories", treasurer, { direction: "IN", label: "Mauvaise", accountId: id("606") });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json().message).toContain("produits");

      const created = await call("POST", "/operation-categories", treasurer, { direction: "OUT", label: "Abonnement logiciel", hint: "Outils en ligne", accountId: id("606") });
      expect(created.statusCode, created.body).toBe(201);
      const duplicate = await call("POST", "/operation-categories", treasurer, { direction: "OUT", label: "abonnement LOGICIEL", accountId: id("606") });
      expect(duplicate.statusCode).toBe(409);

      const off = await call("PATCH", `/operation-categories/${created.json().id}`, treasurer, { active: false });
      expect(off.json().active).toBe(false);
      expect((await call("GET", "/operation-categories", treasurer)).json().some((c: { id: string }) => c.id === created.json().id)).toBe(false);
      expect((await call("GET", "/operation-categories/all", treasurer)).json().some((c: { id: string }) => c.id === created.json().id)).toBe(true);
      expect(await sqlError(`DELETE FROM "OperationCategory" WHERE id = '${created.json().id}'`)).toContain("ne se supprime pas");
    });
  });

  describe("saisie guidée d'une opération", () => {
    const category = async (label: string) =>
      ((await call("GET", "/operation-categories", treasurer)).json() as { id: string; label: string }[]).find((c) => c.label === label)!.id;

    beforeAll(async () => {
      expect((await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).statusCode).toBe(201);
      const accounts = (await call("GET", "/accounts", treasurer)).json() as { id: string; number: string }[];
      ids.bankAccount = accounts.find((a) => a.number === "512")!.id;
      const bank = await call("POST", "/financial-accounts", treasurer, { name: "Banque", type: "BANK", accountId: ids.bankAccount, openedOn: "2026-01-01", openingBalance: "100.00" });
      expect(bank.statusCode, bank.body).toBe(201);
      ids.fBank = bank.json().id;
    });

    it("enregistre une recette en une action : transaction, écriture à partie double comptabilisée, projet « Fonctionnement » par défaut", async () => {
      const response = await call("POST", "/guided-operations", treasurer, {
        financialAccountId: ids.fBank,
        direction: "IN",
        amount: "30.00",
        date: "2026-03-10",
        label: "Cotisation de Marie",
        categoryId: await category("Cotisations des adhérents"),
      });
      expect(response.statusCode, response.body).toBe(201);
      const result = response.json();
      expect(result).toMatchObject({ posted: true, journalCode: "BQ-1", number: 1 });

      const entry = (await call("GET", `/entries/${result.entryId}`, treasurer)).json();
      expect(entry).toMatchObject({ status: "POSTED", label: "Cotisation de Marie" });
      expect(entry.lines).toMatchObject([
        { accountNumber: "512", debit: "30.00", credit: "0.00" },
        { accountNumber: "756", debit: "0.00", credit: "30.00", allocations: [{ projectCode: expect.any(String), amount: "30.00" }] },
      ]);
      const tx = (await call("GET", `/financial-accounts/${ids.fBank}/transactions`, treasurer)).json().transactions[0];
      expect(tx).toMatchObject({ amount: "30.00", accounting: "POSTED" });
    });

    it("enregistre une dépense en négatif sur la banque et débite la charge", async () => {
      const response = await call("POST", "/guided-operations", treasurer, {
        financialAccountId: ids.fBank,
        direction: "OUT",
        amount: "12.50",
        date: "2026-03-11",
        label: "Assurance",
        categoryId: await category("Assurance"),
      });
      expect(response.statusCode, response.body).toBe(201);
      const entry = (await call("GET", `/entries/${response.json().entryId}`, treasurer)).json();
      expect(entry.lines).toMatchObject([
        { accountNumber: "512", debit: "0.00", credit: "12.50" },
        { accountNumber: "616", debit: "12.50", credit: "0.00" },
      ]);
    });

    it("tout ou rien : une date hors exercice, une catégorie de l'autre sens ou un montant nul ne laissent rien derrière eux", async () => {
      const before = await prisma.transaction.count();
      const entriesBefore = await prisma.journalEntry.count();
      const base = { financialAccountId: ids.fBank, direction: "OUT", amount: "5.00", date: "2026-03-12", label: "Test", categoryId: await category("Assurance") };
      expect((await call("POST", "/guided-operations", treasurer, { ...base, date: "2030-01-01" })).statusCode).toBe(409);
      expect((await call("POST", "/guided-operations", treasurer, { ...base, categoryId: await category("Dons") })).statusCode).toBe(409);
      expect((await call("POST", "/guided-operations", treasurer, { ...base, amount: "0.00" })).statusCode).toBe(400);
      expect((await call("POST", "/guided-operations", treasurer, { ...base, amount: "-5.00" })).statusCode).toBe(400);
      expect(await prisma.transaction.count()).toBe(before);
      expect(await prisma.journalEntry.count()).toBe(entriesBefore);
    });

    it("sans le droit de comptabiliser, prépare un brouillon au lieu de refuser ; refuse sans droit de saisie", async () => {
      const role = await prisma.role.create({
        data: { key: `saisie-${randomUUID()}`, name: `Saisie ${randomUUID()}`, permissions: ["financial-accounts:view", "transactions:manage", "entries:create", "entries:view"], requiresMfa: false },
      });
      const limitedUser = await users.createUser({ email: `s-${randomUUID()}@test.invalid`, displayName: "S", password: PASSWORD });
      await prisma.roleAssignment.create({ data: { userId: limitedUser.id, roleId: role.id } });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: limitedUser.email, password: PASSWORD }, remoteAddress: "198.51.100.77" });
      const limited = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };

      const response = await call("POST", "/guided-operations", limited, {
        financialAccountId: ids.fBank,
        direction: "OUT",
        amount: "8.00",
        date: "2026-03-13",
        label: "Timbres",
        categoryId: await category("Courrier et téléphone"),
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ posted: false, number: null });
      expect((await call("GET", `/entries/${response.json().entryId}`, treasurer)).json().status).toBe("DRAFT");

      expect((await call("POST", "/guided-operations", reader, { financialAccountId: ids.fBank, direction: "OUT", amount: "1.00", date: "2026-03-13", label: "x", categoryId: await category("Assurance") })).statusCode).toBe(403);
    });

    it("la vue d'ensemble compte l'argent, le mois et les brouillons à relire", async () => {
      const overview = (await call("GET", "/overview", treasurer)).json();
      expect(overview.setup).toEqual({ fiscalYear: true, accounts: true, financialAccount: true, categories: true });
      expect(overview.cash.total).toBe("109.50");
      expect(overview.todo.map((t: { code: string }) => t.code)).toContain("DRAFTS");
      expect(overview.todo.find((t: { code: string }) => t.code === "TO_VERIFY")).toMatchObject({ level: "INFO" });
    });

    it("l'opération s'annule par contrepassation, comme toute écriture comptabilisée", async () => {
      const response = await call("POST", "/guided-operations", treasurer, {
        financialAccountId: ids.fBank,
        direction: "OUT",
        amount: "4.00",
        date: "2026-03-14",
        label: "Erreur de saisie",
        categoryId: await category("Assurance"),
      });
      const reversed = await call("POST", `/entries/${response.json().entryId}/reverse`, treasurer, { date: "2026-03-14" });
      expect(reversed.statusCode, reversed.body).toBe(201);
    });
  });
});
