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
interface Anomaly {
  code: string;
  level: string;
  count: number;
  financialAccountName: string | null;
  fix: string;
  message: string;
  details?: { entryId: string; label: string; messages: string[] }[];
}

// Exercice terminé (2020) et exercice futur (2099) : le test ne dépend pas de la date d'exécution.
describe("Tableau de progression de la reprise (ADR 0027, base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
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
    const email = `g-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "G", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
    return { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
  };

  const tx = async (amount: string, date: string, label: string, counterpart: string | null = ids.sales!) => {
    const response = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: date, amount, label, counterpartAccountId: counterpart });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  };
  const draftOf = async (transactionId: string) => {
    const response = await call("POST", `/transactions/${transactionId}/entry`, treasurer, {});
    expect(response.statusCode, response.body).toBe(201);
    return { id: (response.json() as { entryId: string }).entryId };
  };
  const progress = async (query = "") => {
    const response = await call("GET", `/recovery-progress${query}`, treasurer);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as {
      years: {
        fiscalYear: { id: string; label: string };
        accounts: { name: string; total: number; qualified: number; drafted: number; posted: number; reconciled: number; percent: number | null; opening: { state: string; amount: string } | null; blockedDrafts: number }[];
        totals: { total: number; posted: number; percent: number | null };
        documents: { postedEntries: number; withoutDocument: number };
        anomalies: Anomaly[];
        complete: boolean;
      }[];
    };
  };
  const year2020 = async () => (await progress()).years.find((y) => y.fiscalYear.label === "2020")!;
  const codes = (anomalies: Anomaly[]) => anomalies.map((a) => a.code).sort();

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
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    reader = await userWith("reader");

    for (const [label, start, end] of [
      ["2020", "2020-01-01", "2020-12-31"],
      ["2099", "2099-01-01", "2099-12-31"],
    ] as const) {
      const created = await call("POST", "/fiscal-years", treasurer, { label, start, end });
      expect(created.statusCode, created.body).toBe(201);
      ids[`fy${label}`] = created.json().id;
    }
    for (const [key, number, label] of [
      ["bank", "5121", "Banque principale"],
      ["sales", "706", "Cotisations"],
      ["charges", "606", "Achats"],
      ["funds", "102", "Fonds associatifs"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.fBank = (await call("POST", "/financial-accounts", treasurer, { name: "Banque", type: "BANK", accountId: ids.bank, openedOn: "2020-01-01", openingBalance: "1000.00" })).json().id;
    ids.journal = (await call("GET", "/journals", treasurer)).json().find((j: { code: string }) => j.code === "OD").id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("réserve la lecture à entries:view et valide la requête", async () => {
    expect((await call("GET", "/recovery-progress")).statusCode).toBe(401);
    expect((await call("GET", "/recovery-progress", reader)).statusCode).toBe(403);
    expect((await call("GET", "/recovery-progress?fiscalYearId=pas-un-uuid", treasurer)).statusCode).toBe(400);
    expect((await call("GET", `/recovery-progress?fiscalYearId=${randomUUID()}`, treasurer)).statusCode).toBe(404);
    expect((await call("GET", "/recovery-progress?inconnu=1", treasurer)).statusCode).toBe(400);
  });

  it("sans aucun mouvement : le solde d'ouverture est à expliquer, rien n'est « terminé »", async () => {
    const year = await year2020();
    expect(year.accounts).toHaveLength(1);
    expect(year.accounts[0]).toMatchObject({ name: "Banque", total: 0, percent: null, opening: { state: "TO_PREPARE", amount: "1000.00" } });
    expect(year.totals).toMatchObject({ total: 0, percent: null });
    expect(codes(year.anomalies)).toEqual(["NO_STATEMENT", "OPENING_MISSING"]);
    expect(year.complete).toBe(false);

    // L'exercice 2099 ne contient pas l'ouverture du compte, et n'est pas terminé : aucune anomalie.
    const future = (await progress()).years.find((y) => y.fiscalYear.label === "2099")!;
    expect(future.accounts[0]!.opening).toBeNull();
    expect(future.anomalies).toEqual([]);
    expect(future.complete).toBe(false);
  });

  it("suit la chaîne : non qualifié, sans brouillon, brouillon prêt, comptabilisé", async () => {
    const posted = await tx("50.00", "2020-03-05", "Cotisation de Marie");
    const posted2 = await draftOf(posted.id);
    const first = await call("POST", `/entries/${posted2.id}/post`, treasurer);
    expect(first.statusCode, first.body).toBe(200);
    const draft = await tx("20.00", "2020-03-06", "Cotisation de Paul");
    await draftOf(draft.id);
    await tx("-30.00", "2020-03-07", "Fournitures", ids.charges); // qualifié, sans brouillon
    await tx("12.00", "2020-03-08", "Don à classer", null); // non qualifié

    const year = await year2020();
    expect(year.accounts[0]).toMatchObject({ total: 4, qualified: 3, drafted: 2, posted: 1, reconciled: 0, percent: 25 });
    const byCode = Object.fromEntries(year.anomalies.map((a) => [a.code, a]));
    expect(byCode.NOT_QUALIFIED).toMatchObject({ level: "TODO", count: 1, fix: "TRANSACTIONS", financialAccountName: "Banque" });
    expect(byCode.TO_DRAFT).toMatchObject({ level: "TODO", count: 1, fix: "RECOVERY" });
    expect(byCode.DRAFTS_PENDING).toMatchObject({ level: "TODO", count: 1, fix: "RECOVERY" });
    expect(byCode.NOT_QUALIFIED!.message).toContain("compte de contrepartie");
  });

  it("signale un brouillon bloqué avec sa raison, sans le compter parmi les brouillons prêts", async () => {
    const drafts = await prisma.treasuryMatch.findMany({ where: { status: "ACTIVE", entry: { status: "DRAFT" } }, select: { entryId: true } });
    expect(drafts).toHaveLength(1);
    const entry = (await call("GET", `/entries/${drafts[0]!.entryId}`, treasurer)).json();
    // Ligne de banque modifiée : la base refuserait de comptabiliser.
    const broken = await call("PUT", `/entries/${entry.id}`, treasurer, {
      version: entry.version,
      journalId: entry.journalId,
      date: entry.date,
      label: entry.label,
      lines: [
        { accountId: ids.bank, debit: "21.00", credit: "0.00" },
        { accountId: ids.sales, debit: "0.00", credit: "21.00" },
      ],
    });
    expect(broken.statusCode, broken.body).toBe(200);

    const year = await year2020();
    const blocked = year.anomalies.find((a) => a.code === "BLOCKED_DRAFT")!;
    expect(blocked).toMatchObject({ level: "BLOCKING", count: 1, fix: "ENTRY", financialAccountName: "Banque" });
    expect(blocked.details![0]).toMatchObject({ entryId: entry.id, label: entry.label });
    expect(blocked.details![0]!.messages.join(" ")).toContain("ne correspond plus");
    expect(year.anomalies.find((a) => a.code === "DRAFTS_PENDING")).toBeUndefined();
    expect(year.accounts[0]!.blockedDrafts).toBe(1);
  });

  it("une écriture à la main sur la banque est signalée, et les pièces manquantes sont une simple information", async () => {
    const created = await call("POST", "/entries", treasurer, {
      journalId: ids.journal,
      date: "2020-04-01",
      label: "Frais saisis à la main",
      lines: [
        { accountId: ids.bank, debit: "5.00" },
        { accountId: ids.funds, credit: "5.00" },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((await call("POST", `/entries/${created.json().id}/post`, treasurer)).statusCode).toBe(200);

    const year = await year2020();
    expect(year.anomalies.find((a) => a.code === "ENTRIES_WITHOUT_TRANSACTION")).toMatchObject({ level: "WARNING", count: 1, financialAccountName: "Banque" });
    // Deux écritures comptabilisées (celle de Marie et celle-ci), aucune pièce.
    expect(year.documents).toEqual({ postedEntries: 2, withoutDocument: 2 });
    expect(year.anomalies.find((a) => a.code === "MISSING_DOCUMENTS")).toMatchObject({ level: "INFO", count: 2, fix: "DOCUMENTS", financialAccountName: null });

    // Un document archivé ne compte pas ; un document lié à l'écriture, ou au mouvement qu'elle comptabilise, oui.
    const entryOfMarie = (await prisma.treasuryMatch.findFirstOrThrow({ where: { status: "ACTIVE", entry: { status: "POSTED" } } }));
    const mk = (title: string, archived: boolean) => prisma.document.create({ data: { title, category: "facture", ...(archived && { archivedAt: new Date() }) } });
    const archivedDocument = await mk("Archivée", true);
    await prisma.documentLink.create({ data: { documentId: archivedDocument.id, objectType: "journal-entry", objectId: created.json().id } });
    expect((await year2020()).documents.withoutDocument).toBe(2);

    const liveOnTransaction = await mk("Reçu de Marie", false);
    await prisma.documentLink.create({ data: { documentId: liveOnTransaction.id, objectType: "transaction", objectId: entryOfMarie.transactionId } });
    const liveOnEntry = await mk("Justificatif des frais", false);
    await prisma.documentLink.create({ data: { documentId: liveOnEntry.id, objectType: "journal-entry", objectId: created.json().id } });
    const after = await year2020();
    expect(after.documents).toEqual({ postedEntries: 2, withoutDocument: 0 });
    expect(after.anomalies.find((a) => a.code === "MISSING_DOCUMENTS")).toBeUndefined();
  });

  it("suit le solde d'ouverture (à préparer, brouillon, comptabilisé)", async () => {
    const batch = (await call("POST", "/recovery-batches", treasurer, { name: "Reprise 2020" })).json();
    const opening = await call("POST", `/recovery-batches/${batch.id}/opening`, treasurer, { financialAccountId: ids.fBank, counterpartAccountId: ids.funds, explanation: "Fonds apportés à la création" });
    expect(opening.statusCode, opening.body).toBe(201);
    let year = await year2020();
    expect(year.accounts[0]!.opening).toMatchObject({ state: "DRAFT" });
    expect(year.anomalies.find((a) => a.code === "OPENING_MISSING")).toBeUndefined();
    expect(year.anomalies.find((a) => a.code === "OPENING_DRAFT")).toMatchObject({ level: "TODO", fix: "RECOVERY" });

    expect((await call("POST", `/entries/${opening.json().entryId}/post`, treasurer)).statusCode).toBe(200);
    year = await year2020();
    expect(year.accounts[0]!.opening).toMatchObject({ state: "POSTED" });
    expect(codes(year.anomalies)).not.toContain("OPENING_DRAFT");
    // L'écriture d'ouverture n'est ni une « écriture de banque sans transaction » ni une pièce attendue.
    expect(year.documents.postedEntries).toBe(2);
    expect(year.anomalies.find((a) => a.code === "ENTRIES_WITHOUT_TRANSACTION")!.count).toBe(1);
  });

  it("contrôle bancaire d'un exercice terminé : relevé de fin manquant, puis rapprochement à faire, puis terminé", async () => {
    expect(codes((await year2020()).anomalies)).toContain("NO_STATEMENT");

    const statement = await call("POST", `/financial-accounts/${ids.fBank}/statements`, treasurer, { periodStart: "2020-01-01", periodEnd: "2020-12-31", closingBalance: "1050.00" });
    expect(statement.statusCode, statement.body).toBe(201);
    let year = await year2020();
    expect(codes(year.anomalies)).not.toContain("NO_STATEMENT");
    expect(year.anomalies.find((a) => a.code === "NOT_RECONCILED")).toMatchObject({ level: "TODO", fix: "RECONCILIATION" });
    expect(year.accounts[0]!.reconciled).toBe(0);

    const started = await call("POST", `/financial-accounts/${ids.fBank}/reconciliations`, treasurer, { statementId: statement.json().id });
    expect(started.statusCode, started.body).toBe(201);
    year = await year2020();
    expect(year.anomalies.find((a) => a.code === "NOT_RECONCILED")!.message).toContain("en cours");
    await call("POST", `/reconciliations/${started.json().id}/cancel`, treasurer);
  });

  it("filtre par exercice et ne fait rien d'autre que lire (aucune écriture, aucun audit)", async () => {
    const before = await prisma.auditEvent.count();
    const only = await progress(`?fiscalYearId=${ids.fy2099}`);
    expect(only.years.map((y) => y.fiscalYear.label)).toEqual(["2099"]);
    expect(await prisma.auditEvent.count()).toBe(before);
  });

  it("un compte ouvert après l'exercice, ou archivé avant, n'y figure pas", async () => {
    const created = await call("POST", "/financial-accounts", treasurer, { name: "Caisse tardive", type: "CASH", accountId: (await call("POST", "/accounts", treasurer, { number: "531", label: "Caisse" })).json().id, openedOn: "2099-02-01", openingBalance: "0.00" });
    expect(created.statusCode, created.body).toBe(201);
    const years = (await progress()).years;
    expect(years.find((y) => y.fiscalYear.label === "2020")!.accounts.map((a) => a.name)).toEqual(["Banque"]);
    expect(years.find((y) => y.fiscalYear.label === "2099")!.accounts.map((a) => a.name)).toEqual(["Banque", "Caisse tardive"]);
  });
});
