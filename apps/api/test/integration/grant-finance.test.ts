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

describe("Échéancier et versements de subvention (base vierge)", () => {
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

  const newProject = async (code: string) => (await call("POST", "/projects", treasurer, { code, name: code })).json().id as string;
  const tx = async (amount: string, date: string, label = "Virement Région") => {
    const response = await call("POST", `/financial-accounts/${ids.fa}/transactions`, treasurer, { operationDate: date, amount, label });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  };
  /** Subvention accordée : demandée puis accordée, répartie entre deux projets. */
  const grantedGrant = async (granted = "900.00", title = "Aide au festival") => {
    const created = await call("POST", "/grants", treasurer, {
      funderId: ids.region,
      title,
      requestedAmount: granted,
      allocations: [{ projectId: ids.a, amount: granted }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const decided = await call("POST", `/grants/${created.json().id}/grant`, treasurer, { grantedAmount: granted, decidedOn: "2026-03-15" });
    expect(decided.statusCode, decided.body).toBe(200);
    return decided.json().id as string;
  };
  const finance = async (id: string, session: Session = treasurer) => (await call("GET", `/grants/${id}/finance`, session)).json();
  const schedule = (grantId: string, body: object) => call("POST", `/grants/${grantId}/schedule`, treasurer, { dueOn: "2026-05-01", amount: "300.00", ...body });
  const pay = (grantId: string, body: object) => call("POST", `/grants/${grantId}/payments`, treasurer, body);

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
    ids.a = await newProject("ATELIERS");
    ids.b = await newProject("FESTIVAL");
    ids.region = (await call("POST", "/funders", treasurer, { name: "Région", type: "LOCAL_AUTHORITY" })).json().id;
    ids.bank = (await call("POST", "/accounts", treasurer, { number: "512", label: "Banque" })).json().id;
    ids.fa = (await call("POST", "/financial-accounts", treasurer, { name: "Banque", type: "BANK", accountId: ids.bank, openedOn: "2025-01-01", openingBalance: "0.00" })).json().id;
    ids.campaign = (await call("POST", "/campaigns", treasurer, { name: "Adhésions 2026", startsOn: "2025-09-29", endsOn: "2026-09-28", effectiveMode: "PAYMENT" })).json().id;
    ids.tariff = (await call("POST", `/campaigns/${ids.campaign}/tariffs`, treasurer, { label: "Plein tarif", amount: "30.00" })).json().tariffs[0].id;
    ids.g = await grantedGrant();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("échéancier", () => {
    it("réserve la lecture à grants:view et l'écriture à grants:manage", async () => {
      expect((await call("GET", `/grants/${ids.g}/finance`)).statusCode).toBe(401);
      expect((await call("GET", `/grants/${ids.g}/finance`, reader)).statusCode).toBe(403);
      expect((await call("GET", `/grants/${ids.g}/finance`, boardMember)).statusCode).toBe(200);
      expect((await schedule(ids.g!, {})).statusCode).toBe(201);
      expect((await call("POST", `/grants/${ids.g}/schedule`, boardMember, { dueOn: "2026-05-01", amount: "10" })).statusCode).toBe(403);
      expect((await call("GET", `/grants/${ids.g}/payment-candidates`, boardMember)).statusCode).toBe(403);
      expect((await call("GET", `/grants/${ids.g}/payment-candidates`, treasurer)).statusCode).toBe(200);
    });

    it("ne se prépare que pour une subvention accordée", async () => {
      const requested = (await call("POST", "/grants", treasurer, { funderId: ids.region, title: "Pas encore", requestedAmount: "100" })).json().id;
      const refused = await schedule(requested, {});
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("subvention accordée");
      expect((await schedule(randomUUID(), {})).statusCode).toBe(404);
      const empty = await finance(requested);
      expect(empty).toMatchObject({ granted: null, remaining: null, unplanned: null, received: "0.00", schedule: [], payments: [] });
    });

    it("refuse des échéances qui dépassent le montant accordé, en disant ce qu'il reste à planifier", async () => {
      expect((await schedule(ids.g!, { dueOn: "2026-11-01", amount: "400.00", condition: "Sur bilan intermédiaire" })).statusCode).toBe(201);
      const tooMuch = await schedule(ids.g!, { dueOn: "2027-03-01", amount: "300.00" });
      expect(tooMuch.statusCode).toBe(409);
      expect(tooMuch.json().message).toContain("900.00 €");
      expect(tooMuch.json().message).toContain("200.00 €");
      expect((await schedule(ids.g!, { amount: "0" })).statusCode).toBe(400);
      expect((await schedule(ids.g!, { dueOn: "bientôt" })).statusCode).toBe(400);
      const view = await finance(ids.g!);
      expect(view).toMatchObject({ granted: "900.00", planned: "700.00", received: "0.00", remaining: "900.00", unplanned: "200.00", overReceived: false });
      expect(view.schedule.map((l: { dueOn: string; state: string }) => [l.dueOn, l.state])).toEqual([["2026-05-01", "PENDING"], ["2026-11-01", "PENDING"]]);
      ids.line1 = view.schedule[0].id;
      ids.line2 = view.schedule[1].id;
      expect(await sqlError(`INSERT INTO "GrantSchedule" ("id","grantId","dueOn","amount") VALUES (gen_random_uuid(),'${ids.g}','2027-01-01',250)`)).toContain("dépassent le montant accordé");
    });

    it("modifie une échéance dans la limite du montant accordé", async () => {
      const edited = await call("PATCH", `/grant-schedule/${ids.line2}`, treasurer, { amount: "600.00", condition: "Après bilan" });
      expect(edited.json().planned).toBe("900.00");
      expect((await call("PATCH", `/grant-schedule/${ids.line2}`, treasurer, { amount: "700.00" })).statusCode).toBe(409);
      expect((await call("PATCH", `/grant-schedule/${ids.line2}`, treasurer, { amount: "400.00" })).statusCode).toBe(200);
      expect((await call("PATCH", `/grant-schedule/${randomUUID()}`, treasurer, { amount: "1" })).statusCode).toBe(404);
    });

    it("signale une échéance en retard sans la confondre avec une échéance à venir", async () => {
      const late = await schedule(ids.g!, { dueOn: "2020-01-01", amount: "50.00" });
      const future = await schedule(ids.g!, { dueOn: "2099-01-01", amount: "50.00" });
      const lines = future.json().schedule;
      const byDate = (date: string) => lines.find((l: { dueOn: string }) => l.dueOn === date);
      expect(byDate("2020-01-01").overdue).toBe(true);
      expect(byDate("2099-01-01").overdue).toBe(false);
      expect(late.statusCode).toBe(201);
      // On retire ces deux lignes de test : elles n'ont reçu aucun versement.
      for (const date of ["2020-01-01", "2099-01-01"]) expect((await call("DELETE", `/grant-schedule/${byDate(date).id}`, treasurer)).statusCode).toBe(200);
      expect((await finance(ids.g!)).planned).toBe("700.00");
    });
  });

  describe("versements reçus", () => {
    it("propose les encaissements disponibles, jamais une dépense", async () => {
      ids.t1 = await tx("300.00", "2026-05-10");
      ids.t2 = await tx("400.00", "2027-01-15");
      ids.out = await tx("-50.00", "2026-05-11", "Achat");
      const candidates = (await call("GET", `/grants/${ids.g}/payment-candidates`, treasurer)).json();
      const found = candidates.map((c: { id: string }) => c.id);
      expect(found).toContain(ids.t1);
      expect(found).toContain(ids.t2);
      expect(found).not.toContain(ids.out);
      expect(candidates.find((c: { id: string }) => c.id === ids.t1)).toMatchObject({ amount: "300.00", remaining: "300.00", accountName: "Banque", label: "Virement Région" });
    });

    it("rattache un encaissement à une échéance : elle est reçue, le reste à recevoir baisse", async () => {
      const entriesBefore = await prisma.journalEntry.count();
      const paid = await pay(ids.g!, { transactionId: ids.t1, amount: "300.00", scheduleId: ids.line1 });
      expect(paid.statusCode, paid.body).toBe(201);
      expect(paid.json()).toMatchObject({ received: "300.00", remaining: "600.00", overReceived: false });
      expect(paid.json().schedule[0]).toMatchObject({ state: "RECEIVED", received: "300.00", overdue: false });
      expect(paid.json().payments[0]).toMatchObject({ operationDate: "2026-05-10", amount: "300.00", scheduleId: ids.line1, cancelled: false });
      // Le libellé de la banque n'est pas exposé aux lecteurs d'une subvention.
      expect(paid.json().payments[0]).not.toHaveProperty("label");
      expect(await prisma.journalEntry.count()).toBe(entriesBefore);
    });

    it("accepte un versement partiel, puis le solde, sur deux exercices, sans aucune écriture comptable (CA-15)", async () => {
      const entriesBefore = await prisma.journalEntry.count();
      const partial = await pay(ids.g!, { transactionId: ids.t2, amount: "150.00", scheduleId: ids.line2 });
      expect(partial.json().schedule[1]).toMatchObject({ state: "PARTIAL", received: "150.00" });
      expect(partial.json()).toMatchObject({ received: "450.00", remaining: "450.00" });
      const rest = await pay(ids.g!, { transactionId: ids.t2, amount: "250.00", scheduleId: ids.line2 });
      expect(rest.json().schedule[1]).toMatchObject({ state: "RECEIVED", received: "400.00" });
      expect(rest.json()).toMatchObject({ granted: "900.00", planned: "700.00", received: "700.00", remaining: "200.00" });
      expect(rest.json().payments.map((p: { operationDate: string }) => p.operationDate)).toEqual(["2026-05-10", "2027-01-15", "2027-01-15"]);
      expect(await prisma.journalEntry.count()).toBe(entriesBefore);
      const listed = (await call("GET", "/grants", treasurer)).json().find((g: { id: string }) => g.id === ids.g);
      expect(listed.received).toBe("700.00");
    });

    it("refuse un montant au-delà de ce que l'encaissement peut donner, en le disant", async () => {
      const tooMuch = await pay(ids.g!, { transactionId: ids.t2, amount: "1.00" });
      expect(tooMuch.statusCode).toBe(409);
      expect(tooMuch.json().message).toContain("0.00 € disponibles");
      expect((await pay(ids.g!, { transactionId: ids.out, amount: "10.00" })).json().message).toContain("encaissement");
      expect((await pay(ids.g!, { transactionId: randomUUID(), amount: "10.00" })).statusCode).toBe(404);
      expect((await pay(ids.g!, { transactionId: ids.t1, amount: "0" })).statusCode).toBe(400);
    });

    it("partage le plafond d'un encaissement avec les cotisations, dans les deux sens", async () => {
      const campaignMember = async (firstName: string) => {
        const member = (await call("POST", "/members", treasurer, { firstName, lastName: "Test", email: `${firstName.toLowerCase()}@asso.fr` })).json().id;
        return (await call("POST", `/campaigns/${ids.campaign}/memberships`, treasurer, { memberId: member, tariffId: ids.tariff })).json().id as string;
      };
      const allocate = (membershipId: string, transactionId: string, amount: string) =>
        call("POST", `/memberships/${membershipId}/allocations`, treasurer, { transactionId, amount });

      // Cotisation d'abord : 20 € de l'encaissement vont à une adhésion, il n'en reste que 80 pour la subvention.
      const shared = await tx("100.00", "2026-06-01");
      const m1 = await campaignMember("Alice");
      const first = await allocate(m1, shared, "20.00");
      expect(first.statusCode, first.body).toBe(201);
      const tooMuch = await pay(ids.g!, { transactionId: shared, amount: "90.00" });
      expect(tooMuch.statusCode, tooMuch.body).toBe(409);
      expect(tooMuch.json().message).toContain("80.00 € disponibles");
      expect((await pay(ids.g!, { transactionId: shared, amount: "80.00" })).statusCode).toBe(201);
      const remaining = (await call("GET", `/grants/${ids.g}/payment-candidates`, treasurer)).json().map((c: { id: string }) => c.id);
      expect(remaining).not.toContain(shared);

      // Subvention d'abord : l'adhésion ne peut plus déborder.
      const other = await tx("100.00", "2026-06-02");
      expect((await pay(ids.g!, { transactionId: other, amount: "70.00" })).statusCode).toBe(201);
      const m2 = await campaignMember("Bruno");
      const overflow = await allocate(m2, other, "30.00");
      expect(overflow.statusCode, overflow.body).toBe(201);
      const m3 = await campaignMember("Chloe");
      const refused = await allocate(m3, other, "1.00");
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().message).toContain("dépassent le montant de la transaction");
      expect(await sqlError(`UPDATE "Transaction" SET amount = 10 WHERE id = '${other}'`)).toContain("affectée à des adhésions ou à des subventions");
      expect(await sqlError(`INSERT INTO "GrantPayment" ("id","grantId","transactionId","amount") VALUES (gen_random_uuid(),'${ids.g}','${other}',1)`)).toContain("dépassent le montant de la transaction");
    });

    it("refuse une échéance d'une autre subvention", async () => {
      const otherGrant = await grantedGrant("500.00", "Autre aide");
      const otherLine = (await schedule(otherGrant, { amount: "500.00" })).json().schedule[0].id;
      const t = await tx("50.00", "2026-07-01");
      const refused = await pay(ids.g!, { transactionId: t, amount: "50.00", scheduleId: otherLine });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("n'appartient pas à cette subvention");
    });

    it("annule un versement avec un motif, qui reste dans l'historique", async () => {
      const before = await finance(ids.g!);
      const target = before.payments.find((p: { scheduleId: string | null }) => p.scheduleId === ids.line1);
      expect((await call("POST", `/grant-payments/${target.id}/cancel`, treasurer, {})).statusCode).toBe(400);
      expect((await call("POST", `/grant-payments/${target.id}/cancel`, treasurer, { reason: "ab" })).statusCode).toBe(400);
      const cancelled = await call("POST", `/grant-payments/${target.id}/cancel`, treasurer, { reason: "Rattaché par erreur" });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(cancelled.json().schedule[0]).toMatchObject({ state: "PENDING", received: "0.00" });
      expect(cancelled.json().received).toBe((Number(before.received) - 300).toFixed(2));
      expect(cancelled.json().payments.find((p: { id: string }) => p.id === target.id)).toMatchObject({ cancelled: true, cancelReason: "Rattaché par erreur" });
      expect((await call("POST", `/grant-payments/${target.id}/cancel`, treasurer, { reason: "Encore" })).statusCode).toBe(409);
      // L'encaissement est de nouveau disponible pour un autre rattachement.
      expect((await call("GET", `/grants/${ids.g}/payment-candidates`, treasurer)).json().map((c: { id: string }) => c.id)).toContain(ids.t1);
      ids.cancelled = target.id;
    });

    it("ne supprime ni ne modifie jamais un versement, en base", async () => {
      expect(await sqlError(`DELETE FROM "GrantPayment" WHERE "id" = '${ids.cancelled}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`UPDATE "GrantPayment" SET "amount" = 1 WHERE "id" = '${ids.cancelled}'`)).toContain("ne se modifie pas");
      expect(await sqlError(`UPDATE "GrantPayment" SET "cancelReason" = 'autre' WHERE "id" = '${ids.cancelled}'`)).toContain("annulé ne change plus");
      expect(await sqlError(`TRUNCATE "GrantPayment"`)).toBeTruthy();
      expect(await sqlError(`TRUNCATE "GrantSchedule"`)).toBeTruthy();
    });

    it("garde une échéance qui a reçu des versements, et retire celle qui n'en a pas", async () => {
      const blocked = await call("DELETE", `/grant-schedule/${ids.line1}`, treasurer);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().message).toContain("versements rattachés");
      const fresh = await schedule(ids.g!, { dueOn: "2028-01-01", amount: "100.00" });
      const freshId = fresh.json().schedule.find((l: { dueOn: string }) => l.dueOn === "2028-01-01").id;
      expect((await call("DELETE", `/grant-schedule/${freshId}`, treasurer)).statusCode).toBe(200);
    });

    it("signale un trop-perçu au lieu de le masquer", async () => {
      const small = await grantedGrant("100.00", "Petite aide");
      const t = await tx("150.00", "2026-08-01");
      const over = await pay(small, { transactionId: t, amount: "150.00" });
      expect(over.statusCode).toBe(201);
      expect(over.json()).toMatchObject({ granted: "100.00", received: "150.00", remaining: "-50.00", overReceived: true });
    });
  });

  describe("après la clôture, visibilité et audit", () => {
    it("ne change plus rien une fois la subvention clôturée", async () => {
      const closing = await grantedGrant("200.00", "À clôturer");
      const line = (await schedule(closing, { amount: "100.00" })).json().schedule[0].id;
      const t = await tx("100.00", "2026-09-01");
      const paid = await pay(closing, { transactionId: t, amount: "100.00", scheduleId: line });
      const paymentId = paid.json().payments[0].id;
      expect((await call("POST", `/grants/${closing}/close`, treasurer, { closedOn: "2027-04-01", residual: "NONE" })).statusCode).toBe(200);

      expect((await schedule(closing, { amount: "50.00" })).statusCode).toBe(409);
      expect((await call("PATCH", `/grant-schedule/${line}`, treasurer, { amount: "50.00" })).statusCode).toBe(409);
      expect((await call("DELETE", `/grant-schedule/${line}`, treasurer)).statusCode).toBe(409);
      const t2 = await tx("10.00", "2027-05-01");
      const late = await pay(closing, { transactionId: t2, amount: "10.00" });
      expect(late.statusCode).toBe(409);
      expect(late.json().message).toContain("pas encore clôturée");
      expect((await call("POST", `/grant-payments/${paymentId}/cancel`, treasurer, { reason: "Trop tard" })).json().message).toContain("clôturée");
      // La vue reste lisible : les montants reçus et le plan sont conservés.
      expect(await finance(closing)).toMatchObject({ granted: "200.00", received: "100.00", remaining: "100.00", planned: "100.00" });
    });

    it("limite la lecture aux subventions de la portée, sans jamais exposer le libellé bancaire", async () => {
      const email = `scoped-${randomUUID()}@test.invalid`;
      const user = await users.createUser({ email, displayName: "S", password: PASSWORD });
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "project-manager" } });
      await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id, projectId: ids.b! } });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: "198.51.100.62" });
      const scoped = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
      // Une subvention sur FESTIVAL (la portée) et une sur ATELIERS seulement.
      const own = (await call("POST", "/grants", treasurer, { funderId: ids.region, title: "Pour FESTIVAL", requestedAmount: "100", allocations: [{ projectId: ids.b, amount: "100" }] })).json().id;
      expect((await call("GET", `/grants/${own}/finance`, scoped)).statusCode).toBe(200);
      expect((await call("GET", `/grants/${ids.g}/finance`, scoped)).statusCode).toBe(404);
      expect((await call("POST", `/grants/${own}/schedule`, scoped, { dueOn: "2026-05-01", amount: "10" })).statusCode).toBe(403);
      expect((await call("POST", `/grants/${own}/payments`, scoped, { transactionId: ids.t1, amount: "10" })).statusCode).toBe(403);
      expect((await call("GET", `/grants/${own}/payment-candidates`, scoped)).statusCode).toBe(403);
      expect(JSON.stringify(await finance(ids.g!))).not.toContain("Virement Région");
    });

    it("trace l'échéancier et les versements sans recopier de montant", async () => {
      const events = await prisma.auditEvent.findMany({ where: { OR: [{ action: { startsWith: "grant.schedule." } }, { action: { startsWith: "grant.payment." } }] } });
      const actions = new Set(events.map((e) => e.action));
      for (const action of ["grant.schedule.added", "grant.schedule.updated", "grant.schedule.removed", "grant.payment.recorded", "grant.payment.cancelled"]) {
        expect(actions.has(action), action).toBe(true);
      }
      const serialized = JSON.stringify(events.map((e) => e.details));
      for (const amount of ["300.00", "400.00", "150.00", "250.00"]) expect(serialized).not.toContain(amount);
      expect(events.find((e) => e.action === "grant.payment.cancelled")?.justification).toBe("Rattaché par erreur");
    });
  });
});
