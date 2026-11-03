import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { UsersService } from "../../src/auth/users.service.js";
import { deflateSync } from "node:zlib";
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
    const env = { ...readEnv(), databaseUrl: db.url, cookieSecure: true };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(MODULE_CATALOG)
      .useValue(CATALOG)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app, env);
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
    expect(response.json()).toEqual({ appName: "cotiasso", sidebarBackground: "#eaf2fd", sidebarText: "#0b2a55", accentColor: "#005cbb", logoHash: null, logoShowsName: true });
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
      logoHash: null,
      logoShowsName: true,
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

  describe("logo de l'association", () => {
    const png = (width: number, height: number) => {
      const header = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
      header.writeUInt32BE(13, 8);
      header.write("IHDR", 12, "latin1");
      header.writeUInt32BE(width, 16);
      header.writeUInt32BE(height, 20);
      return Buffer.concat([header, deflateSync(Buffer.alloc(8))]);
    };
    const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#005cbb"/></svg>');

    const upload = (session: Session | undefined, content: Buffer, name = "logo.png") => {
      const boundary = `----cotiasso${randomUUID()}`;
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return app.inject({
        method: "PUT",
        url: "/branding/logo",
        remoteAddress: "198.51.100.77",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }),
        },
        payload,
      });
    };

    it("n'existe pas tant qu'aucun logo n'a été ajouté", async () => {
      expect((await call("GET", "/branding/logo")).statusCode).toBe(404);
      expect((await call("GET", "/branding")).json().logoHash).toBeNull();
    });

    it("réserve l'ajout et le retrait à settings.association:admin", async () => {
      expect((await upload(undefined, png(64, 64))).statusCode).toBe(401);
      const president = await userWith("president");
      expect((await upload(president, png(64, 64))).statusCode).toBe(403);
      const removal = await app.inject({ method: "DELETE", url: "/branding/logo", headers: { cookie: president.cookie, "x-csrf-token": president.csrf } });
      expect(removal.statusCode).toBe(403);
    });

    it("refuse un fichier qui n'est pas un logo, trop petit, trop grand ou trop lourd, avec un message qui dit quoi faire", async () => {
      const notImage = await upload(admin, Buffer.from("%PDF-1.7 pas une image"), "logo.png");
      expect(notImage.statusCode).toBe(400);
      expect(notImage.json().message).toContain("PNG, JPEG ou SVG");
      expect((await upload(admin, png(8, 8))).json().message).toContain("trop petite");
      expect((await upload(admin, png(4000, 3000))).json().message).toContain("trop grande");
      expect((await upload(admin, Buffer.from('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>'), "x.svg")).statusCode).toBe(400);
      const heavy = await upload(admin, Buffer.concat([png(64, 64), Buffer.alloc(1024 * 1024)]));
      expect(heavy.statusCode).toBe(413);
      expect((await call("GET", "/branding")).json().logoHash).toBeNull();
    });

    it("enregistre un PNG, le sert publiquement sans pouvoir l'exécuter, puis le remplace par un SVG et le retire", async () => {
      const first = await upload(admin, png(64, 48));
      expect(first.statusCode, first.body).toBe(200);
      const hash = first.json().logoHash as string;
      expect((await call("GET", "/branding")).json().logoHash).toBe(hash);

      const served = await call("GET", "/branding/logo");
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/png");
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      expect(String(served.headers["content-security-policy"])).toContain("sandbox");
      expect(served.headers["etag"]).toBe(`"${hash}"`);
      expect(served.rawPayload.equals(png(64, 48))).toBe(true);

      const cached = await app.inject({ method: "GET", url: "/branding/logo", headers: { "if-none-match": `"${hash}"` } });
      expect(cached.statusCode).toBe(304);

      const second = await upload(admin, SVG, "logo.svg");
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json().logoHash).not.toBe(hash);
      expect((await call("GET", "/branding/logo")).headers["content-type"]).toBe("image/svg+xml");
      // Renvoyer le même fichier ne change rien.
      const again = await upload(admin, SVG, "logo.svg");
      expect(again.json().logoHash).toBe(second.json().logoHash);
      await expect(prisma.settingsVersion.count({ where: { section: "logo" } })).resolves.toBe(2);

      const removal = await app.inject({ method: "DELETE", url: "/branding/logo", headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf } });
      expect(removal.statusCode).toBe(204);
      expect((await call("GET", "/branding/logo")).statusCode).toBe(404);
      expect((await call("GET", "/branding")).json().logoHash).toBeNull();

      // Les images restent en base (ajout seul) et le changement est audité.
      await expect(prisma.brandLogo.count()).resolves.toBe(2);
      await expect(prisma.$executeRawUnsafe('DELETE FROM "BrandLogo"')).rejects.toThrow(/ajout seul/);
      const actions = (await prisma.auditEvent.findMany({ where: { action: { startsWith: "branding.logo" } }, orderBy: { seq: "asc" } })).map((e) => e.action);
      expect(actions).toEqual(["branding.logo.updated", "branding.logo.updated", "branding.logo.removed"]);
    });

    it("permet d'afficher le logo seul ou avec le nom, sans perdre ce choix en changeant de logo", async () => {
      const display = (session: Session | undefined, body: unknown) =>
        app.inject({
          method: "PUT",
          url: "/branding/logo/display",
          headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
          payload: body as Record<string, unknown>,
        });
      const president = await userWith("president");
      expect((await display(undefined, { showName: false })).statusCode).toBe(401);
      expect((await display(president, { showName: false })).statusCode).toBe(403);

      const invalid = await display(admin, { showName: "non" });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().message).toContain("showName");

      expect((await display(admin, { showName: false })).statusCode).toBe(204);
      expect((await call("GET", "/branding")).json().logoShowsName).toBe(false);
      // Rien ne change quand le choix est déjà celui-là.
      expect((await display(admin, { showName: false })).statusCode).toBe(204);

      const added = await upload(admin, SVG, "logo.svg");
      expect(added.statusCode, added.body).toBe(200);
      expect((await call("GET", "/branding")).json()).toMatchObject({ logoHash: added.json().logoHash, logoShowsName: false });

      expect((await display(admin, { showName: true })).statusCode).toBe(204);
      expect((await call("GET", "/branding")).json().logoShowsName).toBe(true);
      const actions = (await prisma.auditEvent.findMany({ where: { action: "branding.logo.display-changed" } })).length;
      expect(actions).toBe(2);
      await app.inject({ method: "DELETE", url: "/branding/logo", headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf } });
    });

    it("n'est pas modifiable par l'API générique des paramètres", async () => {
      expect((await call("PUT", "/settings/logo", admin, { sha256: "a".repeat(64) })).statusCode).toBe(404);
    });
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
