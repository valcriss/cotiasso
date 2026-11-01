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

describe("Trésorerie : liaison transaction → écriture et virements internes (ADR 0017, base vierge)", () => {
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

  /** Crée une transaction manuelle qualifiée (compte de contrepartie 706 par défaut) sur la banque principale. */
  const addTx = async (amount: string, overrides: Record<string, unknown> = {}, account: string = ids.fBank!) => {
    const response = await call("POST", `/financial-accounts/${account}/transactions`, treasurer, {
      operationDate: "2026-03-10",
      amount,
      label: "Cotisation de Marie",
      counterpartAccountId: ids.sales,
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const getTx = async (id: string, account: string = ids.fBank!) => {
    const list = (await call("GET", `/financial-accounts/${account}/transactions`, treasurer)).json();
    return list.transactions.find((t: { id: string }) => t.id === id);
  };
  const prepare = (id: string) => call("POST", `/transactions/${id}/entry`, treasurer, {});
  const post = (entryId: string) => call("POST", `/entries/${entryId}/post`, treasurer);
  const manualEntry = async (debitAccount: string | undefined, creditAccount: string | undefined, amount: string) => {
    const response = await call("POST", "/entries", treasurer, {
      journalId: ids.journal,
      date: "2026-03-10",
      label: "Écriture saisie à la main",
      lines: [
        { accountId: debitAccount, debit: amount, credit: "0.00" },
        { accountId: creditAccount, debit: "0.00", credit: amount },
      ],
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
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");

    expect((await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).statusCode).toBe(201);
    for (const [key, number, label] of [
      ["bank", "5121", "Banque principale"],
      ["savings", "5122", "Livret"],
      ["sales", "706", "Cotisations"],
      ["charges", "606", "Achats"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.project = (await call("POST", "/projects", treasurer, { code: "ATELIERS", name: "Ateliers" })).json().id;
    const open = (name: string, accountId: string | undefined) =>
      call("POST", "/financial-accounts", treasurer, { name, type: "BANK", accountId, openedOn: "2026-01-01", openingBalance: "0.00" });
    const bank = (await open("Banque", ids.bank)).json();
    const savings = (await open("Livret", ids.savings)).json();
    ids.fBank = bank.id;
    ids.fSavings = savings.id;
    ids.journal = (await call("GET", "/journals", treasurer)).json().find((j: { code: string }) => j.code === bank.journalCode).id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("préparer un brouillon depuis une transaction", () => {
    it("prépare le brouillon (banque + contrepartie + projet), lie la transaction et la dit en cours de comptabilisation", async () => {
      const t = await addTx("50.00", { projectId: ids.project });
      expect(t).toMatchObject({ accounting: "NONE", entry: null, financialLock: null, deletable: true });

      const prepared = await prepare(t.id);
      expect(prepared.statusCode, prepared.body).toBe(201);
      const { transaction, entryId } = prepared.json();
      expect(transaction).toMatchObject({ accounting: "IN_PROGRESS", entry: { id: entryId, status: "DRAFT" }, financialLock: "ENTRY", deletable: false });

      const entry = (await call("GET", `/entries/${entryId}`, treasurer)).json();
      expect(entry).toMatchObject({ status: "DRAFT", date: "2026-03-10", label: "Cotisation de Marie", journalCode: "BQ-1" });
      expect(entry.lines).toMatchObject([
        { accountNumber: "5121", debit: "50.00", credit: "0.00" },
        { accountNumber: "706", debit: "0.00", credit: "50.00", allocations: [{ projectCode: "ATELIERS", amount: "50.00" }] },
      ]);
    });

    it("pour un décaissement, crédite la banque et débite la charge", async () => {
      const t = await addTx("-30.00", { counterpartAccountId: ids.charges, label: "Fournitures" });
      const { entryId } = (await prepare(t.id)).json();
      const entry = (await call("GET", `/entries/${entryId}`, treasurer)).json();
      expect(entry.lines).toMatchObject([
        { accountNumber: "5121", debit: "0.00", credit: "30.00" },
        { accountNumber: "606", debit: "30.00", credit: "0.00" },
      ]);
    });

    it("refuse sans compte de contrepartie, en l'expliquant, et ne prépare pas deux fois", async () => {
      const bare = await addTx("12.00", { counterpartAccountId: null });
      const refused = await prepare(bare.id);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("compte de contrepartie");

      const t = await addTx("13.00");
      expect((await prepare(t.id)).statusCode).toBe(201);
      const twice = await prepare(t.id);
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("déjà liée");
    });

    it("réserve la préparation à transactions:manage et entries:create", async () => {
      const t = await addTx("14.00");
      expect((await call("POST", `/transactions/${t.id}/entry`, undefined, {})).statusCode).toBe(401);
      expect((await call("POST", `/transactions/${t.id}/entry`, reader, {})).statusCode).toBe(403);
      expect((await call("POST", `/transactions/${t.id}/entry`, boardMember, {})).statusCode).toBe(403);
    });
  });

  describe("comptabilisation, figement et contrepassation", () => {
    it("une fois l'écriture comptabilisée, la transaction l'est aussi et ne bouge plus", async () => {
      const t = await addTx("60.00");
      const { entryId } = (await prepare(t.id)).json();
      expect((await post(entryId)).statusCode).toBe(200);

      expect(await getTx(t.id)).toMatchObject({ accounting: "POSTED", entry: { id: entryId, status: "POSTED" }, financialLock: "ENTRY" });

      // Montant et date figés ; le libellé reste modifiable ; pas de suppression.
      const current = await getTx(t.id);
      const amount = await call("PATCH", `/transactions/${t.id}`, treasurer, { version: current.version, amount: "61.00" });
      expect(amount.statusCode).toBe(409);
      expect(amount.json().message).toContain("liée à une écriture");
      const date = await call("PATCH", `/transactions/${t.id}`, treasurer, { version: current.version, operationDate: "2026-03-11" });
      expect(date.statusCode).toBe(409);
      expect((await call("PATCH", `/transactions/${t.id}`, treasurer, { version: current.version, label: "Cotisation Marie 2026" })).statusCode).toBe(200);
      const removed = await call("DELETE", `/transactions/${t.id}`, treasurer);
      expect(removed.statusCode).toBe(409);
    });

    it("refuse de dissocier une écriture comptabilisée : il faut la contrepasser", async () => {
      const t = await addTx("61.00");
      const { entryId } = (await prepare(t.id)).json();
      await post(entryId);
      const unlink = await call("DELETE", `/transactions/${t.id}/link`, treasurer);
      expect(unlink.statusCode).toBe(409);
      expect(unlink.json().message).toContain("contrepassez");
    });

    it("la contrepassation termine la liaison (historique conservé) et la transaction redevient à comptabiliser", async () => {
      const t = await addTx("62.00");
      const { entryId } = (await prepare(t.id)).json();
      await post(entryId);
      expect((await call("POST", `/entries/${entryId}/reverse`, treasurer, {})).statusCode).toBe(201);

      expect(await getTx(t.id)).toMatchObject({ accounting: "NONE", entry: null });
      const matches = await prisma.treasuryMatch.findMany({ where: { transactionId: t.id } });
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ status: "ENDED" });
      expect(matches[0]!.endedAt).not.toBeNull();
      // Montant et date restent figés, la transaction ne se supprime pas (la trace existe).
      expect(await getTx(t.id)).toMatchObject({ deletable: false });
      expect(await sqlError(`DELETE FROM "Transaction" WHERE id = '${t.id}'`)).toContain("liée à une écriture");

      // Elle peut être reliée à une nouvelle écriture corrigée.
      const again = await prepare(t.id);
      expect(again.statusCode, again.body).toBe(201);
      expect(again.json().transaction.accounting).toBe("IN_PROGRESS");
    });

    it("la ligne de banque d'un brouillon relié doit correspondre à la transaction au moment de comptabiliser", async () => {
      const t = await addTx("70.00");
      const { entryId } = (await prepare(t.id)).json();
      const entry = (await call("GET", `/entries/${entryId}`, treasurer)).json();
      const edited = await call("PUT", `/entries/${entryId}`, treasurer, {
        version: entry.version,
        journalId: entry.journalId,
        date: entry.date,
        label: entry.label,
        lines: [
          { accountId: ids.bank!, debit: "71.00", credit: "0.00" },
          { accountId: ids.sales!, debit: "0.00", credit: "71.00" },
        ],
      });
      expect(edited.statusCode, edited.body).toBe(200);
      const refused = await post(entryId);
      expect(refused.statusCode).toBe(422);
      expect(JSON.stringify(refused.json())).toContain("ne correspond plus");
      expect((await call("GET", `/entries/${entryId}`, treasurer)).json().status).toBe("DRAFT");
    });
  });

  describe("associer une écriture existante et dissocier", () => {
    it("ne propose que les écritures dont la ligne de banque correspond, puis lie celle choisie", async () => {
      const t = await addTx("80.00");
      const good = await manualEntry(ids.bank, ids.sales, "80.00");
      const other = await manualEntry(ids.bank, ids.sales, "81.00");
      const savings = await manualEntry(ids.savings, ids.sales, "80.00");

      const candidates = (await call("GET", `/transactions/${t.id}/entry-candidates`, treasurer)).json();
      const found = candidates.map((c: { id: string }) => c.id);
      expect(found).toContain(good.id);
      expect(found).not.toContain(other.id);
      expect(found).not.toContain(savings.id);

      const linked = await call("POST", `/transactions/${t.id}/link`, treasurer, { entryId: good.id });
      expect(linked.statusCode, linked.body).toBe(201);
      expect(linked.json()).toMatchObject({ accounting: "IN_PROGRESS", entry: { id: good.id } });
      // Une fois liée, l'écriture n'est plus proposée pour ce compte.
      expect((await call("GET", `/transactions/${(await addTx("80.00")).id}/entry-candidates`, treasurer)).json().map((c: { id: string }) => c.id)).not.toContain(good.id);
    });

    it("refuse une écriture dont la ligne de banque diffère, déjà liée ou contrepassée", async () => {
      const t = await addTx("90.00");
      const wrong = await manualEntry(ids.bank, ids.sales, "91.00");
      const refused = await call("POST", `/transactions/${t.id}/link`, treasurer, { entryId: wrong.id });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("ne correspond pas");

      const good = await manualEntry(ids.bank, ids.sales, "90.00");
      expect((await call("POST", `/transactions/${t.id}/link`, treasurer, { entryId: good.id })).statusCode).toBe(201);
      const twice = await call("POST", `/transactions/${(await addTx("90.00")).id}/link`, treasurer, { entryId: good.id });
      expect(twice.statusCode).toBe(409);
      expect((await call("POST", `/transactions/${t.id}/link`, treasurer, { entryId: randomUUID() })).statusCode).toBe(404);
    });

    it("deux liaisons simultanées de la même écriture : une seule passe", async () => {
      const entry = await manualEntry(ids.bank, ids.sales, "95.00");
      const [a, b] = [await addTx("95.00"), await addTx("95.00")];
      const results = await Promise.all([
        call("POST", `/transactions/${a.id}/link`, treasurer, { entryId: entry.id }),
        call("POST", `/transactions/${b.id}/link`, treasurer, { entryId: entry.id }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    });

    it("dissocier un brouillon libère la transaction ; supprimer le brouillon aussi", async () => {
      const t = await addTx("96.00");
      const { entryId } = (await prepare(t.id)).json();
      const freed = await call("DELETE", `/transactions/${t.id}/link`, treasurer);
      expect(freed.statusCode, freed.body).toBe(200);
      expect(freed.json()).toMatchObject({ accounting: "NONE", entry: null, deletable: true });
      expect((await call("DELETE", `/transactions/${t.id}/link`, treasurer)).statusCode).toBe(409);

      const u = await addTx("97.00");
      const second = (await prepare(u.id)).json().entryId;
      expect((await call("DELETE", `/entries/${second}`, treasurer)).statusCode).toBe(204);
      expect(await getTx(u.id)).toMatchObject({ accounting: "NONE", deletable: true });
      expect(await prisma.treasuryMatch.count({ where: { transactionId: u.id } })).toBe(0);
      expect(entryId).toBeTruthy();
    });

    it("filtre les transactions par état de comptabilisation", async () => {
      const t = await addTx("98.00");
      await prepare(t.id);
      const inProgress = (await call("GET", `/financial-accounts/${ids.fBank}/transactions?accounting=IN_PROGRESS&limit=200`, treasurer)).json();
      expect(inProgress.transactions.map((x: { id: string }) => x.id)).toContain(t.id);
      const none = (await call("GET", `/financial-accounts/${ids.fBank}/transactions?accounting=NONE&limit=200`, treasurer)).json();
      expect(none.transactions.map((x: { id: string }) => x.id)).not.toContain(t.id);
    });
  });

  describe("virements internes (CA-05)", () => {
    const transfer = (overrides: Record<string, unknown> = {}) =>
      call("POST", "/transfers", treasurer, {
        fromAccountId: ids.fBank,
        toAccountId: ids.fSavings,
        amount: "300.00",
        date: "2026-03-20",
        ...overrides,
      });

    it("crée deux transactions reliées et un brouillon banque à banque, sans charge ni produit", async () => {
      const created = await transfer();
      expect(created.statusCode, created.body).toBe(201);
      const body = created.json();
      expect(body.out).toMatchObject({ amount: "-300.00", accounting: "IN_PROGRESS", financialLock: "ENTRY", transfer: { direction: "OUT", otherAccountName: "Livret" } });
      expect(body.in).toMatchObject({ amount: "300.00", accounting: "IN_PROGRESS", transfer: { direction: "IN", otherAccountName: "Banque" } });

      const entry = (await call("GET", `/entries/${body.entryId}`, treasurer)).json();
      expect(entry.lines).toMatchObject([
        { accountNumber: "5122", debit: "300.00", credit: "0.00" },
        { accountNumber: "5121", debit: "0.00", credit: "300.00" },
      ]);
      expect(entry.lines.every((l: { accountNumber: string }) => !/^[67]/.test(l.accountNumber))).toBe(true);

      expect((await post(body.entryId)).statusCode).toBe(200);
      expect(await getTx(body.out.id)).toMatchObject({ accounting: "POSTED" });
      expect(await getTx(body.in.id, ids.fSavings)).toMatchObject({ accounting: "POSTED" });

      // Plus d'annulation une fois lié à une écriture ; montant et date figés.
      const cancel = await call("DELETE", `/transfers/${body.id}`, treasurer);
      expect(cancel.statusCode).toBe(409);
      expect(cancel.json().message).toContain("ne s'annule plus");
      const out = await getTx(body.out.id);
      expect((await call("PATCH", `/transactions/${out.id}`, treasurer, { version: out.version, amount: "-301.00" })).statusCode).toBe(409);
    });

    it("sans brouillon, le virement s'annule et ses deux transactions disparaissent", async () => {
      const created = (await transfer({ prepareEntry: false, amount: "10.00" })).json();
      expect(created.entryId).toBeNull();
      expect(created.out).toMatchObject({ financialLock: "TRANSFER", deletable: false });
      // Les transactions d'un virement ne se suppriment pas une à une.
      expect((await call("DELETE", `/transactions/${created.out.id}`, treasurer)).statusCode).toBe(409);

      expect((await call("DELETE", `/transfers/${created.id}`, treasurer)).statusCode).toBe(204);
      expect(await getTx(created.out.id)).toBeUndefined();
      expect(await getTx(created.in.id, ids.fSavings)).toBeUndefined();
    });

    it("refuse un virement d'un compte vers lui-même, un montant nul ou négatif, et sans droits", async () => {
      const same = await transfer({ toAccountId: ids.fBank });
      expect(same.statusCode).toBe(409);
      expect((await transfer({ amount: "0" })).statusCode).toBe(400);
      expect((await transfer({ amount: "-5.00" })).statusCode).toBe(400);
      expect((await transfer({ date: "2025-12-31" })).statusCode).toBe(409);
      expect((await call("POST", "/transfers", reader, {})).statusCode).toBe(403);
      expect((await call("POST", "/transfers", boardMember, {})).statusCode).toBe(403);
      expect((await call("POST", "/transfers", undefined, {})).statusCode).toBe(401);
    });
  });

  describe("garanties en base", () => {
    it("refuse en SQL une liaison incohérente, sa modification, sa suppression après comptabilisation et le TRUNCATE", async () => {
      const t = await addTx("120.00");
      const { entryId } = (await prepare(t.id)).json();
      const other = await addTx("121.00");

      expect(
        await sqlError(`INSERT INTO "TreasuryMatch"(id, "transactionId", "entryId", "financialAccountId") VALUES (gen_random_uuid(), '${other.id}', '${entryId}', '${ids.fBank}')`),
      ).toMatch(/ne correspond pas|unique|duplicate/i);
      // Une liaison ne naît pas terminée ni sur un autre compte financier que celui de la transaction.
      expect(
        await sqlError(`INSERT INTO "TreasuryMatch"(id, "transactionId", "entryId", "financialAccountId", status, "endedAt") VALUES (gen_random_uuid(), '${other.id}', '${entryId}', '${ids.fBank}', 'ENDED', now())`),
      ).toContain("naît active");
      expect(
        await sqlError(`INSERT INTO "TreasuryMatch"(id, "transactionId", "entryId", "financialAccountId") VALUES (gen_random_uuid(), '${other.id}', '${entryId}', '${ids.fSavings}')`),
      ).toContain("diffère de celui de la transaction");

      await post(entryId);
      const match = await prisma.treasuryMatch.findFirstOrThrow({ where: { transactionId: t.id } });
      expect(await sqlError(`UPDATE "TreasuryMatch" SET "entryId" = '${entryId}', "createdBy" = NULL WHERE id = '${match.id}'`)).toContain("ne se modifie pas");
      expect(await sqlError(`DELETE FROM "TreasuryMatch" WHERE id = '${match.id}'`)).toContain("contrepassez");
      expect(await sqlError(`TRUNCATE "TreasuryMatch"`)).not.toBeNull();
      expect(await sqlError(`TRUNCATE "Transfer"`)).not.toBeNull();
    });

    it("refuse en SQL un virement incohérent (même compte, montants différents, dates différentes) et sa modification", async () => {
      const a = await addTx("-5.00", {}, ids.fBank);
      const b = await addTx("6.00", {}, ids.fSavings);
      expect(await sqlError(`INSERT INTO "Transfer"(id, "outTransactionId", "inTransactionId") VALUES (gen_random_uuid(), '${a.id}', '${b.id}')`)).toContain("même montant");
      const created = (await call("POST", "/transfers", treasurer, { fromAccountId: ids.fBank, toAccountId: ids.fSavings, amount: "7.00", date: "2026-03-21", prepareEntry: false })).json();
      expect(await sqlError(`UPDATE "Transfer" SET "createdBy" = NULL WHERE id = '${created.id}'`)).toContain("ne se modifie pas");
    });
  });
});
