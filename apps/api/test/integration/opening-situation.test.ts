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

describe("Situation d'ouverture : l'autre mode de démarrage (ADR 0029, base vierge)", () => {
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
    const email = `s-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "S", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
    return { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
  };

  const view = async (query = "") => {
    const response = await call("GET", `/opening-situation${query}`, treasurer);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as {
      mode: string | null;
      date: string | null;
      accounts: { id: string; name: string; openingBalance: string }[];
      misaligned: { id: string; name: string }[];
      kinds: { key: string; available: boolean }[];
      equityAccounts: { id: string; number: string }[];
      suggestedEquityAccountId: string | null;
      existing: { entryId: string; date: string; status: string } | null;
      fiscalYear: boolean;
    };
  };
  const record = (payload: object) => call("POST", "/opening-situation", treasurer, payload);
  const base = () => ({
    date: "2026-01-01",
    receivables: [{ kind: "MEMBERSHIP_DUE", label: "Marie Dupont", amount: "30.00" }],
    payables: [{ kind: "SUPPLIER_OWED", label: "Imprimeur", amount: "120.00" }],
    equityAmount: "960.00",
    equityAccountId: ids.funds,
    explanation: "Fonds apportés à la création",
  });
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
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("réserve le choix du mode et la situation à l'administration de la comptabilité", async () => {
    expect((await call("GET", "/opening-situation")).statusCode).toBe(401);
    expect((await call("GET", "/opening-situation", reader)).statusCode).toBe(403);
    expect((await call("GET", "/opening-situation", boardMember)).statusCode).toBe(403);
    expect((await call("PUT", "/start-mode", boardMember, { mode: "OPENING" })).statusCode).toBe(403);
    expect((await call("POST", "/opening-situation", boardMember, {})).statusCode).toBe(403);
    expect((await view()).mode).toBeNull();
  });

  it("sans compte ni exercice : rien à reprendre, et on le dit", async () => {
    const empty = await view();
    expect(empty).toMatchObject({ date: null, accounts: [], existing: null, fiscalYear: false });
    expect(empty.kinds.every((k) => !k.available)).toBe(true);
    const refused = await record({ date: "2026-01-01" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("Aucun exercice");
  });

  it("prépare le terrain : exercice, plan, comptes bancaires", async () => {
    expect((await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).statusCode).toBe(201);
    for (const [key, number, label] of [
      ["funds", "102", "Fonds associatifs"],
      ["bank", "5121", "Banque principale"],
      ["cash", "5311", "Caisse"],
      ["savings", "5122", "Livret"],
      ["charges", "606", "Achats"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    const open = (name: string, accountId: string, openingBalance: string, openedOn = "2026-01-01", type = "BANK") =>
      call("POST", "/financial-accounts", treasurer, { name, type, accountId, openedOn, openingBalance });
    ids.fBank = (await open("Banque", ids.bank!, "1000.00")).json().id;
    ids.fCash = (await open("Caisse", ids.cash!, "50.00", "2026-01-01", "CASH")).json().id;
    ids.fSavings = (await open("Livret", ids.savings!, "0.00", "2026-03-01")).json().id;

    const state = await view();
    expect(state).toMatchObject({ date: "2026-01-01", misaligned: [], fiscalYear: true, existing: null });
    expect(state.accounts.map((a) => [a.name, a.openingBalance])).toEqual([["Banque", "1000.00"], ["Caisse", "50.00"], ["Livret", "0.00"]]);
    // Sans compte 411, 401… dans le plan, ces lignes sont indisponibles : on ne devine pas de compte.
    expect(state.kinds.every((k) => !k.available)).toBe(true);
    expect(state.equityAccounts.map((a) => a.number)).toEqual(["102"]);
    expect(state.suggestedEquityAccountId).toBe(ids.funds);
  });

  it("refuse une ligne dont le compte n'est pas dans le plan, avec ce qu'il faut faire", async () => {
    const refused = await record(base());
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("n'est pas disponible");
    expect(refused.json().message).toContain("modèle de démarrage");
    expect((await call("POST", "/starter-template", treasurer)).statusCode).toBe(200);
    expect((await view()).kinds.every((k) => k.available)).toBe(true);
  });

  describe("mode de démarrage", () => {
    it("se choisit, se valide et se relit", async () => {
      expect((await call("PUT", "/start-mode", treasurer, { mode: "AUTRE" })).statusCode).toBe(400);
      expect((await call("PUT", "/start-mode", treasurer, {})).statusCode).toBe(400);
      expect((await call("PUT", "/start-mode", treasurer, { mode: "OPENING" })).json()).toEqual({ mode: "OPENING" });
      expect((await view()).mode).toBe("OPENING");
      expect((await call("PUT", "/start-mode", treasurer, { mode: "HISTORY" })).json()).toEqual({ mode: "HISTORY" });
      expect((await call("PUT", "/start-mode", treasurer, { mode: "OPENING" })).statusCode).toBe(200);
    });

    it("la vue d'ensemble rappelle de saisir la situation de départ", async () => {
      const overview = (await call("GET", "/overview", treasurer)).json();
      expect(overview.setup).toMatchObject({ startMode: "OPENING", openingSituation: "NONE" });
      expect(overview.todo.map((t: { code: string }) => t.code)).toContain("OPENING_SITUATION");
    });
  });

  describe("enregistrer la situation", () => {
    it("refuse les montants qui ont changé, un fonds sans compte ni explication, un mauvais compte", async () => {
      const stale = await record({ ...base(), equityAmount: "900.00" });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().message).toContain("ont changé");
      expect(stale.json().message).toContain("960.00");
      const noAccount = await record({ ...base(), equityAccountId: null });
      expect(noAccount.statusCode).toBe(409);
      expect(noAccount.json().message).toContain("où ranger");
      const noWhy = await record({ ...base(), explanation: "ok" });
      expect(noWhy.statusCode).toBe(409);
      expect(noWhy.json().message).toContain("d'où vient");
      const wrongClass = await record({ ...base(), equityAccountId: ids.charges });
      expect(wrongClass.statusCode).toBe(409);
      expect(wrongClass.json().message).toContain("classe 1");
      expect((await record({ ...base(), receivables: [{ kind: "INCONNU", label: "x", amount: "1.00" }] })).statusCode).toBe(409);
      expect((await record({ ...base(), receivables: [{ kind: "MEMBERSHIP_DUE", label: "x", amount: "-3" }] })).statusCode).toBe(400);
      expect((await record({ ...base(), receivables: [{ kind: "SUPPLIER_OWED", label: "x", amount: "3.00" }] })).statusCode).toBe(409);
      expect((await record({ ...base(), date: "2026-13-40" })).statusCode).toBe(400);
      expect((await record({ ...base(), extra: true })).statusCode).toBe(400);
      expect(await prisma.openingSituation.count()).toBe(0);
    });

    it("refuse un compte dont le solde de départ n'est pas à la même date", async () => {
      const second = await call("PATCH", `/financial-accounts/${ids.fSavings}`, treasurer, { openingBalance: "10.00" });
      expect(second.statusCode, second.body).toBe(200);
      expect((await view()).misaligned.map((a) => a.name)).toEqual(["Livret"]);
      const refused = await record(base());
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("« Livret » (01/03/2026)");
      expect(refused.json().message).toContain("même date");
      expect((await call("PATCH", `/financial-accounts/${ids.fSavings}`, treasurer, { openingBalance: "0" })).statusCode).toBe(200);
    });

    it("enregistre en une écriture l'argent, ce qu'on doit et ce qu'on nous doit, et calcule le fonds", async () => {
      const response = await record(base());
      expect(response.statusCode, response.body).toBe(201);
      const result = response.json();
      expect(result).toMatchObject({ posted: true, journalCode: "AN", equity: "960.00", lines: 5 });
      expect(result.number).toBe(1);
      ids.entry = result.entryId;

      const entry = (await call("GET", `/entries/${result.entryId}`, treasurer)).json();
      expect(entry).toMatchObject({ status: "POSTED", date: "2026-01-01" });
      expect(entry.label).toContain("Situation d'ouverture au 01/01/2026");
      expect(entry.lines.map((l: { accountNumber: string; debit: string; credit: string }) => [l.accountNumber, l.debit, l.credit])).toEqual([
        ["5121", "1000.00", "0.00"],
        ["5311", "50.00", "0.00"],
        ["411", "30.00", "0.00"],
        ["401", "0.00", "120.00"],
        ["102", "0.00", "960.00"],
      ]);
      expect(entry.lines[2].label).toContain("Marie Dupont");
      // Chaque ligne « on vous doit / vous devez » désigne une fiche tiers créée à cette occasion ; l'argent et le fonds n'en ont pas.
      expect(entry.lines.map((l: { thirdParty: { name: string; kind: string } | null }) => l.thirdParty && [l.thirdParty.name, l.thirdParty.kind])).toEqual([null, null, ["Marie Dupont", "OTHER"], ["Imprimeur", "SUPPLIER"], null]);
      expect(await prisma.thirdParty.count()).toBe(2);
      const debit = entry.lines.reduce((s: number, l: { debit: string }) => s + Number(l.debit), 0);
      const credit = entry.lines.reduce((s: number, l: { credit: string }) => s + Number(l.credit), 0);
      expect(debit).toBe(credit);
    });

    it("retrouve un tiers existant par son nom ou par son identifiant au lieu d'en créer un second", async () => {
      expect((await call("POST", `/entries/${ids.entry}/reverse`, treasurer, {})).statusCode).toBe(201);
      const existing = await prisma.thirdParty.findFirstOrThrow({ where: { name: "Imprimeur" } });
      const again = await record({
        date: "2026-01-01",
        receivables: [{ kind: "MEMBERSHIP_DUE", label: "MARIE DUPONT", amount: "30.00" }],
        payables: [{ kind: "SUPPLIER_OWED", thirdPartyId: existing.id, amount: "120.00" }],
        equityAmount: "960.00",
        equityAccountId: ids.funds,
        explanation: "Fonds apportés à la création",
      });
      expect(again.statusCode, again.body).toBe(201);
      expect(await prisma.thirdParty.count()).toBe(2);
      ids.entry = again.json().entryId;

      const archived = await prisma.thirdParty.create({ data: { kind: "OTHER", name: "Ancien", archivedAt: new Date() } });
      await call("POST", `/entries/${ids.entry}/reverse`, treasurer, {});
      const refused = await record({ ...base(), payables: [{ kind: "OTHER_OWED", thirdPartyId: archived.id, amount: "120.00" }] });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("archivé");
      const noName = await record({ ...base(), receivables: [{ kind: "MEMBERSHIP_DUE", amount: "30.00" }] });
      expect(noName.statusCode).toBe(400);
      // On rétablit la situation initiale pour la suite des tests.
      const restored = await record(base());
      expect(restored.statusCode, restored.body).toBe(201);
      ids.entry = restored.json().entryId;
    });

    it("n'en accepte qu'une, et la vue d'ensemble n'en demande plus", async () => {
      const again = await record(base());
      expect(again.statusCode).toBe(409);
      expect(again.json().message).toContain("existe déjà");
      expect((await view()).existing).toMatchObject({ entryId: ids.entry, status: "POSTED", date: "2026-01-01" });
      const overview = (await call("GET", "/overview", treasurer)).json();
      expect(overview.setup).toMatchObject({ startMode: "OPENING", openingSituation: "POSTED" });
      expect(overview.todo.map((t: { code: string }) => t.code)).not.toContain("OPENING_SITUATION");
      const blocked = await call("PUT", "/start-mode", treasurer, { mode: "HISTORY" });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().message).toContain("situation d'ouverture");
    });

    it("compte pour l'ouverture dans le tableau de progression, et empêche la reprise de la compter deux fois", async () => {
      const progress = (await call("GET", "/recovery-progress", treasurer)).json();
      const year = progress.years[0];
      const openings = year.accounts.filter((a: { opening: { state: string } | null }) => a.opening?.state === "POSTED").map((a: { name: string }) => a.name);
      expect(openings.sort()).toEqual(["Banque", "Caisse"]);
      expect(year.anomalies.map((a: { code: string }) => a.code)).not.toContain("OPENING_MISSING");

      // Le mode « reprise de l'historique » est déjà refusé ; le lot, lui, refuse aussi de reprendre le solde.
      const batch = (await call("POST", "/recovery-batches", treasurer, { name: "Reprise 2026" })).json();
      const opening = await call("POST", `/recovery-batches/${batch.id}/opening`, treasurer, { financialAccountId: ids.fBank, counterpartAccountId: ids.funds, explanation: "Fonds apportés à la création" });
      expect(opening.statusCode).toBe(409);
      expect(opening.json().message).toContain("situation d'ouverture");
    });

    it("la base refuse une seconde situation vivante, une modification et un TRUNCATE", async () => {
      const second = await prisma.journalEntry.create({
        data: { fiscalYearId: (await prisma.fiscalYear.findFirstOrThrow()).id, journalId: (await prisma.journal.findFirstOrThrow({ where: { type: "OPENING" } })).id, date: new Date("2026-01-01T00:00:00Z"), label: "Autre" },
      });
      const insert = await sqlError(`INSERT INTO "OpeningSituation" ("id","entryId","date") VALUES (gen_random_uuid(), '${second.id}', '2026-01-01')`);
      expect(insert).toContain("existe déjà");
      expect(await sqlError(`UPDATE "OpeningSituation" SET "date" = '2026-01-02'`)).toContain("ne se modifie pas");
      expect(await sqlError(`TRUNCATE "OpeningSituation"`)).toMatch(/TRUNCATE|refus|interdit/i);
      await prisma.journalEntry.delete({ where: { id: second.id } });
    });
  });

  describe("refaire la situation", () => {
    it("annuler l'écriture libère la place ; sans écart, aucun fonds n'est demandé ; un brouillon se supprime", async () => {
      expect((await call("POST", `/entries/${ids.entry}/reverse`, treasurer, {})).statusCode).toBe(201);
      expect((await view()).existing).toBeNull();

      const draft = await record({
        date: "2026-01-01",
        receivables: [],
        payables: [{ kind: "OTHER_OWED", label: "Prêt d'un adhérent", amount: "1050.00" }],
        equityAmount: "0",
        post: false,
      });
      expect(draft.statusCode, draft.body).toBe(201);
      expect(draft.json()).toMatchObject({ posted: false, equity: "0.00", lines: 3 });
      const state = await view();
      expect(state.existing).toMatchObject({ status: "DRAFT" });
      const overview = (await call("GET", "/overview", treasurer)).json();
      expect(overview.setup.openingSituation).toBe("DRAFT");
      expect(overview.todo.find((t: { code: string }) => t.code === "OPENING_SITUATION").title).toContain("Enregistrer");

      expect((await call("DELETE", `/entries/${draft.json().entryId}`, treasurer)).statusCode).toBe(204);
      expect((await view()).existing).toBeNull();
      expect(await prisma.openingSituation.count({ where: { entryId: draft.json().entryId } })).toBe(0);
    });
  });
});
