import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
const MIGRATION = fileURLToPath(new URL("../../prisma/migrations/20261104040000_link_members_to_accounts/migration.sql", import.meta.url));

interface Session {
  cookie: string;
  csrf: string;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

describe("Membres : liaison fiche ↔ compte de connexion (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let admin: Session;

  const call = (method: Method, url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `l-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "T", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
    return { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
  };
  const account = (email: string, displayName = "Compte") => users.createUser({ email, displayName, password: PASSWORD });
  const newMember = async (overrides: Record<string, unknown> = {}) => {
    const response = await call("POST", "/members", treasurer, { firstName: "Marie", lastName: "Dupont", ...overrides });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; hasAccount: boolean; version: number };
  };
  const hasAccount = async (memberId: string) => (await call("GET", `/members/${memberId}`, treasurer)).json().member.hasAccount as boolean;
  const linkedEvents = () => prisma.auditEvent.findMany({ where: { action: "member.account.linked" }, orderBy: { seq: "asc" } });

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
    admin = await userWith("technical-admin");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("réserve la liaison au droit members.account:link, que l'on peut donner à un autre rôle", async () => {
    expect((await call("GET", "/member-accounts/available")).statusCode).toBe(401);
    expect((await call("GET", "/member-accounts/available", treasurer)).statusCode).toBe(403);
    expect((await call("GET", "/member-accounts/available", admin)).statusCode).toBe(200);
    const member = await newMember({ firstName: "Droit", lastName: "Test" });
    expect((await call("PUT", `/members/${member.id}/account`, treasurer, { userId: randomUUID() })).statusCode).toBe(403);
    expect((await call("DELETE", `/members/${member.id}/account`, treasurer)).statusCode).toBe(403);

    // Le droit est un droit de rôle comme un autre : le trésorier peut le recevoir.
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "treasurer" } });
    await prisma.role.update({ where: { id: role.id }, data: { permissions: [...role.permissions, "members.account:link"] } });
    expect((await call("GET", "/member-accounts/available", treasurer)).statusCode).toBe(200);
    await prisma.role.update({ where: { id: role.id }, data: { permissions: role.permissions } });
    expect((await call("GET", "/member-accounts/available", treasurer)).statusCode).toBe(403);
  });

  it("relie tout seul une nouvelle fiche à un compte qui a la même adresse email (majuscules ignorées)", async () => {
    const user = await account("auto-fiche@test.invalid");
    const member = await newMember({ firstName: "Auto", lastName: "Fiche", email: "Auto-Fiche@Test.Invalid" });
    expect(member.hasAccount).toBe(true);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).userId).toBe(user.id);
    const event = (await linkedEvents()).at(-1)!;
    expect(event).toMatchObject({ objectId: member.id });
    expect(event.details).toEqual({ via: "email", userId: user.id });
  });

  it("relie tout seul un compte créé après la fiche, dans la même opération", async () => {
    const member = await newMember({ firstName: "Auto", lastName: "Compte", email: "auto-compte@test.invalid" });
    expect(member.hasAccount).toBe(false);
    const invited = await call("POST", "/users", admin, { email: "Auto-Compte@test.invalid", displayName: "Auto Compte", roleIds: [] });
    expect(invited.statusCode, invited.body).toBe(201);
    expect(await hasAccount(member.id)).toBe(true);
    expect((await linkedEvents()).at(-1)!.details).toEqual({ via: "email", userId: invited.json().user.id });
  });

  it("relie la fiche quand on y saisit ensuite l'adresse du compte", async () => {
    await account("saisie-tardive@test.invalid");
    const member = await newMember({ firstName: "Saisie", lastName: "Tardive" });
    expect(member.hasAccount).toBe(false);
    const patched = await call("PATCH", `/members/${member.id}`, treasurer, { version: member.version, email: "saisie-tardive@test.invalid" });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().hasAccount).toBe(true);
  });

  it("ne relie ni un ancien membre, ni un compte déjà pris par une autre fiche", async () => {
    const taken = await account("pris@test.invalid");
    const first = await newMember({ firstName: "Premier", lastName: "Pris", email: "pris@test.invalid" });
    expect(first.hasAccount).toBe(true);
    // Un compte ne correspond qu'à une fiche : la liaison manuelle à une seconde fiche est refusée.
    const second = await newMember({ firstName: "Second", lastName: "Libre" });
    const refused = await call("PUT", `/members/${second.id}/account`, admin, { userId: taken.id });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("Premier Pris");

    await call("PATCH", `/members/${(await newMember({ firstName: "Ancien", lastName: "Sorti", email: "sorti@test.invalid" })).id}`, treasurer, { version: 1, status: "FORMER" });
    const late = await account("sorti@test.invalid");
    const former = await prisma.member.findFirstOrThrow({ where: { email: "sorti@test.invalid" } });
    expect(former.userId).toBeNull();
    expect(late.id).toBeTruthy();
  });

  it("associe à la main une fiche sans adresse, trace le lien et refuse les cas impossibles", async () => {
    const user = await account("manuel@test.invalid", "Manuel");
    const member = await newMember({ firstName: "Sans", lastName: "Adresse" });

    const available = (await call("GET", "/member-accounts/available", admin)).json() as { id: string; email: string }[];
    expect(available.map((a) => a.email)).toContain("manuel@test.invalid");
    // Un compte déjà relié n'est plus proposé.
    expect(available.map((a) => a.email)).not.toContain("auto-fiche@test.invalid");

    expect((await call("PUT", `/members/${member.id}/account`, admin, {})).statusCode).toBe(400);
    expect((await call("PUT", `/members/${member.id}/account`, admin, { userId: randomUUID() })).statusCode).toBe(404);

    const linked = await call("PUT", `/members/${member.id}/account`, admin, { userId: user.id });
    expect(linked.statusCode, linked.body).toBe(200);
    expect(linked.json()).toEqual({ hasAccount: true });
    expect(await hasAccount(member.id)).toBe(true);
    expect((await linkedEvents()).at(-1)!.details).toEqual({ via: "manual", userId: user.id });

    const again = await call("PUT", `/members/${member.id}/account`, admin, { userId: user.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toContain("déjà reliée");

    const disabled = await account("desactive@test.invalid");
    await prisma.user.update({ where: { id: disabled.id }, data: { status: "DISABLED" } });
    const other = await newMember({ firstName: "Autre", lastName: "Fiche" });
    const refused = await call("PUT", `/members/${other.id}/account`, admin, { userId: disabled.id });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("désactivé");
  });

  it("détache une fiche de son compte sans toucher à la fiche, et libère le compte", async () => {
    const user = await account("detache@test.invalid");
    const member = await newMember({ firstName: "Détache", lastName: "Moi" });
    await call("PUT", `/members/${member.id}/account`, admin, { userId: user.id });

    const detached = await call("DELETE", `/members/${member.id}/account`, admin);
    expect(detached.statusCode, detached.body).toBe(200);
    expect(detached.json()).toEqual({ hasAccount: false });
    expect(await hasAccount(member.id)).toBe(false);
    expect((await prisma.auditEvent.findMany({ where: { action: "member.account.unlinked" } })).length).toBeGreaterThan(0);
    expect(((await call("GET", "/member-accounts/available", admin)).json() as { id: string }[]).map((a) => a.id)).toContain(user.id);

    expect((await call("DELETE", `/members/${member.id}/account`, admin)).statusCode).toBe(409);
  });

  it("rend la demande de remboursement possible une fois la fiche reliée", async () => {
    const user = await account("rembourse@test.invalid");
    await prisma.member.create({ data: { firstName: "Rem", lastName: "Bourse", email: "rembourse@test.invalid" } });
    const before = await prisma.member.findFirstOrThrow({ where: { email: "rembourse@test.invalid" } });
    expect(before.userId).toBeNull();
    await call("PUT", `/members/${before.id}/account`, admin, { userId: user.id });
    expect((await prisma.member.findUniqueOrThrow({ where: { id: before.id } })).userId).toBe(user.id);
  });

  it("la migration relie les fiches et comptes déjà saisis qui ont la même adresse, une seule fois", async () => {
    const user = await account("rattrapage@test.invalid");
    const spare = await account("rattrapage-pris@test.invalid");
    await prisma.member.create({ data: { firstName: "Rat", lastName: "Trapage", email: "Rattrapage@Test.Invalid" } });
    await prisma.member.create({ data: { firstName: "Déjà", lastName: "Pris", email: "rattrapage-pris@test.invalid", userId: spare.id } });

    const statements = (await readFile(MIGRATION, "utf8"))
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);

    expect((await prisma.member.findFirstOrThrow({ where: { lastName: "Trapage" } })).userId).toBe(user.id);
    expect((await prisma.member.findFirstOrThrow({ where: { lastName: "Pris" } })).userId).toBe(spare.id);
    // Rejouée, elle ne change rien.
    const versions = await prisma.member.findMany({ select: { id: true, version: true }, orderBy: { id: "asc" } });
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
    expect(await prisma.member.findMany({ select: { id: true, version: true }, orderBy: { id: "asc" } })).toEqual(versions);
  });
});
