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

describe("Écritures comptables : brouillon, comptabilisation, contrepassation (base vierge)", () => {
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
    const email = `e-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "E", password: PASSWORD });
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

  const lines = (amount: string, debitAccount = "bank", creditAccount = "sales") => [
    { accountId: ids[debitAccount]!, debit: amount },
    { accountId: ids[creditAccount]!, credit: amount },
  ];
  const draft = (overrides: Record<string, unknown> = {}) => ({
    journalId: ids.OD,
    date: "2026-03-15",
    label: "Cotisation",
    lines: lines("50.00"),
    ...overrides,
  });
  const createDraft = async (overrides: Record<string, unknown> = {}) => {
    const response = await call("POST", "/entries", treasurer, draft(overrides));
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const post = (id: string) => call("POST", `/entries/${id}/post`, treasurer);
  const counterOf = (journal: string, year: string) =>
    prisma.$queryRawUnsafe<{ lastNumber: number }[]>(
      `SELECT "lastNumber" FROM "EntryCounter" WHERE "journalId"='${ids[journal]}' AND "fiscalYearId"='${ids[year]}'`,
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
    reader = await userWith("reader");

    for (const journal of await prisma.journal.findMany()) ids[journal.code] = journal.id;
    for (const [key, number, label] of [
      ["bank", "512", "Banque"],
      ["sales", "706", "Prestations"],
      ["purchases", "606", "Achats"],
      ["old", "607", "Compte à désactiver"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.fy2026 = (await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).json().id;
    ids.fy2027 = (await call("POST", "/fiscal-years", treasurer, { label: "2027", start: "2027-01-01", end: "2027-12-31" })).json().id;
    ids.fy2030 = (await call("POST", "/fiscal-years", treasurer, { label: "2030", start: "2030-01-01", end: "2030-12-31" })).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("répartit les droits : lecture, brouillon, comptabilisation", async () => {
    expect((await call("GET", "/entries")).statusCode).toBe(401);
    expect((await call("GET", "/entries", reader)).statusCode).toBe(403);
    expect((await call("GET", "/entries", boardMember)).statusCode).toBe(200);
    expect((await call("POST", "/entries", boardMember, draft())).statusCode).toBe(403);
    const created = await createDraft();
    expect((await call("POST", `/entries/${created.id}/post`, boardMember)).statusCode).toBe(403);
    expect((await call("POST", `/entries/${created.id}/reverse`, boardMember, {})).statusCode).toBe(403);
    expect((await call("DELETE", `/entries/${created.id}`, boardMember)).statusCode).toBe(403);
  });

  describe("brouillons", () => {
    it("crée un brouillon sans numéro, rattaché à l'exercice de sa date, même déséquilibré", async () => {
      const entry = await createDraft({ lines: [{ accountId: ids.bank, debit: "10.00" }] });
      expect(entry).toMatchObject({ status: "DRAFT", number: null, version: 1, fiscalYearId: ids.fy2026, totalDebit: "10.00", totalCredit: "0.00" });
    });

    it("refuse une date sans exercice, un journal ou un compte inconnu et des montants invalides", async () => {
      expect((await call("POST", "/entries", treasurer, draft({ date: "2035-01-01" }))).statusCode).toBe(409);
      expect((await call("POST", "/entries", treasurer, draft({ journalId: randomUUID() }))).statusCode).toBe(409);
      expect((await call("POST", "/entries", treasurer, draft({ lines: [{ accountId: randomUUID(), debit: "5" }] }))).statusCode).toBe(409);
      for (const line of [
        { accountId: ids.bank, debit: "-5.00" },
        { accountId: ids.bank, debit: "5.123" },
        { accountId: ids.bank, debit: "1e3" },
        { accountId: ids.bank, debit: "5", credit: "5" },
        { accountId: ids.bank },
        { accountId: ids.bank, debit: 5 },
      ]) {
        expect((await call("POST", "/entries", treasurer, draft({ lines: [line] }))).statusCode, JSON.stringify(line)).toBe(400);
      }
    });

    it("modifie un brouillon avec contrôle de version optimiste", async () => {
      const entry = await createDraft();
      const body = { ...draft({ label: "Modifiée" }), version: entry.version };
      const updated = await call("PUT", `/entries/${entry.id}`, treasurer, body);
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json()).toMatchObject({ label: "Modifiée", version: 2 });
      // La même version, rejouée, est périmée.
      expect((await call("PUT", `/entries/${entry.id}`, treasurer, body)).statusCode).toBe(409);
      // Le brouillon n'a pas été touché par la tentative périmée.
      expect((await call("GET", `/entries/${entry.id}`, treasurer)).json().version).toBe(2);
    });

    it("supprime un brouillon, jamais une écriture comptabilisée", async () => {
      const entry = await createDraft();
      expect((await call("DELETE", `/entries/${entry.id}`, treasurer)).statusCode).toBe(204);
      expect((await call("GET", `/entries/${entry.id}`, treasurer)).statusCode).toBe(404);

      const posted = await createDraft();
      expect((await post(posted.id)).statusCode).toBe(200);
      expect((await call("DELETE", `/entries/${posted.id}`, treasurer)).statusCode).toBe(409);
    });
  });

  describe("comptabilisation", () => {
    it("numérote par journal et par exercice, sans trou, et recommence à 1 ailleurs", async () => {
      const first = (await post((await createDraft({ journalId: ids.AC })).id)).json();
      const second = (await post((await createDraft({ journalId: ids.AC })).id)).json();
      const otherJournal = (await post((await createDraft({ journalId: ids.PR })).id)).json();
      const otherYear = (await post((await createDraft({ journalId: ids.AC, date: "2027-02-01" })).id)).json();
      expect([first.number, second.number, otherJournal.number, otherYear.number]).toEqual([1, 2, 1, 1]);
      expect(first).toMatchObject({ status: "POSTED", journalCode: "AC" });
      expect(first.postedAt).toBeTruthy();
      expect((await post(first.id)).statusCode).toBe(409);
    });

    it("refuse une écriture déséquilibrée sans rien écrire (CA-03)", async () => {
      const entry = await createDraft({ lines: [{ accountId: ids.bank, debit: "100.00" }, { accountId: ids.sales, credit: "99.99" }] });
      const before = await counterOf("OD", "fy2026");
      const response = await post(entry.id);
      expect(response.statusCode).toBe(422);
      expect(response.json().issues.map((i: { code: string }) => i.code)).toContain("UNBALANCED");

      const after = await call("GET", `/entries/${entry.id}`, treasurer);
      expect(after.json()).toMatchObject({ status: "DRAFT", number: null });
      expect(await counterOf("OD", "fy2026")).toEqual(before);
    });

    it("refuse moins de deux lignes, un compte ou un journal désactivé, côté API", async () => {
      const single = await createDraft({ lines: [{ accountId: ids.bank, debit: "5.00" }] });
      expect((await post(single.id)).statusCode).toBe(422);

      await prisma.account.update({ where: { id: ids.old! }, data: { active: false } });
      const onOldAccount = await createDraft({ lines: lines("5.00", "old", "sales") });
      const refused = await post(onOldAccount.id);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().issues[0].message).toContain("607");
      await prisma.account.update({ where: { id: ids.old! }, data: { active: true } });

      const noJournal = await createDraft({ journalId: ids.PR });
      await prisma.journal.update({ where: { id: ids.PR! }, data: { active: false } });
      expect((await post(noJournal.id)).statusCode).toBe(422);
      await prisma.journal.update({ where: { id: ids.PR! }, data: { active: true } });
    });

    it("la base refuse elle-même ce que le service contrôlerait (aucun contournement par SQL)", async () => {
      const unbalanced = await createDraft({ lines: [{ accountId: ids.bank, debit: "100.00" }, { accountId: ids.sales, credit: "1.00" }] });
      expect(await sqlError(`UPDATE "JournalEntry" SET "status"='POSTED' WHERE id='${unbalanced.id}'`)).toContain("déséquilibrée");
      expect(await sqlError(`UPDATE "JournalEntry" SET "status"='POSTED', "number"=99, "postedAt"=now() WHERE id='${unbalanced.id}'`)).toContain("déséquilibrée");
      expect(await sqlError(`INSERT INTO "JournalEntry" ("id","fiscalYearId","journalId","date","label","status","number","postedAt") VALUES (gen_random_uuid(),'${ids.fy2026}','${ids.OD}','2026-01-01','Direct','POSTED',1,now())`)).toContain("brouillon");
      expect(await sqlError(`INSERT INTO "JournalLine" ("id","entryId","position","accountId","debit","credit") VALUES (gen_random_uuid(),'${unbalanced.id}',9,'${ids.bank}',-5,0)`)).toContain("JournalLine_amounts_sign");
      expect(await sqlError(`INSERT INTO "JournalLine" ("id","entryId","position","accountId","debit","credit") VALUES (gen_random_uuid(),'${unbalanced.id}',9,'${ids.bank}',5,5)`)).toContain("JournalLine_one_side");
      expect(await sqlError(`UPDATE "JournalEntry" SET "date"='2027-01-01' WHERE id='${unbalanced.id}'`)).toContain("hors de l'exercice");
    });

    it("rend une écriture comptabilisée immuable, lignes comprises", async () => {
      const posted = (await post((await createDraft()).id)).json();
      expect(await sqlError(`UPDATE "JournalEntry" SET "label"='Altérée' WHERE id='${posted.id}'`)).toContain("immuable");
      expect(await sqlError(`UPDATE "JournalEntry" SET "number"=1234 WHERE id='${posted.id}'`)).toContain("immuable");
      expect(await sqlError(`UPDATE "JournalEntry" SET "status"='DRAFT', "number"=NULL, "postedAt"=NULL WHERE id='${posted.id}'`)).toContain("immuable");
      expect(await sqlError(`DELETE FROM "JournalEntry" WHERE id='${posted.id}'`)).toContain("contrepasse");
      expect(await sqlError(`UPDATE "JournalLine" SET "debit"=999 WHERE "entryId"='${posted.id}' AND "debit">0`)).toContain("immuables");
      expect(await sqlError(`DELETE FROM "JournalLine" WHERE "entryId"='${posted.id}'`)).toContain("immuables");
      expect(await sqlError(`INSERT INTO "JournalLine" ("id","entryId","position","accountId","debit") VALUES (gen_random_uuid(),'${posted.id}',7,'${ids.bank}',5)`)).toContain("immuables");
      expect((await call("PUT", `/entries/${posted.id}`, treasurer, { ...draft(), version: 1 })).statusCode).toBe(409);
    });

    it("protège le compteur de numérotation", async () => {
      expect(await sqlError(`UPDATE "EntryCounter" SET "lastNumber"=1 WHERE "lastNumber">1`)).toContain("d'un numéro");
      expect(await sqlError(`UPDATE "EntryCounter" SET "lastNumber"="lastNumber"+5`)).toContain("d'un numéro");
      expect(await sqlError(`DELETE FROM "EntryCounter"`)).toContain("ne se supprime pas");
      for (const table of ["EntryCounter", "JournalEntry", "JournalLine", "FiscalYear", "Journal", "Account"]) {
        expect(await sqlError(`TRUNCATE "${table}" CASCADE`), table).toContain("TRUNCATE refusé");
      }
    });

    it("attribue des numéros uniques et consécutifs sous comptabilisation concurrente", async () => {
      const drafts = await Promise.all(Array.from({ length: 12 }, () => createDraft({ journalId: ids.OD, date: "2026-06-01" })));
      const before = (await counterOf("OD", "fy2026"))[0]?.lastNumber ?? 0;
      const results = await Promise.all(drafts.map((d) => post(d.id)));
      expect(results.map((r) => r.statusCode)).toEqual(Array(12).fill(200));
      const numbers = results.map((r) => r.json().number as number).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => before + i + 1));
    });

    it("tranche une comptabilisation concurrente d'une clôture : validée avant, ou refusée (CA-04)", async () => {
      const entry = await createDraft({ date: "2030-05-05" });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let closingStarted!: () => void;
      const started = new Promise<void>((resolve) => (closingStarted = resolve));

      // Passage à « en cours de clôture » tenu ouvert : il détient le verrou de l'exercice.
      const closing = prisma.$transaction(async (tx) => {
        await tx.fiscalYear.update({ where: { id: ids.fy2030! }, data: { status: "CLOSING" } });
        closingStarted();
        await gate;
      });
      await started;

      let settled = false;
      const posting = post(entry.id).then((response) => {
        settled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled, "la comptabilisation doit attendre la fin du passage en clôture").toBe(false);

      release();
      await closing;
      const response = await posting;
      expect(response.statusCode).toBe(422);
      expect(JSON.stringify(response.json())).toContain("pas ouvert");
      expect((await call("GET", `/entries/${entry.id}`, treasurer)).json()).toMatchObject({ status: "DRAFT", number: null });
      expect(await counterOf("OD", "fy2030")).toEqual([]);
    });

    it("empêche de raccourcir un exercice au point d'exclure une écriture", async () => {
      await createDraft({ date: "2026-12-30" });
      const response = await call("PATCH", `/fiscal-years/${ids.fy2026}`, treasurer, { end: "2026-12-01" });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("excluraient");
      expect(await sqlError(`UPDATE "FiscalYear" SET "end"='2026-12-01' WHERE id='${ids.fy2026}'`)).toContain("excluraient");
    });
  });

  describe("contrepassation", () => {
    it("crée une écriture inverse reliée, comptabilisée, et marque l'originale contrepassée", async () => {
      const original = (await post((await createDraft({ label: "À annuler", journalId: ids.AN })).id)).json();
      const response = await call("POST", `/entries/${original.id}/reverse`, treasurer, {});
      expect(response.statusCode, response.body).toBe(201);
      const reversal = response.json();
      expect(reversal).toMatchObject({
        kind: "REVERSAL",
        status: "POSTED",
        reversalOfId: original.id,
        journalCode: "AN",
        label: "Contrepassation : À annuler",
        totalDebit: "50.00",
        totalCredit: "50.00",
      });
      expect(reversal.number).toBe(original.number + 1);
      // Les sens sont inversés ligne à ligne.
      expect(reversal.lines.map((l: { debit: string; credit: string }) => [l.debit, l.credit])).toEqual([
        ["0.00", "50.00"],
        ["50.00", "0.00"],
      ]);

      const reread = (await call("GET", `/entries/${original.id}`, treasurer)).json();
      expect(reread).toMatchObject({ status: "REVERSED", reversedById: reversal.id });
    });

    it("refuse une seconde contrepassation, la contrepassation d'une contrepassation ou d'un brouillon", async () => {
      const original = (await post((await createDraft()).id)).json();
      const reversal = (await call("POST", `/entries/${original.id}/reverse`, treasurer, {})).json();
      expect((await call("POST", `/entries/${original.id}/reverse`, treasurer, {})).statusCode).toBe(409);
      expect((await call("POST", `/entries/${reversal.id}/reverse`, treasurer, {})).statusCode).toBe(409);
      const pending = await createDraft();
      expect((await call("POST", `/entries/${pending.id}/reverse`, treasurer, {})).statusCode).toBe(409);
      expect((await call("POST", `/entries/${randomUUID()}/reverse`, treasurer, {})).statusCode).toBe(404);
    });

    it("peut dater la contrepassation dans un autre exercice ouvert, avec son propre numéro", async () => {
      const original = (await post((await createDraft({ journalId: ids.OD, date: "2026-11-20" })).id)).json();
      const response = await call("POST", `/entries/${original.id}/reverse`, treasurer, { date: "2027-01-02", label: "Contrepassation à l'ouverture" });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ fiscalYearId: ids.fy2027, label: "Contrepassation à l'ouverture", date: "2027-01-02" });
    });

    it("refuse de contrepasser vers un exercice qui n'est plus ouvert, sans rien modifier", async () => {
      const original = (await post((await createDraft({ date: "2027-07-07" })).id)).json();
      await prisma.fiscalYear.update({ where: { id: ids.fy2027! }, data: { status: "CLOSING" } });
      const response = await call("POST", `/entries/${original.id}/reverse`, treasurer, {});
      expect(response.statusCode).toBe(422);
      expect((await call("GET", `/entries/${original.id}`, treasurer)).json().status).toBe("POSTED");
      expect(await prisma.journalEntry.count({ where: { reversalOfId: original.id } })).toBe(0);
    });

    it("la base refuse de marquer une écriture contrepassée sans sa contrepassation", async () => {
      const original = (await post((await createDraft()).id)).json();
      expect(await sqlError(`UPDATE "JournalEntry" SET "status"='REVERSED' WHERE id='${original.id}'`)).toContain("sa contrepassation comptabilisée");
    });
  });

  it("liste avec filtres et pagination, et trace chaque étape dans l'audit", async () => {
    const page = (await call("GET", `/entries?fiscalYearId=${ids.fy2026}&status=POSTED&limit=3`, boardMember)).json();
    expect(page.entries).toHaveLength(3);
    expect(page.entries.every((e: { status: string }) => e.status === "POSTED")).toBe(true);
    expect(page.next).toBeTruthy();
    const next = (await call("GET", `/entries?fiscalYearId=${ids.fy2026}&status=POSTED&limit=3&after=${page.next}`, boardMember)).json();
    expect(next.entries.map((e: { id: string }) => e.id)).not.toContain(page.entries[0].id);
    expect((await call("GET", "/entries?limit=0", boardMember)).statusCode).toBe(400);
    expect((await call("GET", "/entries?status=AUTRE", boardMember)).statusCode).toBe(400);

    const actions = new Set((await prisma.auditEvent.findMany({ where: { objectType: "JournalEntry" } })).map((e) => e.action));
    for (const action of ["entry.created", "entry.updated", "entry.deleted", "entry.posted", "entry.reversed"]) {
      expect(actions.has(action), action).toBe(true);
    }
  });
});
