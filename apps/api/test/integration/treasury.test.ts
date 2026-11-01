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

describe("Trésorerie : comptes financiers, soldes, relevés et transactions (base vierge)", () => {
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
    const email = `t-${randomUUID()}@test.invalid`;
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
      return String((error as Error).message);
    }
    return null;
  };

  const newAccount = (overrides: Record<string, unknown> = {}) => ({
    name: "Compte courant",
    type: "BANK",
    accountId: ids.bank,
    openedOn: "2026-01-01",
    openingBalance: "1000.00",
    ...overrides,
  });
  const tx = (amount: string, overrides: Record<string, unknown> = {}) => ({
    operationDate: "2026-02-10",
    amount,
    label: "Mouvement",
    ...overrides,
  });
  const addTx = async (accountId: string | undefined, body: object) => {
    const response = await call("POST", `/financial-accounts/${accountId}/transactions`, treasurer, body);
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
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");

    for (const [key, number, label] of [
      ["bank", "512", "Banque principale"],
      ["bank2", "5121", "Banque secondaire"],
      ["cash", "530", "Caisse"],
      ["third", "411", "Usagers"],
      ["sales", "706", "Prestations"],
      ["charges", "606", "Achats"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.project = (await call("POST", "/projects", treasurer, { code: "ATELIERS", name: "Ateliers" })).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("comptes financiers", () => {
    it("réserve la consultation à financial-accounts:view et la gestion à settings.accounting:admin", async () => {
      expect((await call("GET", "/financial-accounts")).statusCode).toBe(401);
      expect((await call("GET", "/financial-accounts", reader)).statusCode).toBe(403);
      expect((await call("GET", "/financial-accounts", boardMember)).statusCode).toBe(200);
      expect((await call("POST", "/financial-accounts", boardMember, newAccount())).statusCode).toBe(403);
    });

    it("crée une banque avec son journal BQ-1, puis une caisse avec CA-1, et numérote les suivants", async () => {
      const bank = await call("POST", "/financial-accounts", treasurer, newAccount({ reference: "FR76 …1234" }));
      expect(bank.statusCode, bank.body).toBe(201);
      expect(bank.json()).toMatchObject({ name: "Compte courant", type: "BANK", journalCode: "BQ-1", accountNumber: "512", currency: "EUR", reference: "FR76 …1234", archivedOn: null });
      ids.fBank = bank.json().id;

      const cash = await call("POST", "/financial-accounts", treasurer, newAccount({ name: "Caisse", type: "CASH", accountId: ids.cash, openingBalance: "50.00" }));
      expect(cash.json()).toMatchObject({ journalCode: "CA-1", type: "CASH" });
      ids.fCash = cash.json().id;

      const second = await call("POST", "/financial-accounts", treasurer, newAccount({ name: "Livret", accountId: ids.bank2 }));
      expect(second.json().journalCode).toBe("BQ-2");
      ids.fBank2 = second.json().id;

      const journals = (await call("GET", "/journals", treasurer)).json().map((j: { code: string; type: string }) => `${j.code}:${j.type}`);
      expect(journals).toEqual(expect.arrayContaining(["BQ-1:BANK", "BQ-2:BANK", "CA-1:CASH"]));
    });

    it("refuse un compte comptable hors classe 5, déjà utilisé, inconnu, et des champs invalides", async () => {
      const fails = async (overrides: Record<string, unknown>, status: number) =>
        expect((await call("POST", "/financial-accounts", treasurer, newAccount(overrides))).statusCode, JSON.stringify(overrides)).toBe(status);
      await fails({ accountId: ids.third }, 409);
      await fails({ accountId: ids.bank }, 409);
      await fails({ accountId: randomUUID() }, 404);
      await fails({ name: " " }, 400);
      await fails({ type: "LIVRET" }, 400);
      await fails({ openedOn: "2026-02-30" }, 400);
      await fails({ openingBalance: "12,5" }, 400);
      await fails({ currency: "USD" }, 400);
      // Aucun journal orphelin n'a été créé par ces refus.
      expect((await prisma.journal.count({ where: { code: { startsWith: "BQ-" } } }))).toBe(2);
    });

    it("garde les rattachements définitifs et ne supprime jamais un compte (déclencheurs SQL)", async () => {
      const id = ids.fBank;
      expect(await sqlError(`UPDATE "FinancialAccount" SET "accountId"='${ids.third}' WHERE id='${id}'`)).toContain("ne changent pas");
      expect(await sqlError(`UPDATE "FinancialAccount" SET "type"='CASH' WHERE id='${id}'`)).toContain("ne changent pas");
      expect(await sqlError(`DELETE FROM "FinancialAccount"`)).toContain("on l'archive");
      expect(await sqlError(`TRUNCATE "FinancialAccount" CASCADE`)).toContain("TRUNCATE refusé");
      expect(await sqlError(`INSERT INTO "FinancialAccount" ("id","name","type","accountId","journalId","openedOn") SELECT gen_random_uuid(),'X','BANK','${ids.third}',"id",'2026-01-01' FROM "Journal" WHERE "code"='OD'`)).toContain("classe 5");
      expect(await sqlError(`INSERT INTO "FinancialAccount" ("id","name","type","accountId","journalId","openedOn") SELECT gen_random_uuid(),'X','BANK','${ids.sales}',"id",'2026-01-01' FROM "Journal" WHERE "code"='OD'`)).toContain("classe 5");
    });

    it("modifie le nom et la référence, mais pas le solde d'ouverture une fois des transactions saisies", async () => {
      expect((await call("PATCH", `/financial-accounts/${ids.fBank}`, treasurer, { name: "Compte courant principal", openingBalance: "900.00" })).statusCode).toBe(200);
      await addTx(ids.fBank, tx("100.00", { label: "Premier encaissement" }));
      const refused = await call("PATCH", `/financial-accounts/${ids.fBank}`, treasurer, { openingBalance: "1.00" });
      expect(refused.statusCode).toBe(409);
      expect(await sqlError(`UPDATE "FinancialAccount" SET "openingBalance"=1 WHERE id='${ids.fBank}'`)).toContain("Le solde et la date");
      expect((await call("PATCH", `/financial-accounts/${ids.fBank}`, treasurer, { type: "CASH" })).statusCode).toBe(400);
    });
  });

  describe("soldes", () => {
    it("distingue solde d'ouverture, solde calculé, solde comptable et solde de relevé", async () => {
      // Une écriture comptabilisée sur le compte 512 : 400 en banque contre un produit.
      const year = (await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).json();
      const od = (await call("GET", "/journals", treasurer)).json().find((j: { code: string }) => j.code === "OD");
      const entry = (
        await call("POST", "/entries", treasurer, {
          journalId: od.id,
          date: "2026-02-15",
          label: "Cotisations",
          lines: [{ accountId: ids.bank, debit: "400.00" }, { accountId: ids.sales, credit: "400.00" }],
        })
      ).json();
      expect((await call("POST", `/entries/${entry.id}/post`, treasurer, {})).statusCode).toBe(200);
      expect(year.id).toBeTruthy();

      await addTx(ids.fBank, tx("-30.50", { operationDate: "2026-03-05", label: "Frais" }));
      const { balances } = (await call("GET", `/financial-accounts/${ids.fBank}`, boardMember)).json();
      // Ouverture 900 + 100 − 30,50 ; la comptabilité ne connaît que l'écriture de 400.
      expect(balances).toMatchObject({ opening: "900.00", computed: "969.50", accounting: "400.00", lastStatement: null });
    });

    it("enregistre un relevé en ajout seul et mesure l'écart sans prétendre rapprocher", async () => {
      expect((await call("POST", `/financial-accounts/${ids.fBank}/statements`, boardMember, { periodStart: "2026-03-01", periodEnd: "2026-03-31", closingBalance: "950.00" })).statusCode).toBe(403);
      const recorded = await call("POST", `/financial-accounts/${ids.fBank}/statements`, treasurer, { periodStart: "2026-03-01", periodEnd: "2026-03-31", closingBalance: "950.00" });
      expect(recorded.statusCode, recorded.body).toBe(201);
      expect((await call("POST", `/financial-accounts/${ids.fBank}/statements`, treasurer, { periodStart: "2026-04-01", periodEnd: "2026-03-01", closingBalance: "1" })).statusCode).toBe(400);

      const { balances } = (await call("GET", `/financial-accounts/${ids.fBank}`, treasurer)).json();
      // Calculé au 31/03 : 900 + 100 − 30,50 = 969,50 ; relevé 950,00 ; écart −19,50.
      expect(balances.lastStatement).toEqual({ periodEnd: "2026-03-31", closingBalance: "950.00", computedAtEnd: "969.50", gap: "-19.50" });
      expect((await call("GET", `/financial-accounts/${ids.fBank}/statements`, boardMember)).json()).toHaveLength(1);

      expect(await sqlError(`UPDATE "BankStatement" SET "closingBalance"=1`)).toContain("ajout seul");
      expect(await sqlError(`DELETE FROM "BankStatement"`)).toContain("ajout seul");
      // Refusé par le déclencheur, ou par la clé étrangère des rapprochements qui référencent les relevés.
      expect(await sqlError(`TRUNCATE "BankStatement"`)).not.toBeNull();
    });
  });

  describe("transactions", () => {
    it("réserve la saisie à transactions:manage mais laisse la consultation à financial-accounts:view", async () => {
      expect((await call("POST", `/financial-accounts/${ids.fCash}/transactions`, boardMember, tx("10.00"))).statusCode).toBe(403);
      expect((await call("GET", `/financial-accounts/${ids.fCash}/transactions`, boardMember)).statusCode).toBe(200);
      expect((await call("GET", `/financial-accounts/${ids.fCash}/transactions`, reader)).statusCode).toBe(403);
      expect((await call("GET", `/financial-accounts/${randomUUID()}/transactions`, treasurer)).statusCode).toBe(404);
    });

    it("saisit des encaissements et décaissements signés, refuse les montants et dates invalides", async () => {
      const income = await addTx(ids.fCash, tx("25.00", { label: "Vente de gâteaux", projectId: ids.project, counterpartAccountId: ids.sales }));
      expect(income).toMatchObject({ amount: "25.00", origin: "MANUAL", projectCode: "ATELIERS", counterpartAccountNumber: "706", qualified: true, version: 1 });
      const expense = await addTx(ids.fCash, tx("-12.40", { label: "Courses", reference: "TICKET-7" }));
      expect(expense).toMatchObject({ amount: "-12.40", qualified: false, reference: "TICKET-7" });

      for (const body of [tx("0.00"), tx("12,5"), tx("1e3"), tx("10.00", { operationDate: "demain" }), tx("10.00", { label: " " }), { ...tx("10.00"), origin: "IMPORT" }]) {
        expect((await call("POST", `/financial-accounts/${ids.fCash}/transactions`, treasurer, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it("refuse une transaction avant l'ouverture, avec une contrepartie égale au compte de trésorerie, sur un projet archivé ou inconnu", async () => {
      const refused = (body: object) => call("POST", `/financial-accounts/${ids.fCash}/transactions`, treasurer, body);
      expect((await refused(tx("5.00", { operationDate: "2025-12-31" }))).statusCode).toBe(409);
      expect((await refused(tx("5.00", { counterpartAccountId: ids.cash }))).statusCode).toBe(409);
      expect((await refused(tx("5.00", { projectId: randomUUID() }))).statusCode).toBe(409);
      const archived = (await call("POST", "/projects", treasurer, { code: "VIEUX", name: "Vieux", status: "ARCHIVED" })).json();
      const response = await refused(tx("5.00", { projectId: archived.id }));
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("archivé");
    });

    it("modifie une transaction manuelle avec contrôle de version optimiste", async () => {
      const created = await addTx(ids.fCash, tx("-8.00", { label: "À corriger" }));
      const updated = await call("PATCH", `/transactions/${created.id}`, treasurer, { version: 1, label: "Corrigée", amount: "-8.50", projectId: ids.project });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json()).toMatchObject({ label: "Corrigée", amount: "-8.50", projectCode: "ATELIERS", version: 2 });
      expect((await call("PATCH", `/transactions/${created.id}`, treasurer, { version: 1, label: "Périmée" })).statusCode).toBe(409);
      expect((await call("PATCH", `/transactions/${created.id}`, treasurer, { label: "Sans version" })).statusCode).toBe(400);
      expect((await call("PATCH", `/transactions/${created.id}`, treasurer, { version: 2, financialAccountId: ids.fBank })).statusCode).toBe(400);
      expect((await call("PATCH", `/transactions/${randomUUID()}`, treasurer, { version: 1, label: "?" })).statusCode).toBe(404);
      expect((await call("DELETE", `/transactions/${created.id}`, treasurer)).statusCode).toBe(204);
    });

    it("conserve les données financières d'une transaction importée et en garantit l'unicité par compte et source", async () => {
      const insert = (account: string, external: string) =>
        `INSERT INTO "Transaction" ("id","financialAccountId","operationDate","amount","label","origin","source","externalId") VALUES (gen_random_uuid(),'${account}','2026-04-01',-20,'Prélèvement','IMPORT','OFX','${external}')`;
      expect(await sqlError(insert(ids.fCash!, "FIT-1"))).toBeNull();
      expect(await sqlError(insert(ids.fCash!, "FIT-1"))).toContain("Transaction_external_unique");
      // Même identifiant sur un autre compte : autorisé (l'unicité porte sur le compte et la source).
      expect(await sqlError(insert(ids.fBank!, "FIT-1"))).toBeNull();
      expect(await sqlError(`INSERT INTO "Transaction" ("id","financialAccountId","operationDate","amount","label","origin") VALUES (gen_random_uuid(),'${ids.fCash}','2026-04-01',-1,'Import sans identifiant','IMPORT')`)).toContain("Transaction_import_has_external_id");
      expect(await sqlError(`INSERT INTO "Transaction" ("id","financialAccountId","operationDate","amount","label","externalId") VALUES (gen_random_uuid(),'${ids.fCash}','2026-04-01',-1,'Source manquante','X')`)).toContain("Transaction_external_pair");

      const imported = (await call("GET", `/financial-accounts/${ids.fCash}/transactions?origin=IMPORT`, treasurer)).json().transactions[0];
      expect(imported).toMatchObject({ origin: "IMPORT", externalId: "FIT-1", amount: "-20.00" });
      expect((await call("PATCH", `/transactions/${imported.id}`, treasurer, { version: 1, amount: "-21.00" })).statusCode).toBe(409);
      expect((await call("PATCH", `/transactions/${imported.id}`, treasurer, { version: 1, operationDate: "2026-04-02" })).statusCode).toBe(409);
      const qualified = await call("PATCH", `/transactions/${imported.id}`, treasurer, { version: 1, counterpartAccountId: ids.charges, projectId: ids.project });
      expect(qualified.statusCode, qualified.body).toBe(200);
      expect(qualified.json()).toMatchObject({ qualified: true, amount: "-20.00" });
      expect((await call("DELETE", `/transactions/${imported.id}`, treasurer)).statusCode).toBe(409);
      expect(await sqlError(`DELETE FROM "Transaction" WHERE "origin"='IMPORT'`)).toContain("importée");
      expect(await sqlError(`UPDATE "Transaction" SET "amount"=-99 WHERE "origin"='IMPORT'`)).toContain("transaction importée");
      expect(await sqlError(`TRUNCATE "Transaction" CASCADE`)).toContain("TRUNCATE refusé");
    });

    it("filtre par période, texte, origine, qualification, projet et montant, et pagine", async () => {
      const list = async (query: string) => (await call("GET", `/financial-accounts/${ids.fCash}/transactions${query}`, boardMember)).json();
      const all = (await list("")).transactions;
      expect(all).toHaveLength(3);
      expect(all.map((t: { operationDate: string }) => t.operationDate)).toEqual([...all.map((t: { operationDate: string }) => t.operationDate)].sort().reverse());

      expect((await list("?q=gâteaux")).transactions.map((t: { label: string }) => t.label)).toEqual(["Vente de gâteaux"]);
      expect((await list("?q=ticket")).transactions).toHaveLength(1);
      expect((await list("?from=2026-04-01")).transactions.every((t: { operationDate: string }) => t.operationDate >= "2026-04-01")).toBe(true);
      expect((await list("?to=2026-03-01")).transactions.every((t: { operationDate: string }) => t.operationDate <= "2026-03-01")).toBe(true);
      expect((await list("?origin=MANUAL")).transactions.every((t: { origin: string }) => t.origin === "MANUAL")).toBe(true);
      expect((await list("?qualified=true")).transactions.every((t: { qualified: boolean }) => t.qualified)).toBe(true);
      expect((await list("?qualified=false")).transactions.every((t: { qualified: boolean }) => !t.qualified)).toBe(true);
      expect((await list(`?projectId=${ids.project}`)).transactions.length).toBeGreaterThanOrEqual(2);

      // Montant en valeur absolue : 15 à 30 retient +25 et −20, mais ni −12,40 ni la ligne de 5.
      const between = (await list("?minAmount=15&maxAmount=30")).transactions.map((t: { amount: string }) => t.amount).sort();
      expect(between).toEqual(["-20.00", "25.00"]);

      const first = await list("?limit=2");
      expect(first.transactions).toHaveLength(2);
      expect(first.next).toBeTruthy();
      const second = await list(`?limit=2&after=${first.next}`);
      expect(second.transactions.map((t: { id: string }) => t.id)).not.toContain(first.transactions[0].id);
      expect((await call("GET", `/financial-accounts/${ids.fCash}/transactions?limit=0`, treasurer)).statusCode).toBe(400);
      expect((await call("GET", `/financial-accounts/${ids.fCash}/transactions?inconnu=1`, treasurer)).statusCode).toBe(400);
    });
  });

  it("archive un compte : plus de transaction, plus de réactivation, jamais de suppression", async () => {
    expect((await call("PATCH", `/financial-accounts/${ids.fBank2}`, treasurer, { archived: false })).statusCode).toBe(400);
    const archived = await call("PATCH", `/financial-accounts/${ids.fBank2}`, treasurer, { archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().archivedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await call("PATCH", `/financial-accounts/${ids.fBank2}`, treasurer, { archived: true })).statusCode).toBe(409);
    const refused = await call("POST", `/financial-accounts/${ids.fBank2}/transactions`, treasurer, tx("5.00"));
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("archivé");
    expect(await sqlError(`UPDATE "FinancialAccount" SET "archivedOn"=NULL WHERE id='${ids.fBank2}'`)).toContain("ne se réactive pas");
    // Les comptes archivés passent après les comptes actifs.
    const names = (await call("GET", "/financial-accounts", treasurer)).json().map((a: { name: string }) => a.name);
    expect(names[names.length - 1]).toBe("Livret");
  });

  it("trace les opérations de trésorerie dans l'audit", async () => {
    const actions = new Set((await prisma.auditEvent.findMany()).map((e) => e.action));
    for (const action of ["financial-account.created", "financial-account.updated", "financial-account.archived", "bank-statement.recorded", "transaction.created", "transaction.updated", "transaction.deleted"]) {
      expect(actions.has(action), action).toBe(true);
    }
  });
});
