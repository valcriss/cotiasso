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

type Method = "GET" | "POST" | "PUT" | "PATCH";

describe("Budgets et participants de projet (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let reader: Session;
  let boardMember: Session;
  let manager: Session;
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
    const user = await users.createUser({ email, displayName: "P", password: PASSWORD });
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

  const line = (over: Record<string, unknown> = {}) => ({
    kind: "CHARGE",
    label: "Location de salle",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    amount: "500.00",
    ...over,
  });
  const newBudget = async (projectId: string, label = "Budget initial") => {
    const response = await call("POST", `/projects/${projectId}/budgets`, treasurer, { label });
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
    treasurer = await userWith("treasurer");
    reader = await userWith("reader");
    boardMember = await userWith("board-member");
    manager = await userWith("project-manager");

    ids.festival = (await call("POST", "/projects", treasurer, { code: "FESTIVAL", name: "Festival" })).json().id;
    ids.ateliers = (await call("POST", "/projects", treasurer, { code: "ATELIERS", name: "Ateliers" })).json().id;
    ids.charges = (await call("POST", "/accounts", treasurer, { number: "606", label: "Achats" })).json().id;
    ids.sales = (await call("POST", "/accounts", treasurer, { number: "706", label: "Prestations" })).json().id;
    ids.bank = (await call("POST", "/accounts", treasurer, { number: "512", label: "Banque" })).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("budgets", () => {
    it("sépare la lecture, la préparation et l'approbation", async () => {
      expect((await call("GET", `/projects/${ids.festival}/budgets`)).statusCode).toBe(401);
      expect((await call("GET", `/projects/${ids.festival}/budgets`, reader)).statusCode).toBe(200);
      expect((await call("POST", `/projects/${ids.festival}/budgets`, reader, { label: "X" })).statusCode).toBe(403);
      expect((await call("POST", `/projects/${ids.festival}/budgets`, boardMember, { label: "X" })).statusCode).toBe(403);
      const draft = await newBudget(ids.festival);
      ids.v1 = draft.id;
      expect(draft).toMatchObject({ number: 1, status: "DRAFT", lineCount: 0, charges: "0.00", products: "0.00" });
      // Le trésorier prépare mais n'approuve pas : le bureau approuve.
      expect((await call("POST", `/budgets/${ids.v1}/approve`, treasurer, {})).statusCode).toBe(403);
    });

    it("refuse un second brouillon pour le même projet, avec un message qui dit quoi faire", async () => {
      const second = await call("POST", `/projects/${ids.festival}/budgets`, treasurer, { label: "Autre" });
      expect(second.statusCode).toBe(409);
      expect(second.json().message).toContain("déjà en préparation");
    });

    it("remplace les lignes d'un brouillon et calcule les totaux prévus", async () => {
      const response = await call("PUT", `/budgets/${ids.v1}`, treasurer, {
        label: "Budget voté",
        lines: [
          line(),
          line({ label: "Affiche", amount: "120.50", accountId: ids.charges }),
          line({ kind: "PRODUCT", label: "Billetterie", amount: "900.00", accountId: ids.sales }),
        ],
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ label: "Budget voté", lineCount: 3, charges: "620.50", products: "900.00", result: "279.50" });
      const again = await call("PUT", `/budgets/${ids.v1}`, treasurer, { lines: [line({ amount: "10" })] });
      expect(again.json()).toMatchObject({ lineCount: 1, charges: "10.00" });
      await call("PUT", `/budgets/${ids.v1}`, treasurer, {
        lines: [line(), line({ label: "Affiche", amount: "120.50", accountId: ids.charges }), line({ kind: "PRODUCT", label: "Billetterie", amount: "900.00", accountId: ids.sales })],
      });
    });

    it("refuse les lignes invalides : montant, période, compte de la mauvaise classe ou inconnu", async () => {
      const put = (lines: unknown[]) => call("PUT", `/budgets/${ids.v1}`, treasurer, { lines });
      expect((await put([line({ amount: "0" })])).statusCode).toBe(400);
      expect((await put([line({ amount: "12,5" })])).statusCode).toBe(400);
      expect((await put([line({ periodStart: "2026-07-01", periodEnd: "2026-06-01" })])).statusCode).toBe(400);
      expect((await put([line({ label: " " })])).statusCode).toBe(400);
      const wrongClass = await put([line({ accountId: ids.sales })]);
      expect(wrongClass.statusCode).toBe(409);
      expect(wrongClass.json().message).toContain("classe 6");
      expect((await put([line({ kind: "PRODUCT", accountId: ids.bank })])).statusCode).toBe(409);
      expect((await put([line({ accountId: randomUUID() })])).statusCode).toBe(409);
      // Les refus n'ont rien modifié : le budget garde ses trois lignes.
      expect((await call("GET", `/budgets/${ids.v1}`, treasurer)).json().lineCount).toBe(3);
    });

    it("refuse d'approuver un budget vide, puis l'approuve et le fige", async () => {
      ids.empty = (await newBudget(ids.ateliers, "Vide")).id;
      const empty = await call("POST", `/budgets/${ids.empty}/approve`, boardMember, {});
      expect(empty.statusCode).toBe(409);
      expect(empty.json().message).toContain("vide");

      const approved = await call("POST", `/budgets/${ids.v1}/approve`, boardMember, {});
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.json()).toMatchObject({ status: "APPROVED", number: 1 });
      expect(approved.json().approvedAt).toBeTruthy();
      expect((await call("POST", `/budgets/${ids.v1}/approve`, boardMember, {})).statusCode).toBe(409);
    });

    it("ne modifie ni ne supprime une version approuvée, en API comme en base", async () => {
      const edit = await call("PUT", `/budgets/${ids.v1}`, treasurer, { label: "Changé" });
      expect(edit.statusCode).toBe(409);
      expect(edit.json().message).toContain("nouvelle version");
      expect((await call("DELETE", `/budgets/${ids.v1}`, treasurer)).statusCode).toBe(409);
      expect(await sqlError(`UPDATE "BudgetLine" SET "amount" = 1 WHERE "budgetId" = '${ids.v1}'`)).toContain("ne se modifient plus");
      expect(await sqlError(`DELETE FROM "BudgetLine" WHERE "budgetId" = '${ids.v1}'`)).toContain("ne se modifient plus");
      expect(await sqlError(`INSERT INTO "BudgetLine" ("id","budgetId","kind","label","periodStart","periodEnd","amount") VALUES (gen_random_uuid(),'${ids.v1}','CHARGE','x','2026-01-01','2026-01-02',1)`)).toContain("ne se modifient plus");
      expect(await sqlError(`UPDATE "BudgetVersion" SET "label" = 'x' WHERE "id" = '${ids.v1}'`)).toContain("ne se modifie plus");
      // Revenir à « brouillon » est refusé, que l'on efface la date d'approbation ou non.
      expect(await sqlError(`UPDATE "BudgetVersion" SET "status" = 'DRAFT', "approvedAt" = NULL WHERE "id" = '${ids.v1}'`)).toContain("ne se modifie plus");
      expect(await sqlError(`UPDATE "BudgetVersion" SET "status" = 'DRAFT' WHERE "id" = '${ids.v1}'`)).toBeTruthy();
      expect(await sqlError(`DELETE FROM "BudgetVersion" WHERE "id" = '${ids.v1}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`TRUNCATE "BudgetLine"`)).toBeTruthy();
      expect(await sqlError(`TRUNCATE "BudgetVersion" CASCADE`)).toBeTruthy();
      expect((await call("GET", `/budgets/${ids.v1}`, treasurer)).json()).toMatchObject({ label: "Budget voté", lineCount: 3 });
    });

    it("crée une nouvelle version reprise de la précédente, puis l'approuve : l'ancienne est remplacée", async () => {
      const v2 = await newBudget(ids.festival, "Budget révisé");
      ids.v2 = v2.id;
      expect(v2).toMatchObject({ number: 2, lineCount: 3, charges: "620.50", products: "900.00" });
      await call("PUT", `/budgets/${ids.v2}`, treasurer, { lines: [line({ amount: "700" })] });
      const approved = await call("POST", `/budgets/${ids.v2}/approve`, boardMember, {});
      expect(approved.json().status).toBe("APPROVED");
      const list = (await call("GET", `/projects/${ids.festival}/budgets`, reader)).json();
      expect(list.map((b: { number: number; status: string }) => [b.number, b.status])).toEqual([[2, "APPROVED"], [1, "SUPERSEDED"]]);
      expect(await sqlError(`UPDATE "BudgetVersion" SET "status" = 'APPROVED' WHERE "id" = '${ids.v1}'`)).toBeTruthy();
    });

    it("reprend une version choisie, refuse un budget d'un autre projet, supprime un brouillon", async () => {
      const foreign = await call("POST", `/projects/${ids.festival}/budgets`, treasurer, { label: "X", fromBudgetId: ids.empty });
      expect(foreign.statusCode).toBe(404);
      const fromV1 = await call("POST", `/projects/${ids.festival}/budgets`, treasurer, { label: "Retour au vote", fromBudgetId: ids.v1 });
      expect(fromV1.statusCode).toBe(201);
      expect(fromV1.json()).toMatchObject({ number: 3, lineCount: 3 });
      expect((await call("DELETE", `/budgets/${fromV1.json().id}`, treasurer)).statusCode).toBe(204);
      expect((await call("GET", `/budgets/${fromV1.json().id}`, treasurer)).statusCode).toBe(404);
      // Le numéro supprimé est repris : aucune version conservée n'a de trou.
      expect((await newBudget(ids.festival, "Suite")).number).toBe(3);
    });

    it("n'ouvre pas de budget sur un projet archivé ou inconnu", async () => {
      await call("PATCH", `/projects/${ids.ateliers}`, treasurer, { status: "ARCHIVED" });
      await call("DELETE", `/budgets/${ids.empty}`, treasurer);
      const archived = await call("POST", `/projects/${ids.ateliers}/budgets`, treasurer, { label: "X" });
      expect(archived.statusCode).toBe(409);
      expect(archived.json().message).toContain("archivé");
      expect((await call("POST", `/projects/${randomUUID()}/budgets`, treasurer, { label: "X" })).statusCode).toBe(404);
    });

    it("ne numérote pas deux fois la même version quand deux créations arrivent ensemble", async () => {
      ids.race = (await call("POST", "/projects", treasurer, { code: "COURSE", name: "Course" })).json().id;
      const results = await Promise.all([1, 2, 3].map((n) => call("POST", `/projects/${ids.race}/budgets`, treasurer, { label: `B${n}` })));
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    });

    it("limite la lecture aux projets de la portée de l'utilisateur", async () => {
      const email = `scoped-${randomUUID()}@test.invalid`;
      const user = await users.createUser({ email, displayName: "S", password: PASSWORD });
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "project-manager" } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id, projectId: ids.ateliers } });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: "198.51.100.77" });
      const scoped = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
      expect((await call("GET", `/projects/${ids.festival}/budgets`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/budgets/${ids.v1}`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.festival}/participants`, scoped)).statusCode).toBe(404);
      expect((await call("GET", `/projects/${ids.ateliers}/budgets`, scoped)).statusCode).toBe(200);
      // L'écriture de budget est un droit global : une portée projet ne l'accorde pas.
      expect((await call("POST", `/projects/${ids.ateliers}/budgets`, scoped, { label: "X" })).statusCode).toBe(403);
    });
  });

  describe("participants", () => {
    it("ajoute un membre ou un utilisateur avec un rôle, jamais les deux ni aucun", async () => {
      const member = (await call("POST", "/members", treasurer, { firstName: "Alice", lastName: "Martin" })).json();
      const added = await call("POST", `/projects/${ids.festival}/participants`, treasurer, { memberId: member.id, role: "Bénévole", startDate: "2026-05-01" });
      expect(added.statusCode, added.body).toBe(201);
      expect(added.json()).toMatchObject({ name: "Alice Martin", role: "Bénévole", memberId: member.id, userId: null });
      ids.participant = added.json().id;

      const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@asso.test" } });
      const user = await call("POST", `/projects/${ids.festival}/participants`, treasurer, { userId: admin.id, role: "Référent" });
      expect(user.json()).toMatchObject({ name: "Admin", userId: admin.id });

      const both = await call("POST", `/projects/${ids.festival}/participants`, treasurer, { memberId: member.id, userId: admin.id, role: "X" });
      expect(both.statusCode).toBe(400);
      expect((await call("POST", `/projects/${ids.festival}/participants`, treasurer, { role: "X" })).statusCode).toBe(400);
      expect((await call("POST", `/projects/${ids.festival}/participants`, treasurer, { memberId: member.id, role: " " })).statusCode).toBe(400);
      expect((await call("POST", `/projects/${ids.festival}/participants`, treasurer, { memberId: randomUUID(), role: "X" })).statusCode).toBe(409);
      expect((await call("POST", `/projects/${ids.festival}/participants`, treasurer, { memberId: member.id, role: "X", startDate: "2026-06-02", endDate: "2026-06-01" })).statusCode).toBe(409);
      expect((await call("GET", `/projects/${ids.festival}/participants`, reader)).json()).toHaveLength(2);
    });

    it("réserve la modification à projects:update, modifie, termine et retire un participant", async () => {
      expect((await call("POST", `/projects/${ids.festival}/participants`, reader, { userId: randomUUID(), role: "X" })).statusCode).toBe(403);
      expect((await call("DELETE", `/project-participants/${ids.participant}`, reader)).statusCode).toBe(403);
      const ended = await call("PATCH", `/project-participants/${ids.participant}`, treasurer, { role: "Coordinatrice", endDate: "2026-09-30" });
      expect(ended.json()).toMatchObject({ role: "Coordinatrice", endDate: "2026-09-30" });
      expect((await call("PATCH", `/project-participants/${ids.participant}`, treasurer, { endDate: "2026-04-01" })).statusCode).toBe(409);
      expect((await call("DELETE", `/project-participants/${ids.participant}`, treasurer)).statusCode).toBe(204);
      expect((await call("DELETE", `/project-participants/${ids.participant}`, treasurer)).statusCode).toBe(404);
    });

    it("n'accorde aucun droit d'accès au participant", async () => {
      const email = `part-${randomUUID()}@test.invalid`;
      const user = await users.createUser({ email, displayName: "P", password: PASSWORD });
      await call("POST", `/projects/${ids.festival}/participants`, treasurer, { userId: user.id, role: "Responsable" });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: "198.51.100.78" });
      const session = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
      expect((await call("GET", `/projects/${ids.festival}/budgets`, session)).statusCode).toBe(403);
    });
  });

  describe("audit", () => {
    it("trace les budgets et les participants sans recopier de montant", async () => {
      const events = await prisma.auditEvent.findMany({ where: { action: { startsWith: "budget." } } });
      expect(new Set(events.map((e) => e.action))).toEqual(new Set(["budget.created", "budget.updated", "budget.approved", "budget.deleted"]));
      const approved = events.find((e) => e.action === "budget.approved" && (e.details as { supersedes?: string }).supersedes);
      expect((approved!.details as { supersedes: string }).supersedes).toBe(ids.v1);
      expect(JSON.stringify(events.map((e) => e.details))).not.toContain("620.50");
      expect(await prisma.auditEvent.count({ where: { action: "project.participant.added" } })).toBeGreaterThanOrEqual(2);
    });
  });
});
