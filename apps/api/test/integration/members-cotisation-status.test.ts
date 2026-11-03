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

describe("Situation de cotisation des membres (#20)", () => {
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
    const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    ids.c = (await call("POST", "/campaigns", treasurer, { name: "Saison en cours", startsOn: shift(-100), endsOn: shift(200), effectiveMode: "PAYMENT" })).json().id;
    ids.t = (await call("POST", `/campaigns/${ids.c}/tariffs`, treasurer, { label: "Plein tarif", amount: "30.00" })).json().tariffs[0].id;
    const withFree = (await call("POST", `/campaigns/${ids.c}/tariffs`, treasurer, { label: "Gratuit", amount: "0.00" })).json().tariffs as { id: string; label: string }[];
    ids.free = withFree.find((t) => t.label === "Gratuit")!.id;
  }, 60_000);


  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  const listed = async (query = "", session = treasurer) => {
    const response = await call("GET", `/members?limit=200${query}`, session);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { members: { id: string; firstName: string; membershipStatus: string | null }[]; campaign: { name: string } | null };
  };
  const status = async (firstName: string) => (await listed()).members.find((m) => m.firstName === firstName)?.membershipStatus;

  it("sans saison en cours, personne n'a de situation de cotisation ; avec elle, un membre non inscrit est « pas inscrit »", async () => {
    await call("POST", "/members", treasurer, { firstName: "Avant", lastName: "Saison" });
    const original = await prisma.campaign.findUniqueOrThrow({ where: { id: ids.c! } });
    // Aucune adhésion n'existe encore : on peut décaler la saison hors d'aujourd'hui, puis la remettre.
    await prisma.campaign.update({ where: { id: ids.c! }, data: { startsOn: new Date("2001-01-01"), endsOn: new Date("2001-12-31") } });
    const none = await listed();
    expect(none.campaign).toBeNull();
    expect(none.members.find((m) => m.firstName === "Avant")!.membershipStatus).toBeNull();
    expect((await listed("&membershipStatus=NONE")).members.map((m) => m.firstName)).toContain("Avant");
    expect((await listed("&membershipStatus=LATE")).members).toEqual([]);
    await prisma.campaign.update({ where: { id: ids.c! }, data: { startsOn: original.startsOn, endsOn: original.endsOn } });

    const current = await listed();
    expect(current.campaign).toMatchObject({ name: "Saison en cours" });
    expect(current.members.find((m) => m.firstName === "Avant")!.membershipStatus).toBe("NONE");
  });

  it("dit pour chaque membre s'il est à jour, en retard (partiel ou dû), exonéré ou pas inscrit", async () => {
    const member = async (firstName: string) => (await call("POST", "/members", treasurer, { firstName, lastName: "Test", email: `${firstName.toLowerCase()}@asso.fr` })).json().id as string;
    const enroll = async (memberId: string, tariffId: string) => (await call("POST", `/campaigns/${ids.c}/memberships`, treasurer, { memberId, tariffId })).json().id as string;
    const pay = async (membershipId: string, amount: string) => {
      const t = (await call("POST", `/financial-accounts/${ids.fa}/transactions`, treasurer, { operationDate: new Date().toISOString().slice(0, 10), amount, label: "Règlement" })).json().id;
      expect((await call("POST", `/memberships/${membershipId}/allocations`, treasurer, { transactionId: t, amount })).statusCode).toBe(201);
    };
    const paid = await enroll(await member("Payee"), ids.t!);
    await pay(paid, "30.00");
    const partial = await enroll(await member("Partielle"), ids.t!);
    await pay(partial, "10.00");
    await enroll(await member("Due"), ids.t!);
    await enroll(await member("Exoneree"), ids.free!);
    await member("Absente");
    const cancelled = await enroll(await member("Annulee"), ids.t!);
    await call("POST", `/memberships/${cancelled}/cancel`, treasurer, { reason: "Erreur de saisie" });
    const over = await enroll(await member("Troppercue"), ids.t!);
    await pay(over, "50.00");

    expect(await status("Payee")).toBe("UP_TO_DATE");
    expect(await status("Partielle")).toBe("PARTIAL");
    expect(await status("Due")).toBe("DUE");
    expect(await status("Exoneree")).toBe("EXEMPT");
    expect(await status("Absente")).toBe("NONE");
    expect(await status("Annulee")).toBe("NONE");
    expect(await status("Troppercue")).toBe("UP_TO_DATE");
  });

  it("filtre : à jour (exonérés compris), en retard (partiels et dus), pas inscrits", async () => {
    const names = async (filter: string) => (await listed(`&membershipStatus=${filter}`)).members.map((m) => m.firstName).sort();
    expect(await names("UP_TO_DATE")).toEqual(["Exoneree", "Payee", "Troppercue"]);
    expect(await names("LATE")).toEqual(["Due", "Partielle"]);
    expect(await names("DUE")).toEqual(["Due"]);
    expect(await names("PARTIAL")).toEqual(["Partielle"]);
    expect(await names("NONE")).toEqual(["Absente", "Annulee", "Avant"]);
    expect((await call("GET", "/members?membershipStatus=NIMPORTEQUOI", treasurer)).statusCode).toBe(400);
  });

  it("garde la pagination et les autres filtres, et reste réservé à members:view", async () => {
    const page = await listed("&membershipStatus=UP_TO_DATE&q=pay");
    expect(page.members.map((m) => m.firstName)).toEqual(["Payee"]);
    expect((await call("GET", "/members", reader)).statusCode).toBe(403);
    expect((await call("GET", "/members?membershipStatus=LATE", undefined)).statusCode).toBe(401);
  });
});
