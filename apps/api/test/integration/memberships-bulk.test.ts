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

describe("Nouvelle saison et inscription en masse (#21)", () => {
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

  const member = async (firstName: string, extra: Record<string, unknown> = {}) =>
    (await call("POST", "/members", treasurer, { firstName, lastName: "Test", email: `${firstName.toLowerCase()}@asso.fr`, ...extra })).json().id as string;
  const renew = (body: object, session: Session | undefined = treasurer) => call("POST", `/campaigns/${ids.c}/renew`, session, body);
  const next = { name: "Adhésions 2026-2027", startsOn: "2026-09-29", endsOn: "2027-09-28" };

  it("prépare la saison suivante : mêmes réglages et tarifs, aucune adhésion, droit members:manage", async () => {
    const reduced = (await call("POST", `/campaigns/${ids.c}/tariffs`, treasurer, { label: "Tarif réduit", amount: "15.00" })).json();
    expect(reduced.tariffs).toHaveLength(2);
    expect((await renew(next, boardMember)).statusCode).toBe(403);
    expect((await call("POST", `/campaigns/${ids.c}/renew`, undefined, next)).statusCode).toBe(401);

    const done = await renew(next);
    expect(done.statusCode, done.body).toBe(201);
    const view = done.json();
    expect(view).toMatchObject({ name: "Adhésions 2026-2027", startsOn: "2026-09-29", endsOn: "2027-09-28", effectiveMode: "PAYMENT", membershipCount: 0 });
    expect(view.tariffs.map((t: { label: string; amount: string }) => [t.label, t.amount]).sort()).toEqual([["Plein tarif", "30.00"], ["Tarif réduit", "15.00"]]);
    ids.next = view.id;
    // La saison copiée n'est pas modifiée.
    expect((await call("GET", `/campaigns/${ids.c}`, treasurer)).json().tariffs).toHaveLength(2);
    const audit = await prisma.auditEvent.findFirst({ where: { action: "campaign.renewed", objectId: view.id } });
    expect(audit?.details).toMatchObject({ fromCampaignId: ids.c, tariffs: 2 });
  });

  it("refuse une saison qui chevauche une autre, ou dont la fin précède le début, sans rien créer", async () => {
    const overlap = await renew({ name: "Chevauche", startsOn: "2026-01-01", endsOn: "2026-12-31" });
    expect(overlap.statusCode).toBe(409);
    expect((await renew({ name: "À l'envers", startsOn: "2030-02-01", endsOn: "2030-01-01" })).statusCode).toBe(400);
    expect(await prisma.campaign.count()).toBe(2);
  });

  it("propose les membres à renouveler avec le tarif de l'an dernier, sans les sortis ni les anonymisés ni les déjà inscrits", async () => {
    const full = (await call("GET", `/campaigns/${ids.c}`, treasurer)).json().tariffs as { id: string; label: string }[];
    const reducedId = full.find((t) => t.label === "Tarif réduit")!.id;
    const cat = (await call("POST", "/member-categories", treasurer, { name: "Étudiant" })).json().id as string;
    const anne = await member("Anne");
    const bruno = await member("Bruno");
    const clara = await member("Clara", { categoryId: cat });
    const dora = await member("Dora");
    const ancien = await member("Ancien");
    await call("POST", `/campaigns/${ids.c}/memberships`, treasurer, { memberId: anne, tariffId: ids.t });
    await call("POST", `/campaigns/${ids.c}/memberships`, treasurer, { memberId: bruno, tariffId: reducedId });
    await call("POST", `/campaigns/${ids.c}/memberships`, treasurer, { memberId: ancien, tariffId: ids.t });
    await call("PATCH", `/members/${ancien}`, treasurer, { version: 1, status: "FORMER", leftOn: "2026-06-30" });
    // Dora déjà inscrite à la saison suivante : elle ne figure plus dans la liste.
    const nextTariff = ((await call("GET", `/campaigns/${ids.next}`, treasurer)).json().tariffs as { id: string; label: string }[]);
    await call("POST", `/campaigns/${ids.next}/memberships`, treasurer, { memberId: dora, tariffId: nextTariff[0]!.id });

    const preview = await call("GET", `/campaigns/${ids.next}/renewal-preview`, treasurer);
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json();
    expect(body.source).toMatchObject({ id: ids.c, name: "Adhésions 2025-2026" });
    const byName = Object.fromEntries(body.items.map((i: { memberName: string }) => [i.memberName.split(" ")[1], i]));
    expect(byName.Anne).toMatchObject({ previouslyEnrolled: true, previousTariffLabel: "Plein tarif" });
    expect(nextTariff.find((t) => t.id === byName.Anne.proposedTariffId)!.label).toBe("Plein tarif");
    expect(nextTariff.find((t) => t.id === byName.Bruno.proposedTariffId)!.label).toBe("Tarif réduit");
    // Clara n'était pas inscrite et deux tarifs sans catégorie existent : pas de tarif évident.
    expect(byName.Clara).toMatchObject({ previouslyEnrolled: false, proposedTariffId: null, categoryName: "Étudiant" });
    expect(byName.Ancien).toBeUndefined();
    expect(byName.Dora).toBeUndefined();
    expect((await call("GET", `/campaigns/${ids.next}/renewal-preview`, boardMember)).statusCode).toBe(403);
    ids.anne = anne; ids.bruno = bruno; ids.clara = clara; ids.ancien = ancien; ids.dora = dora; ids.reducedNext = nextTariff.find((t) => t.label === "Tarif réduit")!.id; ids.fullNext = nextTariff.find((t) => t.label === "Plein tarif")!.id;
  });

  it("inscrit en masse au tarif choisi, ignore les déjà inscrits et ne crée aucun doublon en relançant", async () => {
    const bulk = (items: object[], session = treasurer) => call("POST", `/campaigns/${ids.next}/memberships/bulk`, session, { items });
    expect((await bulk([{ memberId: ids.anne, tariffId: ids.fullNext }], boardMember)).statusCode).toBe(403);
    const first = await bulk([
      { memberId: ids.anne, tariffId: ids.fullNext },
      { memberId: ids.bruno, tariffId: ids.reducedNext },
      { memberId: ids.dora, tariffId: ids.fullNext }, // déjà inscrite
      { memberId: ids.anne, tariffId: ids.fullNext }, // même membre deux fois
    ]);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ created: 2, expectedTotal: "45.00" });
    expect(first.json().skipped).toEqual([{ memberId: ids.dora, memberName: "Test Dora", reason: "Déjà inscrit à cette campagne." }]);
    const list = (await call("GET", `/campaigns/${ids.next}/memberships`, treasurer)).json() as { memberName: string; expectedAmount: string; status: string }[];
    expect(list.map((m) => `${m.memberName}:${m.expectedAmount}`).sort()).toEqual(["Test Anne:30.00", "Test Bruno:15.00", "Test Dora:30.00"].sort());
    expect(list.every((m) => m.status === "PENDING")).toBe(true);
    // Relancer ne crée rien de plus.
    const again = await bulk([{ memberId: ids.anne, tariffId: ids.fullNext }, { memberId: ids.bruno, tariffId: ids.reducedNext }]);
    expect(again.json()).toMatchObject({ created: 0, expectedTotal: "0.00" });
    expect(again.json().skipped).toHaveLength(2);
    expect(await prisma.journalEntry.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "membership.bulk-created" } })).toBe(2);
  });

  it("refuse tout, sans rien créer, si un membre est sorti ou si un tarif n'est pas de la campagne", async () => {
    const before = await prisma.membership.count();
    const bad = await call("POST", `/campaigns/${ids.next}/memberships/bulk`, treasurer, {
      items: [{ memberId: ids.clara, tariffId: ids.fullNext }, { memberId: ids.ancien, tariffId: ids.fullNext }],
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().message).toContain("Rien n'a été créé");
    expect(bad.json().message).toContain("Test Ancien");
    const wrongTariff = await call("POST", `/campaigns/${ids.next}/memberships/bulk`, treasurer, { items: [{ memberId: ids.clara, tariffId: ids.t }] });
    expect(wrongTariff.statusCode).toBe(409);
    expect(wrongTariff.json().message).toContain("n'appartient pas à cette campagne");
    expect(await prisma.membership.count()).toBe(before);
    expect((await call("POST", `/campaigns/${ids.next}/memberships/bulk`, treasurer, { items: [] })).statusCode).toBe(400);
  });
});
