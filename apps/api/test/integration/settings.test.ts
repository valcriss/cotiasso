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
import { MODULE_CATALOG, type ModuleDefinition } from "../../src/settings/modules-catalog.js";
import { SettingsService } from "../../src/settings/settings.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

const CATALOG: ModuleDefinition[] = [
  { key: "alpha", label: "Alpha", description: "Premier module", available: true },
  { key: "beta", label: "Beta", description: "Dépend d'Alpha", available: true, requires: ["alpha"] },
  { key: "gamma", label: "Gamma", description: "Non livré", available: false, unavailableReason: "Non livré." },
];

describe("Paramètres et modules (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let settings: SettingsService;
  let admin: Session;

  const call = (method: "GET" | "POST" | "PUT", url: string, session?: Session, body?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: {
        ...(session && { cookie: session.cookie }),
        ...(session && method !== "GET" && { "x-csrf-token": session.csrf }),
      },
      ...(body !== undefined && { payload: body as Record<string, unknown> }),
    });

  const login = async (email: string): Promise<Session> => {
    const response = await call("POST", "/auth/login", undefined, { email, password: PASSWORD });
    expect(response.statusCode).toBe(200);
    return {
      cookie: String(response.headers["set-cookie"]).split(";")[0]!,
      csrf: response.json().csrfToken as string,
      userId: response.json().user.id as string,
    };
  };

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `s-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "S", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    return login(email);
  };

  beforeAll(async () => {
    db = await createTempDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue({ ...readEnv(), databaseUrl: db.url, cookieSecure: true })
      .overrideProvider(MODULE_CATALOG)
      .useValue(CATALOG)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    users = app.get(UsersService);
    settings = app.get(SettingsService);

    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD },
    });
    // Ces tests portent sur les paramètres, pas sur le second facteur.
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    admin = await login("admin@asso.test");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("publie la marque blanche avant toute connexion, avec des valeurs par défaut", async () => {
    const response = await call("GET", "/branding");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ appName: "cotiasso", sidebarBackground: "#eaf2fd", sidebarText: "#0b2a55", accentColor: "#005cbb" });
  });

  it("réserve la lecture et l'écriture des paramètres aux permissions prévues", async () => {
    expect((await call("GET", "/settings/identity")).statusCode).toBe(401);

    const reader = await userWith("reader");
    expect((await call("GET", "/settings/identity", reader)).statusCode).toBe(403);

    const president = await userWith("president");
    expect((await call("GET", "/settings/identity", president)).statusCode).toBe(200);
    expect((await call("PUT", "/settings/identity", president, { name: "Pirate" })).statusCode).toBe(403);
    expect((await call("GET", "/modules", president)).statusCode).toBe(200);
  });

  it("enregistre une nouvelle version, ignore une modification sans effet et garde l'historique", async () => {
    const identity = { name: "Club des amis", address: "1 rue Neuve", postalCode: "75001", city: "Paris", email: "bureau@asso.fr", phone: "", rna: "W123456789", siren: "" };
    const first = await call("PUT", "/settings/identity", admin, identity);
    expect(first.statusCode).toBe(200);
    expect(first.json().changed).toBe(true);
    expect((await call("GET", "/settings/identity", admin)).json().value).toMatchObject({ name: "Club des amis", city: "Paris" });

    const same = await call("PUT", "/settings/identity", admin, identity);
    expect(same.json().changed).toBe(false);

    await call("PUT", "/settings/identity", admin, { ...identity, city: "Lyon" });
    const history = (await call("GET", "/settings/identity/history", admin)).json() as { payload: { city: string } }[];
    expect(history.map((h) => h.payload.city)).toEqual(["Lyon", "Paris"]);
    await expect(prisma.settingsVersion.count({ where: { section: "identity" } })).resolves.toBe(2);
  });

  it("applique la marque blanche à l'endpoint public", async () => {
    const update = await call("PUT", "/settings/branding", admin, {
      appName: "Mon Asso",
      sidebarBackground: "#0B2A55",
      sidebarText: "#FFFFFF",
      accentColor: "#7A1F4D",
    });
    expect(update.statusCode).toBe(200);
    expect((await call("GET", "/branding")).json()).toEqual({
      appName: "Mon Asso",
      sidebarBackground: "#0b2a55",
      sidebarText: "#ffffff",
      accentColor: "#7a1f4d",
    });
  });

  it("garde l'accent par défaut quand il est omis et refuse un accent trop clair pour du texte blanc", async () => {
    const omitted = await call("PUT", "/settings/branding", admin, { appName: "Mon Asso", sidebarBackground: "#0b2a55", sidebarText: "#ffffff" });
    expect(omitted.statusCode).toBe(200);
    expect(omitted.json().value.accentColor).toBe("#005cbb");

    const tooLight = await call("PUT", "/settings/branding", admin, { appName: "Mon Asso", sidebarBackground: "#0b2a55", sidebarText: "#ffffff", accentColor: "#ffd54f" });
    expect(tooLight.statusCode).toBe(400);
    expect(tooLight.json().issues[0]).toMatchObject({ path: "accentColor" });
    expect(tooLight.json().issues[0].message).toContain("texte blanc");
    expect((await call("GET", "/branding")).json().accentColor).toBe("#005cbb");
  });

  it("refuse les paramètres invalides en désignant le champ fautif, sans rien enregistrer", async () => {
    const before = await prisma.settingsVersion.count();
    const badColor = await call("PUT", "/settings/branding", admin, { appName: "X", sidebarBackground: "rouge", sidebarText: "#ffffff" });
    expect(badColor.statusCode).toBe(400);
    expect(badColor.json().issues[0].path).toBe("sidebarBackground");

    const unreadable = await call("PUT", "/settings/branding", admin, { appName: "X", sidebarBackground: "#ffffff", sidebarText: "#f4f4f4" });
    expect(unreadable.statusCode).toBe(400);
    expect(unreadable.json().issues[0].message).toContain("contraste");

    expect((await call("PUT", "/settings/identity", admin, { name: "" })).statusCode).toBe(400);
    expect((await call("PUT", "/settings/identity", admin, { name: "Asso", inconnu: 1 })).statusCode).toBe(400);
    expect((await call("PUT", "/settings/identity", admin, [1, 2])).statusCode).toBe(400);
    expect((await call("GET", "/settings/inconnu", admin)).statusCode).toBe(404);
    expect((await call("GET", "/settings/__proto__", admin)).statusCode).toBe(404);
    await expect(prisma.settingsVersion.count()).resolves.toBe(before);
  });

  it("garde l'historique en ajout seul et audite les champs modifiés sans leur contenu", async () => {
    const version = await prisma.settingsVersion.findFirstOrThrow();
    await expect(prisma.settingsVersion.update({ where: { id: version.id }, data: { section: "x" } })).rejects.toThrow(/ajout seul/);
    await expect(prisma.settingsVersion.delete({ where: { id: version.id } })).rejects.toThrow(/ajout seul/);
    await expect(prisma.$executeRaw`TRUNCATE "SettingsVersion"`).rejects.toThrow(/ajout seul/);

    const events = await prisma.auditEvent.findMany({ where: { action: "settings.updated", objectId: "identity" } });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(events)).toContain("changedKeys");
    expect(JSON.stringify(events)).not.toContain("Club des amis");
  });

  it("ne tient pas compte d'une version dont la date d'effet est dans le futur", async () => {
    const current = await settings.current("identity");
    await prisma.settingsVersion.create({
      data: {
        section: "identity",
        effectiveFrom: new Date(Date.now() + 86_400_000),
        payload: { ...current, name: "Nom futur" },
      },
    });
    expect((await settings.current("identity")).name).toBe("Club des amis");
    expect((await settings.current("identity", new Date(Date.now() + 2 * 86_400_000))).name).toBe("Nom futur");
  });

  it("complète un ancien contenu avec les valeurs par défaut quand le schéma gagne des champs", async () => {
    await prisma.settingsVersion.create({ data: { section: "branding", payload: { appName: "Ancien", sidebarBackground: "#eaf2fd" } } });
    expect(await settings.current("branding")).toEqual({ appName: "Ancien", sidebarBackground: "#eaf2fd", sidebarText: "#0b2a55", accentColor: "#005cbb" });
  });

  describe("modules", () => {
    const status = async (session: Session) =>
      Object.fromEntries(((await call("GET", "/modules", session)).json() as { key: string; status: string }[]).map((m) => [m.key, m.status]));

    it("liste les modules avec leur état et le motif d'indisponibilité", async () => {
      const list = (await call("GET", "/modules", admin)).json() as { key: string; status: string; reason: string | null }[];
      expect(list.map((m) => [m.key, m.status])).toEqual([["alpha", "INACTIVE"], ["beta", "INACTIVE"], ["gamma", "UNAVAILABLE"]]);
      expect(list.find((m) => m.key === "gamma")!.reason).toBe("Non livré.");
      expect(list.find((m) => m.key === "beta")!.reason).toContain("Alpha");
    });

    it("réserve l'activation aux paramètres comptables, pas à l'administrateur technique", async () => {
      expect((await call("POST", "/modules/alpha/activate", admin)).statusCode).toBe(403);
      const treasurer = await userWith("treasurer");
      expect((await call("POST", "/modules/alpha/activate", treasurer)).statusCode).toBe(204);
      expect((await call("POST", "/modules/alpha/deactivate", treasurer)).statusCode).toBe(204);
    });

    it("refuse un module indisponible, un prérequis manquant et un module inconnu", async () => {
      const treasurer = await userWith("treasurer");
      const gamma = await call("POST", "/modules/gamma/activate", treasurer);
      expect(gamma.statusCode).toBe(409);
      expect(gamma.json().message).toContain("indisponible");

      const beta = await call("POST", "/modules/beta/activate", treasurer);
      expect(beta.statusCode).toBe(409);
      expect(beta.json().message).toContain("Alpha");

      expect((await call("POST", "/modules/inconnu/activate", treasurer)).statusCode).toBe(404);
      expect(await status(treasurer)).toMatchObject({ alpha: "INACTIVE", beta: "INACTIVE", gamma: "UNAVAILABLE" });
    });

    it("active dans l'ordre des prérequis, interdit de désactiver un module dont un autre dépend, et audite", async () => {
      const treasurer = await userWith("treasurer");
      expect((await call("POST", "/modules/alpha/activate", treasurer)).statusCode).toBe(204);
      expect((await call("POST", "/modules/alpha/activate", treasurer)).statusCode).toBe(409);
      expect((await call("POST", "/modules/beta/activate", treasurer)).statusCode).toBe(204);
      expect(await status(treasurer)).toMatchObject({ alpha: "ACTIVE", beta: "ACTIVE" });

      const blocked = await call("POST", "/modules/alpha/deactivate", treasurer);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().message).toContain("Beta");

      expect((await call("POST", "/modules/beta/deactivate", treasurer)).statusCode).toBe(204);
      expect((await call("POST", "/modules/beta/deactivate", treasurer)).statusCode).toBe(409);
      expect((await call("POST", "/modules/alpha/deactivate", treasurer)).statusCode).toBe(204);

      // Réactivation possible : l'historique reste dans l'audit.
      expect((await call("POST", "/modules/alpha/activate", treasurer)).statusCode).toBe(204);
      const actions = (await prisma.auditEvent.findMany({ where: { objectType: "Module", objectId: "alpha" } })).map((e) => e.action);
      expect(actions).toEqual(expect.arrayContaining(["module.activated", "module.deactivated"]));
      expect((await call("POST", "/modules/alpha/deactivate", treasurer)).statusCode).toBe(204);
    });
  });
});
