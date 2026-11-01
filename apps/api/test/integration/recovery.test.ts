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

describe("Reprise : lots, soldes d'ouverture et qualification en masse (ADR 0019, base vierge)", () => {
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
    const email = `p-${randomUUID()}@test.invalid`;
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

  const tx = async (amount: string, date: string, label: string, counterpart: string | null = ids.sales!, account: string = ids.fBank!) => {
    const response = await call("POST", `/financial-accounts/${account}/transactions`, treasurer, {
      operationDate: date,
      amount,
      label,
      counterpartAccountId: counterpart,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  };
  const newBatch = async (name = "Reprise 2026 — Compte courant") => {
    const response = await call("POST", "/recovery-batches", treasurer, { name });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  };
  const prepare = (batchId: string, body: object = {}) =>
    call("POST", `/recovery-batches/${batchId}/prepare-entries`, treasurer, { financialAccountId: ids.fBank, ...body });
  const getBatch = async (batchId: string) => (await call("GET", `/recovery-batches/${batchId}`, treasurer)).json();

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
      ["funds", "102", "Fonds associatifs"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    const open = (name: string, accountId: string | undefined, openingBalance: string) =>
      call("POST", "/financial-accounts", treasurer, { name, type: "BANK", accountId, openedOn: "2026-01-01", openingBalance });
    ids.fBank = (await open("Banque", ids.bank, "1000.00")).json().id;
    ids.fSavings = (await open("Livret", ids.savings, "0.00")).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("lots", () => {
    it("réserve la création aux droits de saisie, laisse la lecture à entries:view et valide le nom", async () => {
      expect((await call("POST", "/recovery-batches", undefined, { name: "Lot test" })).statusCode).toBe(401);
      expect((await call("POST", "/recovery-batches", reader, { name: "Lot test" })).statusCode).toBe(403);
      expect((await call("POST", "/recovery-batches", boardMember, { name: "Lot test" })).statusCode).toBe(403);
      expect((await call("GET", "/recovery-batches", boardMember)).statusCode).toBe(200);
      expect((await call("GET", "/recovery-batches", reader)).statusCode).toBe(403);
      expect((await call("POST", "/recovery-batches", treasurer, { name: "ab" })).statusCode).toBe(400);
      const created = await newBatch();
      expect(created).toMatchObject({ status: "OPEN", drafts: 0, posted: 0, total: 0 });
      ids.batch = created.id;
    });
  });

  describe("solde d'ouverture guidé", () => {
    const opening = (body: object) => call("POST", `/recovery-batches/${ids.batch}/opening`, treasurer, { financialAccountId: ids.fBank, counterpartAccountId: ids.funds, explanation: "Fonds apportés à la création", ...body });

    it("prépare un brouillon banque / capitaux dans le journal d'à-nouveaux, avec l'origine dans le libellé", async () => {
      const result = await opening({});
      expect(result.statusCode, result.body).toBe(201);
      expect(result.json()).toMatchObject({ kind: "OPENING", status: "DRAFT", journalCode: "AN", date: "2026-01-01", amount: "1000.00" });
      expect(result.json().label).toContain("Fonds apportés à la création");
      const entry = (await call("GET", `/entries/${result.json().entryId}`, treasurer)).json();
      expect(entry.lines).toMatchObject([
        { accountNumber: "5121", debit: "1000.00", credit: "0.00" },
        { accountNumber: "102", debit: "0.00", credit: "1000.00" },
      ]);
    });

    it("exige une origine expliquée, un compte de capitaux, un solde non nul, et une seule écriture par compte", async () => {
      expect((await opening({ explanation: "ok" })).statusCode).toBe(400);
      const wrongClass = await opening({ counterpartAccountId: ids.sales });
      expect(wrongClass.statusCode).toBe(409);
      expect(wrongClass.json().message).toContain("classe 1");
      const zero = await opening({ financialAccountId: ids.fSavings });
      expect(zero.statusCode).toBe(409);
      expect(zero.json().message).toContain("rien à reprendre");
      const twice = await opening({});
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("déjà une écriture d'ouverture");
    });
  });

  describe("préparer les écritures d'un compte", () => {
    it("crée un brouillon par transaction qualifiée et explique celles qui sont ignorées", async () => {
      await tx("50.00", "2026-03-05", "Cotisation de Marie");
      await tx("-30.00", "2026-03-10", "Fournitures", ids.charges);
      await tx("12.00", "2026-03-12", "Don à classer", null);
      await tx("8.00", "2027-02-01", "Hors exercice");
      const linked = await tx("20.00", "2026-03-15", "Déjà préparée à la main");
      expect((await call("POST", `/transactions/${linked.id}/entry`, treasurer, {})).statusCode).toBe(201);
      expect(
        (await call("POST", "/transfers", treasurer, { fromAccountId: ids.fBank, toAccountId: ids.fSavings, amount: "100.00", date: "2026-03-18", prepareEntry: false })).statusCode,
      ).toBe(201);

      const report = await prepare(ids.batch!);
      expect(report.statusCode, report.body).toBe(200);
      expect(report.json().created).toBe(2);
      expect(report.json().skippedByReason).toEqual({ NOT_QUALIFIED: 1, NO_FISCAL_YEAR: 1, ALREADY_LINKED: 1, TRANSFER: 1 });
      const don = report.json().skipped.find((s: { reason: string }) => s.reason === "NOT_QUALIFIED");
      expect(don).toMatchObject({ label: "Don à classer", date: "2026-03-12" });
      expect(don.message).toContain("qualifiez");

      const lot = await getBatch(ids.batch!);
      expect(lot.batch).toMatchObject({ status: "OPEN", drafts: 3, posted: 0, total: 3 });
      // Chronologique : l'ouverture (1er janvier) d'abord.
      expect(lot.items.map((i: { label: string }) => i.label.slice(0, 12))).toEqual(["Solde d'ouve", "Cotisation d", "Fournitures"]);
    });

    it("relancer la préparation ne crée aucun doublon", async () => {
      const again = await prepare(ids.batch!);
      expect(again.json().created).toBe(0);
      expect((await getBatch(ids.batch!)).batch.total).toBe(3);
    });

    it("une période restreint les transactions préparées, et un compte inconnu est refusé", async () => {
      expect((await prepare(ids.batch!, { from: "2026-12-01", to: "2026-12-31" })).json().created).toBe(0);
      expect((await prepare(ids.batch!, { financialAccountId: randomUUID() })).statusCode).toBe(404);
      expect((await prepare(ids.batch!, { from: "2026-05-01", to: "2026-04-01" })).statusCode).toBe(400);
    });
  });

  describe("comptabiliser le lot, avec reprise après erreur", () => {
    it("comptabilise ce qui passe, liste ce qui est refusé, et laisse le refusé en brouillon", async () => {
      // On casse la ligne de banque d'un brouillon : la base refusera de le comptabiliser.
      const lot = await getBatch(ids.batch!);
      const target = lot.items.find((i: { label: string }) => i.label.startsWith("Fournitures"));
      const entry = (await call("GET", `/entries/${target.entryId}`, treasurer)).json();
      const body = (amount: string) => ({
        version: entry.version,
        journalId: entry.journalId,
        date: entry.date,
        label: entry.label,
        lines: [
          { accountId: ids.charges, debit: amount, credit: "0.00" },
          { accountId: ids.bank, debit: "0.00", credit: amount },
        ],
      });
      const broken = await call("PUT", `/entries/${target.entryId}`, treasurer, body("31.00"));
      expect(broken.statusCode, broken.body).toBe(200);

      expect((await call("POST", `/recovery-batches/${ids.batch}/post`, reader)).statusCode).toBe(403);
      expect((await call("POST", `/recovery-batches/${ids.batch}/post`, boardMember)).statusCode).toBe(403);
      const report = await call("POST", `/recovery-batches/${ids.batch}/post`, treasurer);
      expect(report.statusCode, report.body).toBe(200);
      expect(report.json()).toMatchObject({ posted: 2, remainingDrafts: 1, completed: false });
      expect(report.json().failed).toHaveLength(1);
      expect(report.json().failed[0]).toMatchObject({ entryId: target.entryId, label: "Fournitures" });
      expect(report.json().failed[0].messages.join(" ")).toContain("ne correspond plus");

      const after = await getBatch(ids.batch!);
      expect(after.batch).toMatchObject({ status: "OPEN", drafts: 1, posted: 2 });

      // On corrige le brouillon refusé puis on relance : le lot se termine.
      const fixedEntry = (await call("GET", `/entries/${target.entryId}`, treasurer)).json();
      const fixed = await call("PUT", `/entries/${target.entryId}`, treasurer, { ...body("30.00"), version: fixedEntry.version });
      expect(fixed.statusCode, fixed.body).toBe(200);
      const second = await call("POST", `/recovery-batches/${ids.batch}/post`, treasurer);
      expect(second.json()).toMatchObject({ posted: 1, remainingDrafts: 0, completed: true });
      const done = await getBatch(ids.batch!);
      expect(done.batch).toMatchObject({ status: "COMPLETED", drafts: 0, posted: 3 });
      expect(done.batch.closedAt).not.toBeNull();
      expect(done.items.every((i: { status: string; number: number | null }) => i.status === "POSTED" && i.number !== null)).toBe(true);
    });

    it("un lot terminé ne change plus", async () => {
      expect((await prepare(ids.batch!)).statusCode).toBe(409);
      expect((await call("POST", `/recovery-batches/${ids.batch}/abandon`, treasurer)).statusCode).toBe(409);
      expect((await call("POST", `/recovery-batches/${ids.batch}/post`, treasurer)).statusCode).toBe(409);
    });

    it("le rapprochement ne signale pas l'écriture d'ouverture comme une écriture de banque sans transaction", async () => {
      const statement = (await call("POST", `/financial-accounts/${ids.fBank}/statements`, treasurer, { periodStart: "2026-01-01", periodEnd: "2026-06-30", closingBalance: "1020.00" })).json();
      const started = await call("POST", `/financial-accounts/${ids.fBank}/reconciliations`, treasurer, { statementId: statement.id });
      expect(started.statusCode, started.body).toBe(201);
      expect(started.json().checks.map((c: { code: string }) => c.code)).not.toContain("ENTRIES_WITHOUT_TRANSACTION");
      expect((await call("POST", `/reconciliations/${started.json().id}/cancel`, treasurer)).statusCode).toBe(204);
    });
  });

  describe("abandonner un lot", () => {
    it("supprime ses brouillons, libère les transactions et laisse intactes les écritures comptabilisées", async () => {
      const a = await tx("15.00", "2026-05-02", "Vente de gâteaux");
      const b = await tx("25.00", "2026-05-09", "Vente de livres");
      const lot = await newBatch("Reprise mai 2026");
      const report = await prepare(lot.id, { from: "2026-05-01", to: "2026-05-31" });
      expect(report.json().created).toBe(2);

      // Une des deux est comptabilisée à la main avant l'abandon.
      const items = (await getBatch(lot.id)).items;
      const kept = items.find((i: { label: string }) => i.label === "Vente de gâteaux");
      expect((await call("POST", `/entries/${kept.entryId}/post`, treasurer)).statusCode).toBe(200);

      const abandoned = await call("POST", `/recovery-batches/${lot.id}/abandon`, treasurer);
      expect(abandoned.statusCode, abandoned.body).toBe(200);
      expect(abandoned.json()).toEqual({ deleted: 1, kept: 1 });

      const after = await getBatch(lot.id);
      expect(after.batch).toMatchObject({ status: "ABANDONED", drafts: 0, posted: 1 });
      expect(after.batch.abandonedAt).not.toBeNull();
      // L'écriture comptabilisée est intacte ; l'autre transaction est de nouveau libre.
      expect((await call("GET", `/entries/${kept.entryId}`, treasurer)).json().status).toBe("POSTED");
      const list = (await call("GET", `/financial-accounts/${ids.fBank}/transactions?limit=200`, treasurer)).json().transactions;
      expect(list.find((t: { id: string }) => t.id === a.id)).toMatchObject({ accounting: "POSTED" });
      expect(list.find((t: { id: string }) => t.id === b.id)).toMatchObject({ accounting: "NONE", deletable: true });
      // Et on peut les reprendre dans un nouveau lot.
      const next = await newBatch("Reprise mai 2026 (bis)");
      expect((await prepare(next.id, { from: "2026-05-01", to: "2026-05-31" })).json().created).toBe(1);
    });
  });

  describe("qualifier la sélection", () => {
    const qualify = (session: Session | undefined, body: object, account: string = ids.fBank!) =>
      call("POST", `/financial-accounts/${account}/transactions/qualify`, session, body);

    it("applique un compte de contrepartie à une sélection, tout ou rien", async () => {
      const t1 = await tx("5.00", "2026-06-01", "À qualifier 1", null);
      const t2 = await tx("6.00", "2026-06-02", "À qualifier 2", null);
      const done = await qualify(treasurer, { transactionIds: [t1.id, t2.id], counterpartAccountId: ids.sales });
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json()).toEqual({ updated: 2 });
      const list = (await call("GET", `/financial-accounts/${ids.fBank}/transactions?limit=200`, treasurer)).json().transactions;
      expect(list.find((t: { id: string }) => t.id === t1.id)).toMatchObject({ counterpartAccountNumber: "706", qualified: true });

      // Une transaction d'un autre compte annule tout.
      const other = await tx("1.00", "2026-06-03", "Autre compte", null, ids.fSavings);
      const t3 = await tx("7.00", "2026-06-04", "À qualifier 3", null);
      const refused = await qualify(treasurer, { transactionIds: [t3.id, other.id], counterpartAccountId: ids.sales });
      expect(refused.statusCode).toBe(409);
      const after = (await call("GET", `/financial-accounts/${ids.fBank}/transactions?limit=200`, treasurer)).json().transactions;
      expect(after.find((t: { id: string }) => t.id === t3.id)).toMatchObject({ qualified: false });
    });

    it("applique un projet, refuse une demande vide, un projet archivé et les droits insuffisants", async () => {
      const project = (await call("POST", "/projects", treasurer, { code: "ATELIERS", name: "Ateliers" })).json();
      const t = await tx("9.00", "2026-06-05", "Projet", null);
      expect((await qualify(treasurer, { transactionIds: [t.id], projectId: project.id })).statusCode).toBe(200);
      expect((await qualify(treasurer, { transactionIds: [t.id] })).statusCode).toBe(400);
      expect((await qualify(treasurer, { transactionIds: [] , counterpartAccountId: ids.sales })).statusCode).toBe(400);
      expect((await qualify(boardMember, { transactionIds: [t.id], projectId: project.id })).statusCode).toBe(403);
      expect((await qualify(undefined, { transactionIds: [t.id], projectId: project.id })).statusCode).toBe(401);
      // Un projet archivé ne reçoit plus de transaction (réaffecter le même projet à la même transaction reste sans effet).
      const old = (await call("POST", "/projects", treasurer, { code: "ANCIEN", name: "Ancien projet" })).json();
      expect((await call("PATCH", `/projects/${old.id}`, treasurer, { status: "ARCHIVED" })).statusCode).toBe(200);
      const other = await tx("4.00", "2026-06-06", "Projet archivé", null);
      const archived = await qualify(treasurer, { transactionIds: [other.id], projectId: old.id });
      expect(archived.statusCode).toBe(409);
      expect(archived.json().message).toContain("archivé");
    });
  });

  describe("garanties en base", () => {
    it("refuse en SQL de supprimer un lot, de modifier un élément, d'y mettre une écriture comptabilisée ou de le retirer à la main", async () => {
      expect(await sqlError(`DELETE FROM "RecoveryBatch" WHERE id = '${ids.batch}'`)).toContain("on l'abandonne");
      expect(await sqlError(`TRUNCATE "RecoveryBatch"`)).not.toBeNull();
      expect(await sqlError(`UPDATE "RecoveryBatch" SET status = 'OPEN' WHERE id = '${ids.batch}'`)).toContain("ne change plus");
      const item = await prisma.recoveryBatchItem.findFirstOrThrow({ where: { batchId: ids.batch! } });
      expect(await sqlError(`UPDATE "RecoveryBatchItem" SET kind = 'OPENING' WHERE id = '${item.id}'`)).toContain("ne se modifie pas");
      expect(await sqlError(`DELETE FROM "RecoveryBatchItem" WHERE id = '${item.id}'`)).toContain("supprimez le brouillon");
      const open = await newBatch("Lot pour garantie");
      expect(
        await sqlError(`INSERT INTO "RecoveryBatchItem"(id, "batchId", "entryId", kind, "financialAccountId") VALUES (gen_random_uuid(), '${open.id}', '${item.entryId}', 'TRANSACTION', '${ids.fBank}')`),
      ).not.toBeNull();
      expect(await sqlError(`UPDATE "RecoveryBatch" SET status = 'COMPLETED', "closedAt" = now() WHERE id = '${open.id}'`)).toContain("vide");
    });
  });
});
