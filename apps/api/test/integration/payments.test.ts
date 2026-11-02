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

describe("Règlements : affectations, rappels et reçus (ADR 0023, base vierge)", () => {
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
  const tx = async (amount: string, date: string, label = "Virement") => {
    const response = await call("POST", `/financial-accounts/${ids.fa}/transactions`, treasurer, { operationDate: date, amount, label });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  };
  const enroll = async (firstName: string, tariffId: string, campaignId: string = ids.c!) => {
    const member = (await call("POST", "/members", treasurer, { firstName, lastName: "Test", email: `${firstName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}@asso.fr`, phone: "0600000000" })).json().id;
    const response = await call("POST", `/campaigns/${campaignId}/memberships`, treasurer, { memberId: member, tariffId });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  };
  const allocate = (membershipId: string, body: object, ...session: (Session | undefined)[]) => call("POST", `/memberships/${membershipId}/allocations`, session.length > 0 ? session[0] : treasurer, body);
  const membershipOf = async (id: string, campaignId: string = ids.c!) => (await call("GET", `/campaigns/${campaignId}/memberships`, treasurer)).json().find((m: { id: string }) => m.id === id);

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

    ids.bank = (await call("POST", "/accounts", treasurer, { number: "512", label: "Banque" })).json().id;
    ids.fa = (await call("POST", "/financial-accounts", treasurer, { name: "Banque", type: "BANK", accountId: ids.bank, openedOn: "2025-01-01", openingBalance: "0.00" })).json().id;
    ids.c = (await call("POST", "/campaigns", treasurer, { name: "Adhésions 2025-2026", startsOn: "2025-09-29", endsOn: "2026-09-28", effectiveMode: "PAYMENT" })).json().id;
    ids.t = (await call("POST", `/campaigns/${ids.c}/tariffs`, treasurer, { label: "Plein tarif", amount: "30.00" })).json().tariffs[0].id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("affecter un règlement", () => {
    it("réserve les écritures à members:manage et la lecture à members:view", async () => {
      const m = await enroll("Marie", ids.t!);
      const t = await tx("30.00", "2025-10-05");
      expect((await allocate(m.id, { transactionId: t, amount: "30.00" }, undefined)).statusCode).toBe(401);
      expect((await allocate(m.id, { transactionId: t, amount: "30.00" }, boardMember)).statusCode).toBe(403);
      expect((await call("GET", `/memberships/${m.id}/allocations`, reader)).statusCode).toBe(403);
      expect((await call("GET", `/memberships/${m.id}/allocations`, boardMember)).statusCode).toBe(200);
      expect((await call("GET", `/memberships/${m.id}/payment-candidates`, boardMember)).statusCode).toBe(403);
    });

    it("règlement complet : l'adhésion devient effective à la date du règlement, sans aucune écriture comptable", async () => {
      const m = await enroll("Paul", ids.t!);
      const t = await tx("30.00", "2025-11-12", "Chèque de Paul");
      const done = await allocate(m.id, { transactionId: t, amount: "30.00" });
      expect(done.statusCode, done.body).toBe(201);
      expect(done.json().allocation).toMatchObject({ amount: "30.00", kind: "PAYMENT", accountName: "Banque", transactionDate: "2025-11-12" });
      expect(done.json().membership).toMatchObject({ status: "EFFECTIVE", effectiveOn: "2025-11-12", effectiveOrigin: "PAYMENT", paid: "30.00", balance: "0.00", overpaid: false });
      expect(await prisma.journalEntry.count()).toBe(0);
    });

    it("paiement partiel : en attente tant que l'attendu n'est pas couvert, effective quand le dernier versement le couvre", async () => {
      const m = await enroll("Léa", ids.t!);
      const first = await tx("10.00", "2025-12-01");
      const second = await tx("20.00", "2026-01-15");
      const partial = await allocate(m.id, { transactionId: first, amount: "10.00" });
      expect(partial.json().membership).toMatchObject({ status: "PENDING", paid: "10.00", balance: "20.00" });
      const complete = await allocate(m.id, { transactionId: second, amount: "20.00" });
      expect(complete.json().membership).toMatchObject({ status: "EFFECTIVE", effectiveOn: "2026-01-15", paid: "30.00", balance: "0.00" });
    });

    it("paiement groupé : une transaction répartie entre plusieurs adhésions, y compris pour d'autres membres que le payeur", async () => {
      const a = await enroll("Anne", ids.t!);
      const b = await enroll("Bruno", ids.t!);
      const t = await tx("60.00", "2026-02-01", "Chèque famille");
      expect((await allocate(a.id, { transactionId: t, amount: "30.00" })).statusCode).toBe(201);
      expect((await allocate(b.id, { transactionId: t, amount: "30.00" })).statusCode).toBe(201);
      expect((await membershipOf(a.id)).status).toBe("EFFECTIVE");
      expect((await membershipOf(b.id)).status).toBe("EFFECTIVE");
      // La transaction est épuisée : plus rien à affecter.
      const more = await allocate(a.id, { transactionId: t, amount: "0.01" });
      expect(more.statusCode).toBe(409);
      expect(more.json().message).toContain("dépassent le montant de la transaction");
    });

    it("trop-perçu : signalé, jamais masqué", async () => {
      const m = await enroll("Chloé", ids.t!);
      const t = await tx("50.00", "2026-02-10");
      const done = await allocate(m.id, { transactionId: t, amount: "50.00" });
      expect(done.json().membership).toMatchObject({ status: "EFFECTIVE", paid: "50.00", balance: "-20.00", overpaid: true });
    });

    it("refuse un montant nul, un règlement sur un décaissement, une transaction inconnue et une adhésion annulée", async () => {
      const m = await enroll("David", ids.t!);
      const income = await tx("30.00", "2026-03-01");
      const expense = await tx("-30.00", "2026-03-02");
      expect((await allocate(m.id, { transactionId: income, amount: "0" })).statusCode).toBe(400);
      const wrongWay = await allocate(m.id, { transactionId: expense, amount: "10.00" });
      expect(wrongWay.statusCode).toBe(409);
      expect(wrongWay.json().message).toContain("encaissement");
      expect((await allocate(m.id, { transactionId: randomUUID(), amount: "10.00" })).statusCode).toBe(404);
      await call("POST", `/memberships/${m.id}/cancel`, treasurer, { reason: "Erreur de saisie" });
      const cancelled = await allocate(m.id, { transactionId: income, amount: "10.00" });
      expect(cancelled.statusCode).toBe(409);
      expect(cancelled.json().message).toContain("annulée");
    });

    it("deux affectations simultanées du même mouvement : le total ne dépasse jamais la transaction", async () => {
      const a = await enroll("Eva", ids.t!);
      const b = await enroll("Fred", ids.t!);
      const t = await tx("30.00", "2026-03-10");
      const results = await Promise.all([allocate(a.id, { transactionId: t, amount: "30.00" }), allocate(b.id, { transactionId: t, amount: "30.00" })]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    });
  });

  describe("annuler, rembourser", () => {
    it("annuler une affectation (motif obligatoire) conserve l'historique et remet l'adhésion en attente", async () => {
      const m = await enroll("Gaël", ids.t!);
      const t = await tx("30.00", "2026-04-01");
      const allocation = (await allocate(m.id, { transactionId: t, amount: "30.00" })).json().allocation;
      expect((await call("POST", `/allocations/${allocation.id}/cancel`, treasurer, { reason: "ab" })).statusCode).toBe(400);
      const cancelled = await call("POST", `/allocations/${allocation.id}/cancel`, treasurer, { reason: "Chèque rejeté par la banque" });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(cancelled.json()).toMatchObject({ status: "PENDING", effectiveOn: null, effectiveOrigin: null, paid: "0.00", balance: "30.00" });
      const history = (await call("GET", `/memberships/${m.id}/allocations`, boardMember)).json();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ cancelled: true, cancelReason: "Chèque rejeté par la banque" });
      expect((await call("POST", `/allocations/${allocation.id}/cancel`, treasurer, { reason: "Encore" })).statusCode).toBe(409);
      // La part de la transaction est de nouveau disponible.
      const candidates = (await call("GET", `/memberships/${m.id}/payment-candidates`, treasurer)).json();
      expect(candidates.find((c: { id: string }) => c.id === t)).toMatchObject({ remaining: "30.00", canBook: true });
    });

    it("un remboursement s'affecte à un décaissement et réduit le payé ; il peut remettre l'adhésion en attente", async () => {
      const m = await enroll("Hélène", ids.t!);
      const income = await tx("30.00", "2026-04-10");
      const refund = await tx("-30.00", "2026-04-20", "Remboursement cotisation");
      await allocate(m.id, { transactionId: income, amount: "30.00" });
      const refunded = await allocate(m.id, { transactionId: refund, amount: "30.00", kind: "REFUND", note: "Départ en cours d'année" });
      expect(refunded.statusCode, refunded.body).toBe(201);
      expect(refunded.json().membership).toMatchObject({ paid: "0.00", status: "PENDING", balance: "30.00" });
      const candidates = (await call("GET", `/memberships/${m.id}/payment-candidates?kind=REFUND`, treasurer)).json();
      expect(candidates.every((c: { id: string }) => c.id !== refund)).toBe(true);
    });

    it("les candidats d'un règlement sont les encaissements avec leur reste à affecter", async () => {
      const m = await enroll("Igor", ids.t!);
      const t = await tx("45.00", "2026-05-01", "Don et cotisation");
      await allocate((await enroll("Jade", ids.t!)).id, { transactionId: t, amount: "30.00" });
      const candidates = (await call("GET", `/memberships/${m.id}/payment-candidates`, treasurer)).json();
      expect(candidates.find((c: { id: string }) => c.id === t)).toMatchObject({ amount: "45.00", remaining: "15.00", accountName: "Banque" });
    });
  });

  describe("rappels et reçus", () => {
    it("liste les cotisations restant dues, avec de quoi contacter, et les exporte en CSV sûr", async () => {
      const m = await enroll("Karim", ids.t!);
      const reminders = (await call("GET", `/campaigns/${ids.c}/reminders`, boardMember)).json();
      const mine = reminders.items.find((i: { membership: { id: string } }) => i.membership.id === m.id);
      expect(mine).toMatchObject({ email: "karim@asso.fr", phone: "0600000000", membership: { balance: "30.00" } });
      expect(reminders.items.every((i: { membership: { status: string; balance: string } }) => i.membership.status !== "CANCELLED" && Number(i.membership.balance) > 0)).toBe(true);
      expect(Number(reminders.totalDue)).toBeGreaterThan(0);

      const csv = await call("GET", `/campaigns/${ids.c}/reminders/csv`, boardMember);
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.headers["content-disposition"]).toBe('attachment; filename="cotisations-dues-adhesions-2025-2026.csv"');
      expect(csv.body).toContain("Membre;Email;Téléphone;Tarif;Attendu;Payé;Reste dû");
      expect(csv.body).toContain("Test Karim;karim@asso.fr;0600000000;Plein tarif;30,00;0,00;30,00");
      expect((await call("GET", `/campaigns/${ids.c}/reminders/csv`, reader)).statusCode).toBe(403);
    });

    it("établit un reçu simple avec la mention « pas un reçu fiscal », seulement s'il y a un règlement", async () => {
      const m = await enroll("Lola", ids.t!);
      const none = await call("GET", `/memberships/${m.id}/receipt`, treasurer);
      expect(none.statusCode).toBe(409);
      expect(none.json().message).toContain("pas de reçu");
      const t = await tx("30.00", "2026-05-20");
      await allocate(m.id, { transactionId: t, amount: "30.00" });
      const receipt = (await call("GET", `/memberships/${m.id}/receipt`, boardMember)).json();
      expect(receipt).toMatchObject({ member: "Lola Test", paid: "30.00", balance: "0.00", campaign: { name: "Adhésions 2025-2026" } });
      expect(receipt.payments).toEqual([{ date: "2026-05-20", amount: "30.00", kind: "PAYMENT" }]);
      expect(receipt.notice).toContain("pas un reçu fiscal");
      expect(receipt.association.name).toBe("Mon association");
    });
  });

  describe("garanties en base", () => {
    it("refuse en SQL de modifier ou supprimer une affectation, de dépasser une transaction, ou de changer le montant d'une transaction affectée", async () => {
      const m = await enroll("Marc", ids.t!);
      const t = await tx("30.00", "2026-06-01");
      const allocation = (await allocate(m.id, { transactionId: t, amount: "30.00" })).json().allocation;
      expect(await sqlError(`UPDATE "PaymentAllocation" SET amount = 1 WHERE id = '${allocation.id}'`)).toContain("ne se modifie pas");
      expect(await sqlError(`DELETE FROM "PaymentAllocation" WHERE id = '${allocation.id}'`)).toContain("on l'annule");
      expect(await sqlError(`TRUNCATE "PaymentAllocation"`)).not.toBeNull();
      expect(await sqlError(`UPDATE "Transaction" SET amount = 10 WHERE id = '${t}'`)).toContain("affectée à des adhésions");
      expect(
        await sqlError(`INSERT INTO "PaymentAllocation"(id, "transactionId", "membershipId", amount) VALUES (gen_random_uuid(), '${t}', '${m.id}', 0.01)`),
      ).toContain("dépassent");
      // Les affectations annulées libèrent la transaction.
      await call("POST", `/allocations/${allocation.id}/cancel`, treasurer, { reason: "Erreur d'affectation" });
      expect(await sqlError(`UPDATE "Transaction" SET amount = 40 WHERE id = '${t}'`)).toBeNull();
    });
  });
});
