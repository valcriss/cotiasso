import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { isLinkableObjectType } from "../../src/documents/categories.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
}
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Summary {
  id: string;
  number: number;
  kind: string;
  provisional: boolean;
  label: string;
  reason: string | null;
  supersedesNumber: number | null;
  latest: boolean;
  sha256: string;
  approval: { meetingDate: string; note: string } | null;
}

describe("Rapports figés (ADR 0031, base vierge)", () => {
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
    const email = `f-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "F", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
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
  const posted = async (date: string, debit: [string, string], credit: [string, string]) => {
    const created = await call("POST", "/entries", treasurer, {
      journalId: ids.OD,
      date,
      label: "Écriture",
      lines: [{ accountId: ids[debit[0]], debit: debit[1] }, { accountId: ids[credit[0]], credit: credit[1] }],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((await call("POST", `/entries/${created.json().id}/post`, treasurer)).statusCode).toBe(200);
  };
  const freeze = (year: string, body: object = {}, session = treasurer) => call("POST", `/fiscal-years/${ids[year]}/frozen-reports`, session, body);
  const list = async (year: string) => (await call("GET", `/fiscal-years/${ids[year]}/frozen-reports`, treasurer)).json() as Summary[];
  const detail = async (id: string) => {
    const response = await call("GET", `/frozen-reports/${id}`, treasurer);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Summary & { intact: boolean; content: { meta: { provisional: boolean; calcVersion: number; draftEntries: number }; incomeStatement: { result: string; previous: unknown; carryWarning: string | null }; balanceSheet: { balanced: boolean }; treasury: { totals: { closing: string } } } };
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
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");

    for (const [key, label, start, end] of [
      ["fy2024", "2024", "2024-01-01", "2024-12-31"],
      ["fy2025", "2025", "2025-01-01", "2025-12-31"],
      ["fy2026", "2026", "2026-01-01", "2026-12-31"],
    ] as const) {
      const created = await call("POST", "/fiscal-years", treasurer, { label, start, end });
      expect(created.statusCode, created.body).toBe(201);
      ids[key] = created.json().id;
    }
    for (const [key, number, label] of [
      ["bank", "512", "Banque"],
      ["fonds", "102", "Fonds associatifs"],
      ["sales", "706", "Prestations"],
      ["charges", "606", "Achats"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.OD = (await call("GET", "/journals", treasurer)).json().find((j: { code: string }) => j.code === "OD").id;
    await posted("2024-01-10", ["bank", "1000.00"], ["fonds", "1000.00"]);
    await posted("2024-03-10", ["bank", "300.00"], ["sales", "300.00"]);
    await posted("2025-02-10", ["bank", "50.00"], ["sales", "50.00"]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("réserve la lecture à reports:view et le figement ou l'approbation à fiscal-years:close", async () => {
    expect((await call("GET", `/fiscal-years/${ids.fy2025}/frozen-reports`)).statusCode).toBe(401);
    expect((await call("GET", `/fiscal-years/${ids.fy2025}/frozen-reports`, reader)).statusCode).toBe(403);
    expect((await call("GET", `/fiscal-years/${ids.fy2025}/frozen-reports`, boardMember)).statusCode).toBe(200);
    expect((await freeze("fy2025", {}, boardMember)).statusCode).toBe(403);
    expect((await call("POST", `/frozen-reports/${randomUUID()}/approve`, boardMember, { meetingDate: "2026-06-01" })).statusCode).toBe(403);
    expect((await call("GET", `/frozen-reports/${randomUUID()}`, treasurer)).statusCode).toBe(404);
    expect((await call("GET", `/fiscal-years/${randomUUID()}/frozen-reports`, treasurer)).statusCode).toBe(404);
    expect((await call("GET", "/frozen-reports/pas-un-uuid", treasurer)).statusCode).toBe(400);
    expect((await freeze("fy2025", { extra: 1 })).statusCode).toBe(400);
  });

  describe("à la demande", () => {
    it("fige les trois états de l'exercice, provisoires tant qu'il n'est pas clôturé", async () => {
      expect(await list("fy2025")).toEqual([]);
      const response = await freeze("fy2025");
      expect(response.statusCode, response.body).toBe(201);
      const first = response.json() as Summary;
      expect(first).toMatchObject({ number: 1, kind: "MANUAL", provisional: true, supersedesNumber: null, latest: true, reason: null, approval: null });
      expect(first.label).toContain("Rapports provisoires");
      expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
      ids.set1 = first.id;

      const full = await detail(first.id);
      expect(full.intact).toBe(true);
      expect(full.content.meta).toMatchObject({ provisional: true, calcVersion: 1, draftEntries: 0 });
      expect(full.content.incomeStatement.result).toBe("50.00");
      expect(full.content.incomeStatement.previous).toMatchObject({ label: "2024" });
      expect(full.content.balanceSheet.balanced).toBe(true);
      // 2024 n'est pas clôturé : ses soldes ne sont pas reportés, la trésorerie ne compte que 2025.
      expect(full.content.treasury.totals.closing).toBe("50.00");
      // 2024 n'est pas clôturé : le rapport le dit au lieu de présenter des soldes non reportés comme complets.
      expect(full.content.incomeStatement.carryWarning).toContain("n'est pas clôturé");
    });

    it("une nouvelle version demande un motif, dit laquelle elle remplace, et l'ancienne reste intacte", async () => {
      const refused = await freeze("fy2025");
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("pourquoi");
      expect((await freeze("fy2025", { reason: "ok" })).statusCode).toBe(409);

      await posted("2025-04-01", ["bank", "25.00"], ["sales", "25.00"]);
      const second = (await freeze("fy2025", { reason: "Une cotisation avait été oubliée", label: "Rapports corrigés" })).json() as Summary;
      expect(second).toMatchObject({ number: 2, supersedesNumber: 1, latest: true, reason: "Une cotisation avait été oubliée", label: "Rapports corrigés" });

      const versions = await list("fy2025");
      expect(versions.map((v) => [v.number, v.latest])).toEqual([[2, true], [1, false]]);
      // Les figés sont des photographies : la première version garde ses chiffres d'origine, la seconde porte les nouveaux.
      expect((await detail(ids.set1!)).content.incomeStatement.result).toBe("50.00");
      expect((await detail(second.id)).content.incomeStatement.result).toBe("75.00");
      ids.set2 = second.id;
    });

    it("deux figements simultanés ne créent ni doublon ni trou : l'un passe, l'autre est invité à actualiser", async () => {
      const [a, b] = await Promise.all([freeze("fy2025", { reason: "Premier essai simultané" }), freeze("fy2025", { reason: "Second essai simultané" })]);
      const statuses = [a.statusCode, b.statusCode];
      // Selon le moment, les deux passent l'un après l'autre ou l'un est invité à actualiser : jamais de doublon ni de trou.
      expect(statuses.every((code) => code === 201 || code === 409), statuses.join()).toBe(true);
      expect(statuses).toContain(201);
      const numbers = (await list("fy2025")).map((v) => v.number);
      expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => numbers.length - index));
      expect(numbers.length).toBe(2 + statuses.filter((code) => code === 201).length);
      for (const loser of [a, b].filter((r) => r.statusCode === 409)) expect(loser.json().message).toMatch(/Actualisez|entre-temps/);
    });

    it("l'audit consigne le figement sans en copier le contenu", async () => {
      const events = await prisma.auditEvent.findMany({ where: { action: "frozen-report.created" }, orderBy: { seq: "asc" } });
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0]!.details).toMatchObject({ number: 1, kind: "MANUAL", provisional: true });
      expect(JSON.stringify(events.map((e) => e.details))).not.toMatch(/1350|result|sections/);
    });
  });

  describe("garanties en base", () => {
    it("un jeu figé ne se modifie ni ne se supprime, et TRUNCATE est refusé", async () => {
      expect(await sqlError(`UPDATE "FrozenReportSet" SET "label" = 'autre' WHERE "id" = '${ids.set1}'`)).toContain("ne se modifie ni ne se supprime");
      expect(await sqlError(`DELETE FROM "FrozenReportSet" WHERE "id" = '${ids.set1}'`)).toContain("ne se modifie ni ne se supprime");
      expect(await sqlError(`TRUNCATE "FrozenReportSet" CASCADE`)).toMatch(/TRUNCATE|refus|interdit/i);
    });

    it("refuse un numéro qui saute, une version qui n'en remplace pas la précédente, et un jeu de clôture avant la clôture", async () => {
      const next = (await list("fy2025"))[0]!.number + 1;
      const base = (number: number, supersedes: string | null, kind: string, provisional: boolean, reason = "NULL") =>
        `INSERT INTO "FrozenReportSet" ("id","fiscalYearId","number","kind","provisional","label","reason","supersedesId","calcVersion","payload","sha256")
         VALUES (gen_random_uuid(), '${ids.fy2025}', ${number}, '${kind}', ${provisional}, 'x', ${reason}, ${supersedes ? `'${supersedes}'` : "NULL"}, 1, '{}', 'x')`;
      expect(await sqlError(base(9, null, "MANUAL", true, "'motif valable'"))).toContain("Numéro de version inattendu");
      expect(await sqlError(base(next, ids.set1!, "MANUAL", true, "'motif valable'"))).toContain("remplace la version précédente");
      expect(await sqlError(base(next, (await list("fy2025"))[0]!.id, "CLOSED", true))).toContain("quand l'exercice est clôturé");
      expect(await sqlError(base(next, (await list("fy2025"))[0]!.id, "MANUAL", false, "'motif valable'"))).toContain("provisoire tant que l'exercice");
      expect(await sqlError(base(next, (await list("fy2025"))[0]!.id, "MANUAL", true, "'ok'"))).toContain("demande un motif");
    });

    it("une altération du contenu en base est détectée par l'empreinte", async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "FrozenReportSet" DISABLE TRIGGER "FrozenReportSet_guard"`);
      try {
        await prisma.$executeRawUnsafe(`UPDATE "FrozenReportSet" SET "payload" = jsonb_set("payload", '{incomeStatement,result}', '"999999.00"') WHERE "id" = '${ids.set1}'`);
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE "FrozenReportSet" ENABLE TRIGGER "FrozenReportSet_guard"`);
      }
      expect((await detail(ids.set1!)).intact).toBe(false);
      expect((await detail(ids.set2!)).intact).toBe(true);
      // On remet le contenu d'origine pour la suite.
      await prisma.$executeRawUnsafe(`ALTER TABLE "FrozenReportSet" DISABLE TRIGGER "FrozenReportSet_guard"`);
      try {
        await prisma.$executeRawUnsafe(`UPDATE "FrozenReportSet" SET "payload" = jsonb_set("payload", '{incomeStatement,result}', '"50.00"') WHERE "id" = '${ids.set1}'`);
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE "FrozenReportSet" ENABLE TRIGGER "FrozenReportSet_guard"`);
      }
      expect((await detail(ids.set1!)).intact).toBe(true);
    });
  });

  describe("à la fermeture et à la clôture", () => {
    const closing = (action: string, body?: object) => call("POST", `/fiscal-years/${ids.fy2024}/closing/${action}`, treasurer, body ?? {});

    it("la fermeture à la saisie fige un arrêté provisoire sans rien demander", async () => {
      const started = await closing("start");
      expect(started.statusCode, started.body).toBe(200);
      expect(started.json().frozen).toEqual({ number: 1, provisional: true });
      const [set] = await list("fy2024");
      expect(set).toMatchObject({ number: 1, kind: "CLOSING", provisional: true, supersedesNumber: null });
      expect(set!.label).toContain("Arrêté provisoire");
      // Premier exercice : pas d'exercice précédent, la colonne est absente (jamais des zéros).
      expect((await detail(set!.id)).content.incomeStatement.previous).toBeNull();
    });

    it("annuler la fermeture garde l'arrêté provisoire, et la fermer à nouveau en fige un autre qui le remplace", async () => {
      expect((await closing("cancel")).statusCode).toBe(200);
      expect(await list("fy2024")).toHaveLength(1);
      const again = await closing("start");
      expect(again.json().frozen).toEqual({ number: 2, provisional: true });
      expect((await list("fy2024")).map((v) => [v.number, v.supersedesNumber])).toEqual([[2, 1], [1, null]]);
    });

    it("refuse d'approuver des rapports provisoires, en disant pourquoi", async () => {
      const [latest] = await list("fy2024");
      const refused = await call("POST", `/frozen-reports/${latest!.id}/approve`, treasurer, { meetingDate: "2025-06-01" });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("définitifs");
    });

    it("la clôture fige les comptes définitifs", async () => {
      const closed = await closing("close", { surplusAccountId: ids.fonds });
      expect(closed.statusCode, closed.body).toBe(200);
      expect(closed.json().frozen).toEqual({ number: 3, provisional: false });
      const [set] = await list("fy2024");
      expect(set).toMatchObject({ number: 3, kind: "CLOSED", provisional: false, supersedesNumber: 2, latest: true });
      const full = await detail(set!.id);
      expect(full.content.meta.provisional).toBe(false);
      expect(full.content.incomeStatement.result).toBe("300.00");
      ids.closedSet = set!.id;
    });

    it("un figement automatique qui échoue est signalé et tracé, sans empêcher la fermeture", async () => {
      // On provoque un refus de la base : un jeu de clôture est attendu pour un exercice clôturé, pas de fermeture.
      const outcome = await app.get((await import("../../src/accounting/frozen-reports.service.js")).FrozenReportsService).freezeAutomatically(ids.fy2024!, "CLOSING", (await prisma.user.findFirstOrThrow()).id);
      expect(outcome).toHaveProperty("error");
      expect(await prisma.auditEvent.count({ where: { action: "frozen-report.failed" } })).toBe(1);
    });
  });

  describe("approbation par l'assemblée générale", () => {
    it("valide la date, enregistre l'approbation une seule fois et la montre sur le jeu", async () => {
      expect((await call("POST", `/frozen-reports/${ids.closedSet}/approve`, treasurer, { meetingDate: "2025-13-45" })).statusCode).toBe(400);
      expect((await call("POST", `/frozen-reports/${ids.closedSet}/approve`, treasurer, {})).statusCode).toBe(400);
      expect((await call("POST", `/frozen-reports/${ids.closedSet}/approve`, treasurer, { meetingDate: "2025-06-14", extra: 1 })).statusCode).toBe(400);
      const approved = await call("POST", `/frozen-reports/${ids.closedSet}/approve`, treasurer, { meetingDate: "2025-06-14", note: "Votée à l'unanimité" });
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.json().approval).toMatchObject({ meetingDate: "2025-06-14", note: "Votée à l'unanimité" });
      expect((await list("fy2024"))[0]!.approval).toMatchObject({ meetingDate: "2025-06-14" });
      const again = await call("POST", `/frozen-reports/${ids.closedSet}/approve`, treasurer, { meetingDate: "2025-06-15" });
      expect(again.statusCode).toBe(409);
      expect(await sqlError(`UPDATE "FrozenReportApproval" SET "note" = 'x'`)).toContain("ne se modifie ni ne se retire");
      expect(await sqlError(`DELETE FROM "FrozenReportApproval"`)).toContain("ne se modifie ni ne se retire");
      expect(await sqlError(`TRUNCATE "FrozenReportApproval"`)).toMatch(/TRUNCATE|refus|interdit/i);
    });

    it("des rapports remplacés par une version plus récente ne s'approuvent plus : on approuve la dernière", async () => {
      const newer = await freeze("fy2024", { reason: "Annexe corrigée après l'assemblée" });
      expect(newer.statusCode, newer.body).toBe(201);
      expect(newer.json()).toMatchObject({ number: 4, kind: "MANUAL", provisional: false, supersedesNumber: 3, approval: null });
      expect((await list("fy2024")).map((v) => [v.number, v.latest, v.approval !== null])).toEqual([[4, true, false], [3, false, true]].concat([[2, false, false], [1, false, false]]));
      const stale = await call("POST", `/frozen-reports/${ids.closedSet}/approve`, treasurer, { meetingDate: "2025-07-01" });
      expect(stale.statusCode).toBe(409);
      const fine = await call("POST", `/frozen-reports/${newer.json().id}/approve`, treasurer, { meetingDate: "2025-07-01" });
      expect(fine.statusCode, fine.body).toBe(200);
    });

    it("le procès-verbal se rattache comme un document lié (type d'objet reconnu par le module Documents)", () => {
      expect(isLinkableObjectType("frozen-report")).toBe(true);
    });
  });
});
