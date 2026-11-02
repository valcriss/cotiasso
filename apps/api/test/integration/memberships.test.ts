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

describe("Campagnes, tarifs et adhésions (ADR 0023, base vierge)", () => {
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
    const email = `c-${randomUUID()}@test.invalid`;
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
  const member = async (firstName: string) => (await call("POST", "/members", treasurer, { firstName, lastName: "Test" })).json().id as string;
  const campaign = async (name: string, startsOn: string, endsOn: string, effectiveMode?: string) => {
    const response = await call("POST", "/campaigns", treasurer, { name, startsOn, endsOn, ...(effectiveMode && { effectiveMode }) });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; effectiveMode: string };
  };
  const tariff = async (campaignId: string, label: string, amount: string) => {
    const response = await call("POST", `/campaigns/${campaignId}/tariffs`, treasurer, { label, amount });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().tariffs as { id: string; label: string }[]).find((t) => t.label === label)!.id;
  };
  const enroll = (campaignId: string, body: object) => call("POST", `/campaigns/${campaignId}/memberships`, treasurer, body);

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

  describe("campagnes et tarifs", () => {
    it("réserve la lecture à members:view et la gestion à members:manage", async () => {
      expect((await call("GET", "/campaigns")).statusCode).toBe(401);
      expect((await call("GET", "/campaigns", reader)).statusCode).toBe(403);
      expect((await call("GET", "/campaigns", boardMember)).statusCode).toBe(200);
      expect((await call("POST", "/campaigns", boardMember, { name: "Test", startsOn: "2025-09-29", endsOn: "2026-09-28" })).statusCode).toBe(403);
    });

    it("crée une campagne aux dates explicites (29/09 → 28/09), avec le mode par défaut des paramètres, puis le mode choisi", async () => {
      const first = await campaign("Adhésions 2025-2026", "2025-09-29", "2026-09-28");
      expect(first.effectiveMode).toBe("PAYMENT");
      ids.c1 = first.id;
      const detail = (await call("GET", `/campaigns/${first.id}`, boardMember)).json();
      expect(detail).toMatchObject({ startsOn: "2025-09-29", endsOn: "2026-09-28", tariffs: [], membershipCount: 0, locked: false });

      await prisma.settingsVersion.create({ data: { section: "membership", payload: { effectiveMode: "START_DATE" }, effectiveFrom: new Date(Date.now() - 1000) } });
      expect((await campaign("Adhésions 2026-2027", "2026-09-29", "2027-09-28")).effectiveMode).toBe("START_DATE");
      expect((await campaign("Adhésions 2027-2028", "2027-09-29", "2028-09-28", "VALIDATION")).effectiveMode).toBe("VALIDATION");
    });

    it("refuse un chevauchement et une fin avant le début, en l'expliquant", async () => {
      const overlap = await call("POST", "/campaigns", treasurer, { name: "Chevauche", startsOn: "2026-06-01", endsOn: "2026-12-31" });
      expect(overlap.statusCode).toBe(409);
      expect(overlap.json().message).toContain("chevauche");
      expect((await call("POST", "/campaigns", treasurer, { name: "À l'envers", startsOn: "2030-02-01", endsOn: "2030-01-01" })).statusCode).toBe(400);
      expect((await call("POST", "/campaigns", treasurer, { name: "ab", startsOn: "2030-01-01", endsOn: "2030-12-31" })).statusCode).toBe(400);
    });

    it("gère les tarifs : plusieurs, doublon refusé, montant négatif refusé, catégorie facultative", async () => {
      const category = (await call("POST", "/member-categories", treasurer, { name: "Étudiant" })).json();
      ids.plein = await tariff(ids.c1!, "Plein tarif", "30.00");
      const reduced = await call("POST", `/campaigns/${ids.c1}/tariffs`, treasurer, { label: "Tarif réduit", amount: "15.00", categoryId: category.id });
      expect(reduced.statusCode).toBe(201);
      expect(reduced.json().tariffs.map((t: { label: string; categoryName: string | null }) => [t.label, t.categoryName])).toEqual([["Plein tarif", null], ["Tarif réduit", "Étudiant"]]);
      const twice = await call("POST", `/campaigns/${ids.c1}/tariffs`, treasurer, { label: "Plein tarif", amount: "20.00" });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("déjà ce libellé");
      expect((await call("POST", `/campaigns/${ids.c1}/tariffs`, treasurer, { label: "Négatif", amount: "-5.00" })).statusCode).toBe(400);
    });
  });

  describe("adhésions", () => {
    it("crée une adhésion en attente (mode règlement) avec le montant du tarif figé, sans aucune écriture comptable", async () => {
      const m = await member("Marie");
      const created = await enroll(ids.c1!, { memberId: m, tariffId: ids.plein });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json()).toMatchObject({ status: "PENDING", expectedAmount: "30.00", tariffLabel: "Plein tarif", effectiveOn: null, effectiveOrigin: null });
      ids.m1 = m;
      ids.ms1 = created.json().id;
      // CA-11 : aucune créance ni écriture n'est créée.
      expect(await prisma.journalEntry.count()).toBe(0);
      // Le tarif peut changer : l'adhésion garde son montant attendu.
      await call("PATCH", `/tariffs/${ids.plein}`, treasurer, { amount: "35.00" });
      expect((await call("GET", `/campaigns/${ids.c1}/memberships`, boardMember)).json()[0].expectedAmount).toBe("30.00");
      await call("PATCH", `/tariffs/${ids.plein}`, treasurer, { amount: "30.00" });
    });

    it("refuse un second adhésion non annulée pour le même membre et la même campagne", async () => {
      const twice = await enroll(ids.c1!, { memberId: ids.m1, tariffId: ids.plein });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("déjà une adhésion");
    });

    it("exige une raison quand le montant diffère du tarif, et rend effective une exonération", async () => {
      const m = await member("Paul");
      const noReason = await enroll(ids.c1!, { memberId: m, tariffId: ids.plein, expectedAmount: "10.00" });
      expect(noReason.statusCode).toBe(409);
      expect(noReason.json().message).toContain("raison");
      const exempt = await enroll(ids.c1!, { memberId: m, tariffId: ids.plein, expectedAmount: "0.00", exemptionReason: "Bénévole du bureau" });
      expect(exempt.statusCode, exempt.body).toBe(201);
      expect(exempt.json()).toMatchObject({ status: "EFFECTIVE", expectedAmount: "0.00", effectiveOrigin: "EXEMPTION", exemptionReason: "Bénévole du bureau" });
      expect(exempt.json().effectiveOn >= "2025-09-29" && exempt.json().effectiveOn <= "2026-09-28").toBe(true);
    });

    it("mode « date de début » : effective dès la création, à la date de début (ou à une date postérieure choisie)", async () => {
      const start = (await call("GET", "/campaigns", boardMember)).json().find((c: { name: string }) => c.name === "Adhésions 2026-2027");
      const t = await tariff(start.id, "Adulte", "25.00");
      const a = await enroll(start.id, { memberId: await member("Zoé"), tariffId: t });
      expect(a.json()).toMatchObject({ status: "EFFECTIVE", effectiveOn: "2026-09-29", effectiveOrigin: "START_DATE" });
      const later = await enroll(start.id, { memberId: await member("Yan"), tariffId: t, effectiveOn: "2027-01-10" });
      expect(later.json()).toMatchObject({ effectiveOn: "2027-01-10" });
      // L'adhésion tardive ne déplace pas la fin de campagne.
      expect((await call("GET", `/campaigns/${start.id}`, boardMember)).json().endsOn).toBe("2027-09-28");
      const outside = await enroll(start.id, { memberId: await member("Ugo"), tariffId: t, effectiveOn: "2028-01-01" });
      expect(outside.statusCode).toBe(409);
    });

    it("mode « validation » : en attente puis effective par une validation explicite ; refusée dans un autre mode", async () => {
      const campaignV = (await call("GET", "/campaigns", boardMember)).json().find((c: { name: string }) => c.name === "Adhésions 2027-2028");
      const t = await tariff(campaignV.id, "Adulte", "25.00");
      const pending = (await enroll(campaignV.id, { memberId: await member("Léo"), tariffId: t })).json();
      expect(pending.status).toBe("PENDING");
      expect((await call("POST", `/memberships/${pending.id}/validate`, boardMember)).statusCode).toBe(403);
      const validated = await call("POST", `/memberships/${pending.id}/validate`, treasurer);
      expect(validated.statusCode, validated.body).toBe(200);
      expect(validated.json()).toMatchObject({ status: "EFFECTIVE", effectiveOrigin: "VALIDATION" });
      expect((await call("POST", `/memberships/${pending.id}/validate`, treasurer)).statusCode).toBe(409);
      // Mode règlement : pas de validation manuelle.
      const refused = await call("POST", `/memberships/${ids.ms1}/validate`, treasurer);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("ne fonctionne pas par validation");
    });

    it("annule avec un motif obligatoire ; une adhésion annulée libère la place et ne change plus", async () => {
      expect((await call("POST", `/memberships/${ids.ms1}/cancel`, treasurer, { reason: "ab" })).statusCode).toBe(400);
      const cancelled = await call("POST", `/memberships/${ids.ms1}/cancel`, treasurer, { reason: "Démission avant le début de saison" });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(cancelled.json()).toMatchObject({ status: "CANCELLED", cancelReason: "Démission avant le début de saison", effectiveOn: null });
      expect((await call("POST", `/memberships/${ids.ms1}/cancel`, treasurer, { reason: "Encore" })).statusCode).toBe(409);
      // Le membre peut de nouveau adhérer.
      expect((await enroll(ids.c1!, { memberId: ids.m1, tariffId: ids.plein })).statusCode).toBe(201);
      const history = (await call("GET", `/members/${ids.m1}/memberships`, boardMember)).json();
      expect(history.map((h: { status: string }) => h.status).sort()).toEqual(["CANCELLED", "PENDING"]);
    });

    it("refuse l'adhésion d'un ancien membre et d'un membre inconnu", async () => {
      const m = await member("Ancien");
      await call("PATCH", `/members/${m}`, treasurer, { version: 1, status: "FORMER" });
      const refused = await enroll(ids.c1!, { memberId: m, tariffId: ids.plein });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("membre actuel");
      expect((await enroll(ids.c1!, { memberId: randomUUID(), tariffId: ids.plein })).statusCode).toBe(404);
      expect((await enroll(ids.c1!, { memberId: ids.m1, tariffId: randomUUID() })).statusCode).toBe(404);
    });
  });

  describe("garanties", () => {
    it("fige les dates et le mode dès qu'une adhésion existe, et refuse de supprimer un tarif utilisé", async () => {
      const detail = (await call("GET", `/campaigns/${ids.c1}`, boardMember)).json();
      expect(detail.locked).toBe(true);
      const dates = await call("PATCH", `/campaigns/${ids.c1}`, treasurer, { endsOn: "2026-09-30" });
      expect(dates.statusCode).toBe(409);
      expect(dates.json().message).toContain("ne changent plus");
      expect((await call("PATCH", `/campaigns/${ids.c1}`, treasurer, { name: "Adhésions 2025-2026 (saison)" })).statusCode).toBe(200);
      const used = await call("DELETE", `/tariffs/${ids.plein}`, treasurer);
      expect(used.statusCode).toBe(409);
      expect(used.json().message).toContain("utilisé");
      const spare = await tariff(ids.c1!, "À supprimer", "5.00");
      expect((await call("DELETE", `/tariffs/${spare}`, treasurer)).statusCode).toBe(200);
    });

    it("refuse en SQL de supprimer une campagne ou une adhésion, ou de modifier un montant attendu", async () => {
      expect(await sqlError(`DELETE FROM "Campaign" WHERE id = '${ids.c1}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`DELETE FROM "Membership" WHERE id = '${ids.ms1}'`)).toContain("on l'annule");
      expect(await sqlError(`UPDATE "Membership" SET "expectedAmount" = 1 WHERE id = '${ids.ms1}'`)).not.toBeNull();
      expect(await sqlError(`TRUNCATE "Membership"`)).not.toBeNull();
      expect(await sqlError(`TRUNCATE "Campaign"`)).not.toBeNull();
    });
  });
});
