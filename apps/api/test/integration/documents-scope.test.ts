import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv, type AppEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";
const MAX_BYTES = 200 * 1024;

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

interface UploadFile {
  name: string;
  content: Buffer;
  type?: string;
}

const PDF = (extra = "") => Buffer.from(`%PDF-1.7\n% test ${extra}\n${"x".repeat(200)}`);

/** Construit un corps multipart/form-data sans dépendance. */
function multipart(fields: Record<string, string>, files: UploadFile[] = []) {
  const boundary = `----cotiasso${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? "application/octet-stream"}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Documents : portée projet (base vierge, stockage temporaire)", () => {
  let db: TempDatabase;
  let storageDir: string;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let board: Session;
  let reader: Session;
  let managerA: Session;
  let readerA: Session;
  let managerB: Session;
  let externalA: Session;
  const ids = {} as {
    a: string;
    b: string;
    funder: string;
    member: string;
    grantA: string;
    grantB: string;
    d1: string;
    d2: string;
    d3: string;
    d4: string;
    d5: string;
    d6: string;
    d7: string;
    d8: string;
    d9: string;
    d10: string;
  };

  const request = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, session?: Session, body?: unknown) =>
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

  const upload = (url: string, session: Session | undefined, fields: Record<string, string>, files: UploadFile[]) => {
    const { payload, contentType } = multipart(fields, files);
    return app.inject({
      method: "POST",
      url,
      payload,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: {
        "content-type": contentType,
        ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }),
      },
    });
  };

  const login = async (email: string): Promise<Session> => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return {
      cookie: String(response.headers["set-cookie"]).split(";")[0]!,
      csrf: response.json().csrfToken as string,
      userId: response.json().user.id as string,
    };
  };

  const userWith = async (roleKey: string, projectId?: string): Promise<Session> => {
    const email = `d-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "D", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id, ...(projectId && { projectId }) } });
    return login(email);
  };

  const filesOnDisk = async () => (await readdir(storageDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());
  const titles = (response: { json(): { items: { title: string }[] } }) => response.json().items.map((d) => d.title).sort();
  const deposit = (as: Session, links: { objectType: string; objectId: string }[], fields: Record<string, string> = {}, content = PDF(randomUUID())) =>
    upload("/documents", as, { title: "Pièce", category: "facture", links: JSON.stringify(links), ...fields }, [{ name: "piece.pdf", content }]);
  /** Dépose en tant que trésorier (droit global) et rend l'identifiant du document. */
  const seed = async (title: string, links: { objectType: string; objectId: string }[], fields: Record<string, string> = {}, content = PDF(title)) => {
    const response = await deposit(treasurer, links, { title, ...fields }, content);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().document.id as string;
  };
  const api = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, session?: Session, body?: unknown) => request(method, url, session, body);
  const project = async (code: string) => (await api("POST", "/projects", treasurer, { code, name: code })).json().id as string;
  const grantFor = async (title: string, projectId: string) => {
    const created = await api("POST", "/grants", treasurer, { funderId: ids.funder, title, requestedAmount: "100", allocations: [{ projectId, amount: "100" }] });
    expect(created.statusCode, created.body).toBe(201);
    const decided = await api("POST", `/grants/${created.json().id}/grant`, treasurer, { grantedAmount: "100.00", decidedOn: "2026-03-15" });
    expect(decided.statusCode, decided.body).toBe(200);
    return decided.json().id as string;
  };

  beforeAll(async () => {
    db = await createTempDatabase();
    storageDir = await mkdtemp(join(tmpdir(), "cotiasso-e2e-docs-scope-"));
    const env: AppEnv = { ...readEnv(), databaseUrl: db.url, cookieSecure: true, documentsDir: storageDir, documentsMaxBytes: MAX_BYTES };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENV).useValue(env).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app, env);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    users = app.get(UsersService);

    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    treasurer = await userWith("treasurer");
    board = await userWith("board-member");
    reader = await userWith("reader");

    ids.a = await project("ATELIERS");
    ids.b = await project("FESTIVAL");
    ids.funder = (await api("POST", "/funders", treasurer, { name: "Région", type: "LOCAL_AUTHORITY" })).json().id;
    ids.member = (await api("POST", "/members", treasurer, { firstName: "Alice", lastName: "Martin" })).json().id;
    ids.grantA = await grantFor("Aide ateliers", ids.a);
    ids.grantB = await grantFor("Aide festival", ids.b);

    managerA = await userWith("project-manager", ids.a);
    readerA = await userWith("reader", ids.a);
    managerB = await userWith("project-manager", ids.b);
    // Un rôle sans droit documentaire : l'accès au projet ne donne pas ses documents.
    await prisma.role.create({ data: { key: "external", name: "Intervenant extérieur", description: "Voit un projet, aucun document.", permissions: ["projects:view"], requiresMfa: false } });
    externalA = await userWith("external", ids.a);

    // Les documents du jeu d'essai.
    ids.d1 = await seed("Devis ateliers", [{ objectType: "project", objectId: ids.a }]);
    ids.d2 = await seed("Devis festival", [{ objectType: "project", objectId: ids.b }], {}, PDF("commun"));
    ids.d3 = await seed("Convention ateliers", [{ objectType: "grant", objectId: ids.grantA }]);
    ids.d4 = await seed("Convention festival", [{ objectType: "grant", objectId: ids.grantB }]);
    ids.d5 = await seed("Facture et adhésion", [{ objectType: "project", objectId: ids.a }, { objectType: "member", objectId: ids.member }]);
    ids.d6 = await seed("Restreint ateliers", [{ objectType: "project", objectId: ids.a }], { restricted: "true" });
    ids.d7 = await seed("Sans lien", []);
    ids.d8 = await seed("Partagé", [{ objectType: "project", objectId: ids.a }, { objectType: "project", objectId: ids.b }]);
    ids.d9 = await seed("Archivé ateliers", [{ objectType: "project", objectId: ids.a }]);
    await api("POST", `/documents/${ids.d9}/archive`, treasurer, {});
    ids.d10 = await seed("Facture liée à une écriture", [{ objectType: "project", objectId: ids.a }, { objectType: "transaction", objectId: randomUUID() }]);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
    await rm(storageDir, { recursive: true, force: true });
  });

  describe("lecture", () => {
    it("ne liste que les documents liés au projet ou à une subvention qui le finance, sans restreint ni pièce de membre", async () => {
      const list = await api("GET", "/documents", managerA);
      expect(list.statusCode).toBe(200);
      expect(titles(list)).toEqual(["Convention ateliers", "Devis ateliers", "Facture liée à une écriture", "Partagé"]);
      expect(list.json().total).toBe(4);
      // Les documents archivés se demandent, comme pour tout le monde, mais restent dans la portée.
      expect(titles(await api("GET", "/documents?includeArchived=true", managerA))).toContain("Archivé ateliers");
      expect(titles(await api("GET", "/documents", managerB))).toEqual(["Convention festival", "Devis festival", "Partagé"]);
    });

    it("garde le comportement d'un droit global : tout est visible, sauf le restreint sans le droit dédié", async () => {
      const all = titles(await api("GET", "/documents", treasurer));
      expect(all).toEqual(expect.arrayContaining(["Devis ateliers", "Devis festival", "Sans lien", "Facture et adhésion", "Restreint ateliers", "Convention festival"]));
      const boardList = titles(await api("GET", "/documents", board));
      expect(boardList).toContain("Sans lien");
      expect(boardList).not.toContain("Restreint ateliers");
    });

    it("rend introuvable (404) tout document hors portée, restreint, sans lien, lié à un membre ou à une subvention d'un autre projet", async () => {
      for (const hidden of [ids.d2, ids.d4, ids.d5, ids.d6, ids.d7]) {
        expect((await api("GET", `/documents/${hidden}`, managerA)).statusCode, hidden).toBe(404);
        expect((await api("GET", `/documents/${hidden}/download`, managerA)).statusCode, hidden).toBe(404);
      }
      for (const visible of [ids.d1, ids.d3, ids.d8, ids.d10]) expect((await api("GET", `/documents/${visible}`, managerA)).statusCode, visible).toBe(200);
      expect((await api("GET", `/documents/${randomUUID()}`, managerA)).statusCode).toBe(404);
    });

    it("télécharge un document de sa portée, en pièce jointe, et refuse les autres", async () => {
      const file = await api("GET", `/documents/${ids.d1}/download`, managerA);
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-disposition"]).toContain("attachment");
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
      expect(file.headers["cache-control"]).toBe("private, no-store");
      expect((await api("GET", `/documents/${ids.d2}/download`, managerA)).statusCode).toBe(404);
      expect((await api("GET", `/documents/${ids.d6}/download`, managerA)).statusCode).toBe(404);
    });

    it("ne montre que les liens de sa portée dans le détail et dans le décompte", async () => {
      const shared = (await api("GET", `/documents/${ids.d8}`, managerA)).json();
      expect(shared.links.map((l: { objectType: string; objectId: string }) => `${l.objectType}:${l.objectId}`)).toEqual([`project:${ids.a}`]);
      expect(shared.linkCount).toBe(1);
      const withEntry = (await api("GET", `/documents/${ids.d10}`, managerA)).json();
      expect(withEntry.links).toHaveLength(1);
      expect(withEntry.linkCount).toBe(1);
      expect((await api("GET", `/documents/${ids.d10}`, treasurer)).json().links).toHaveLength(2);
      const listed = (await api("GET", "/documents", managerA)).json().items.find((d: { id: string }) => d.id === ids.d8);
      expect(listed.linkCount).toBe(1);
    });

    it("ne laisse chercher ni filtrer que dans sa portée : titre, objet lié, catégorie", async () => {
      expect((await api("GET", "/documents?q=festival", managerA)).json().items.map((d: { id: string }) => d.id)).toEqual([]);
      expect(titles(await api("GET", "/documents?q=ateliers", managerA))).toEqual(["Convention ateliers", "Devis ateliers"]);
      // Filtrer sur un autre projet ne révèle pas que « Partagé » lui est aussi lié.
      expect((await api("GET", `/documents?objectType=project&objectId=${ids.b}`, managerA)).json().total).toBe(0);
      expect((await api("GET", `/documents?objectType=member&objectId=${ids.member}`, managerA)).json().total).toBe(0);
      expect(titles(await api("GET", `/documents?objectType=project&objectId=${ids.a}`, managerA))).toEqual(["Devis ateliers", "Facture liée à une écriture", "Partagé"]);
      expect(titles(await api("GET", `/documents?objectType=grant&objectId=${ids.grantA}`, managerA))).toEqual(["Convention ateliers"]);
      expect((await api("GET", `/documents?objectType=grant&objectId=${ids.grantB}`, managerA)).json().total).toBe(0);
      expect((await api("GET", "/documents?category=facture", managerA)).json().items.every((d: { title: string }) => d.title !== "Devis festival")).toBe(true);
    });

    it("refuse l'accès sans droit documentaire, même avec accès au projet, et sans session", async () => {
      expect((await api("GET", "/documents")).statusCode).toBe(401);
      expect((await api("GET", "/documents", externalA)).statusCode).toBe(403);
      expect((await api("GET", "/documents/options", externalA)).statusCode).toBe(403);
      expect((await api("GET", `/documents/${ids.d1}`, externalA)).statusCode).toBe(403);
      expect((await api("GET", `/documents/${ids.d1}/download`, externalA)).statusCode).toBe(403);
      expect((await api("GET", "/documents/options", managerA)).statusCode).toBe(200);
    });
  });

  describe("dépôt et modification", () => {
    it("dépose pour son projet, ou pour une subvention qui le finance", async () => {
      const own = await deposit(managerA, [{ objectType: "project", objectId: ids.a }], { title: "Devis traiteur" });
      expect(own.statusCode, own.body).toBe(201);
      expect(own.json().document.links.map((l: { objectType: string }) => l.objectType)).toEqual(["project"]);
      const viaGrant = await deposit(managerA, [{ objectType: "grant", objectId: ids.grantA }], { title: "Justificatif de la convention" });
      expect(viaGrant.statusCode, viaGrant.body).toBe(201);
      expect(titles(await api("GET", "/documents", managerA))).toEqual(expect.arrayContaining(["Devis traiteur", "Justificatif de la convention"]));
      expect(titles(await api("GET", "/documents", managerB))).not.toContain("Devis traiteur");
    });

    it("refuse un dépôt qui sort de sa portée, sans laisser de fichier sur le disque", async () => {
      const before = (await filesOnDisk()).length;
      const refused = [
        await deposit(managerA, []),
        await deposit(managerA, [{ objectType: "project", objectId: ids.b }]),
        await deposit(managerA, [{ objectType: "project", objectId: ids.a }, { objectType: "project", objectId: ids.b }]),
        await deposit(managerA, [{ objectType: "grant", objectId: ids.grantB }]),
        await deposit(managerA, [{ objectType: "member", objectId: ids.member }]),
        await deposit(managerA, [{ objectType: "project", objectId: ids.a }, { objectType: "transaction", objectId: randomUUID() }]),
        await deposit(managerA, [{ objectType: "project", objectId: ids.a }], { restricted: "true" }),
      ];
      expect(refused.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403, 403, 403]);
      expect(refused[0]!.json().message).toContain("lié à ce projet");
      expect((await filesOnDisk()).length).toBe(before);
    });

    it("refuse le dépôt à qui n'a pas documents:create sur le projet", async () => {
      expect((await deposit(readerA, [{ objectType: "project", objectId: ids.a }])).statusCode).toBe(403);
      expect((await deposit(externalA, [{ objectType: "project", objectId: ids.a }])).statusCode).toBe(403);
      expect((await upload("/documents", undefined, { title: "x", category: "facture" }, [{ name: "p.pdf", content: PDF() }])).statusCode).toBe(401);
      // Mais la lecture reste ouverte à celui qui a documents:view sur le projet.
      expect((await api("GET", `/documents/${ids.d1}`, readerA)).statusCode).toBe(200);
    });

    it("ajoute une version à un document de sa portée seulement", async () => {
      const ok = await upload(`/documents/${ids.d1}/versions`, managerA, { comment: "Mise à jour" }, [{ name: "v2.pdf", content: PDF("v2") }]);
      expect(ok.statusCode, ok.body).toBe(201);
      expect(ok.json().document.versionCount).toBe(2);
      const before = (await filesOnDisk()).length;
      for (const hidden of [ids.d2, ids.d5, ids.d6, ids.d7]) {
        expect((await upload(`/documents/${hidden}/versions`, managerA, {}, [{ name: "v.pdf", content: PDF(hidden) }])).statusCode, hidden).toBe(404);
      }
      expect((await upload(`/documents/${ids.d1}/versions`, readerA, {}, [{ name: "v.pdf", content: PDF("lecteur") }])).statusCode).toBe(403);
      expect((await filesOnDisk()).length).toBe(before);
    });

    it("modifie le titre et la catégorie, jamais le caractère restreint", async () => {
      expect((await api("PATCH", `/documents/${ids.d1}`, managerA, { title: "Devis ateliers (signé)", category: "devis" })).json()).toMatchObject({ title: "Devis ateliers (signé)", category: "devis" });
      const restrict = await api("PATCH", `/documents/${ids.d1}`, managerA, { restricted: true });
      expect(restrict.statusCode).toBe(403);
      expect((await api("PATCH", `/documents/${ids.d2}`, managerA, { title: "Piraté" })).statusCode).toBe(404);
      expect((await api("PATCH", `/documents/${ids.d1}`, readerA, { title: "Piraté" })).statusCode).toBe(403);
      expect((await api("GET", `/documents/${ids.d2}`, treasurer)).json().title).toBe("Devis festival");
    });

    it("ne lie qu'à ses projets et aux subventions qui les financent", async () => {
      const link = (id: string, objectType: string, objectId: string, as = managerA) => api("POST", `/documents/${id}/links`, as, { objectType, objectId });
      expect((await link(ids.d3, "project", ids.a)).statusCode).toBe(200);
      expect((await link(ids.d3, "project", ids.b)).statusCode).toBe(403);
      expect((await link(ids.d3, "grant", ids.grantB)).statusCode).toBe(403);
      expect((await link(ids.d3, "member", ids.member)).statusCode).toBe(403);
      expect((await link(ids.d2, "project", ids.a)).statusCode).toBe(404);
      expect((await link(ids.d3, "project", ids.a, readerA)).statusCode).toBe(403);
      // Le document hors portée n'a pas reçu le lien refusé.
      expect((await api("GET", `/documents/${ids.d3}`, treasurer)).json().links.map((l: { objectType: string; objectId: string }) => l.objectId)).not.toContain(ids.b);
    });

    it("réserve l'archivage et le retrait d'un lien aux droits globaux", async () => {
      const links = (await api("GET", `/documents/${ids.d1}`, treasurer)).json().links;
      expect((await api("POST", `/documents/${ids.d1}/archive`, managerA, {})).statusCode).toBe(403);
      expect((await api("POST", `/documents/${ids.d9}/unarchive`, managerA, {})).statusCode).toBe(403);
      expect((await api("DELETE", `/documents/${ids.d1}/links/${links[0].id}`, managerA)).statusCode).toBe(403);
      expect((await api("GET", `/documents/${ids.d1}`, treasurer)).json().archivedAt).toBeNull();
    });
  });

  describe("doublons et audit", () => {
    it("ne révèle pas le titre d'un document hors portée qui a le même contenu", async () => {
      const content = PDF("commun");
      const scoped = await deposit(managerA, [{ objectType: "project", objectId: ids.a }], { title: "Mon exemplaire" }, content);
      expect(scoped.statusCode, scoped.body).toBe(201);
      expect(scoped.json().duplicates).toEqual([]);
      // Un droit global voit, lui, les deux exemplaires.
      const global = await deposit(treasurer, [{ objectType: "project", objectId: ids.a }], { title: "Troisième exemplaire" }, content);
      expect(global.json().duplicates.map((d: { title: string }) => d.title).sort()).toEqual(["Devis festival", "Mon exemplaire"]);
    });

    it("trace les dépôts d'une personne limitée à un projet", async () => {
      const events = await prisma.auditEvent.findMany({ where: { action: "document.created", actorId: managerA.userId } });
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(await prisma.auditEvent.count({ where: { action: "document.linked", actorId: managerA.userId } })).toBeGreaterThanOrEqual(1);
    });

    it("garde le téléchargement d'un document restreint audité pour un droit global", async () => {
      expect((await api("GET", `/documents/${ids.d6}/download`, treasurer)).statusCode).toBe(200);
      expect(await prisma.auditEvent.count({ where: { action: "document.downloaded", objectId: ids.d6 } })).toBeGreaterThanOrEqual(1);
      expect((await api("GET", `/documents/${ids.d6}`, board)).statusCode).toBe(404);
      expect((await api("GET", `/documents/${ids.d6}`, reader)).statusCode).toBe(404);
    });
  });
});
