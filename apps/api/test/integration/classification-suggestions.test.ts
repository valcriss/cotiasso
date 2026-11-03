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

describe("Suggestions de classement (ADR 0019 amendé)", () => {
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
      ["bank3", "5122", "Banque tertiaire"],
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

  const list = async (accountId: string, session = treasurer) => {
    const response = await call("GET", `/financial-accounts/${accountId}/transactions?limit=100`, session);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().transactions as { id: string; label: string; suggestion: null | { counterpartAccountNumber: string; counterpartAccountLabel: string; projectCode: string | null; basedOn: { label: string; operationDate: string }; matches: number }; counterpartAccountId: string | null }[];
  };
  const account = async (name: string, accountId: string) => {
    const response = await call("POST", "/financial-accounts", treasurer, { name, type: "BANK", accountId, openedOn: "2026-01-01", openingBalance: "0.00" });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  };
  const add = async (accountId: string, amount: string, label: string, over: Record<string, unknown> = {}) => {
    const response = await call("POST", `/financial-accounts/${accountId}/transactions`, treasurer, { operationDate: "2026-03-10", amount, label, ...over });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  };

  it("propose le classement choisi pour un libellé identique, avec sa source, sans rien modifier", async () => {
    const bank = await account("Banque A", ids.bank!);
    await add(bank, "-50.00", "PRLV SEPA MAIF 0910", { operationDate: "2026-09-12", counterpartAccountId: ids.charges, projectId: ids.project });
    const open = await add(bank, "-52.00", "Prlv Sepa MAIF 1110", { operationDate: "2026-11-12" });
    const before = await prisma.transaction.findUniqueOrThrow({ where: { id: open.id } });

    const found = (await list(bank)).find((t) => t.id === open.id)!;
    expect(found.suggestion).toMatchObject({ counterpartAccountNumber: "606", counterpartAccountLabel: "Achats", projectCode: "ATELIERS", matches: 1 });
    expect(found.suggestion!.basedOn).toEqual({ label: "PRLV SEPA MAIF 0910", operationDate: "2026-09-12" });

    // Lire ne classe rien : la proposition n'est jamais appliquée seule.
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: open.id } });
    expect(after.counterpartAccountId).toBeNull();
    expect(after.version).toBe(before.version);
  });

  it("ne propose rien quand c'est ambigu, de l'autre sens, d'un autre compte, déjà classé ou sans précédent", async () => {
    const bank = await account("Banque B", ids.bank2!);
    const other = await account("Banque C", ids.cash!);
    await add(bank, "-10.00", "Boulangerie du coin", { counterpartAccountId: ids.charges });
    await add(bank, "-12.00", "Boulangerie du coin", { counterpartAccountId: ids.sales }); // contradictoire
    await add(bank, "30.00", "Vente de gâteaux", { counterpartAccountId: ids.sales });
    await add(other, "-20.00", "Papeterie centrale", { counterpartAccountId: ids.charges }); // autre compte financier
    const ambiguous = await add(bank, "-11.00", "Boulangerie du coin");
    const reverseSense = await add(bank, "-30.00", "Vente de gâteaux"); // dépense du même nom qu'une vente
    const elsewhere = await add(bank, "-21.00", "Papeterie centrale");
    const unknown = await add(bank, "-5.00", "Fournisseur jamais vu");
    const classified = await add(bank, "-13.00", "Boulangerie du coin", { counterpartAccountId: ids.charges });

    const byId = new Map((await list(bank)).map((t) => [t.id, t]));
    for (const t of [ambiguous, reverseSense, elsewhere, unknown, classified]) expect(byId.get(t.id)!.suggestion, t.id).toBeNull();
  });

  it("accepte des propositions d'un coup, tout ou rien, après les avoir recalculées", async () => {
    const bank = await account("Banque D", ids.bank3!);
    await add(bank, "-50.00", "Assurance MAIF 01", { counterpartAccountId: ids.charges });
    await add(bank, "100.00", "Cotisation Dupont", { counterpartAccountId: ids.sales });
    const a = await add(bank, "-51.00", "Assurance MAIF 02");
    const b = await add(bank, "120.00", "Cotisation Dupont mars");
    const c = await add(bank, "120.00", "Cotisation Dupont");
    const none = await add(bank, "-9.00", "Sans précédent");

    // Un identifiant sans proposition fait tout refuser : rien n'est classé, même pour les autres.
    const refused = await call("POST", `/financial-accounts/${bank}/transactions/accept-suggestions`, treasurer, { transactionIds: [a.id, none.id] });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message ?? refused.body).toContain("n'a plus de proposition");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: a.id } })).counterpartAccountId).toBeNull();

    const ok = await call("POST", `/financial-accounts/${bank}/transactions/accept-suggestions`, treasurer, { transactionIds: [a.id, c.id] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ updated: 2 });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: a.id } })).counterpartAccountId).toBe(ids.charges);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: c.id } })).counterpartAccountId).toBe(ids.sales);
    // « Cotisation Dupont mars » est un autre libellé : il n'avait pas de proposition et reste à classer.
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: b.id } })).counterpartAccountId).toBeNull();

    // Déjà classé : plus de proposition, donc refus, sans double application.
    expect((await call("POST", `/financial-accounts/${bank}/transactions/accept-suggestions`, treasurer, { transactionIds: [a.id] })).statusCode).toBe(409);
    const events = await prisma.auditEvent.findMany({ where: { action: "transactions.suggestions.accepted", objectId: bank } });
    expect(events).toHaveLength(1);
    expect(events[0]!.details).toEqual({ count: 2 });
  });

  it("refuse les mouvements d'un autre compte, et réserve l'acceptation à qui gère les transactions", async () => {
    const response = await call("POST", `/financial-accounts/${ids.bank}/transactions/accept-suggestions`, boardMember, { transactionIds: [randomUUID()] });
    expect(response.statusCode).toBe(403);
    const foreign = await call("POST", `/financial-accounts/${randomUUID()}/transactions/accept-suggestions`, treasurer, { transactionIds: [randomUUID()] });
    expect(foreign.statusCode).toBe(404);
  });
});
