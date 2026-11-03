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

describe("Documents (base vierge, stockage temporaire)", () => {
  let db: TempDatabase;
  let storageDir: string;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let board: Session;
  let reader: Session;

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

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `d-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "D", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    return login(email);
  };

  const filesOnDisk = async () => (await readdir(storageDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());

  const create = async (fields: Record<string, string> = {}, file: UploadFile = { name: "facture.pdf", content: PDF() }, as = treasurer) => {
    const response = await upload("/documents", as, { title: "Facture électricité", category: "facture", ...fields }, [file]);
    return response;
  };

  beforeAll(async () => {
    db = await createTempDatabase();
    storageDir = await mkdtemp(join(tmpdir(), "cotiasso-e2e-docs-"));
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
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
    await rm(storageDir, { recursive: true, force: true });
  });

  it("dépose un PDF : version 1, empreinte exacte, fichier sous une clé opaque et audit", async () => {
    const content = PDF("v1");
    const response = await create({ comment: "Première version" }, { name: "Facture EDF 2026.pdf", content });
    expect(response.statusCode).toBe(201);

    const { document, duplicates } = response.json();
    expect(duplicates).toEqual([]);
    expect(document).toMatchObject({ title: "Facture électricité", category: "facture", restricted: false, versionCount: 1, linkCount: 0 });
    expect(document.versions[0]).toMatchObject({
      number: 1,
      originalName: "Facture EDF 2026.pdf",
      mimeType: "application/pdf",
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      comment: "Première version",
    });

    const stored = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: document.id } });
    expect(stored.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(stored.storageKey).not.toContain("EDF");
    expect(await readFile(join(storageDir, stored.storageKey))).toEqual(content);

    const audit = JSON.stringify(await prisma.auditEvent.findMany({ where: { objectId: document.id } }));
    expect(audit).toContain("document.created");
  });

  it("sert le fichier en pièce jointe, tel quel, avec des en-têtes de protection", async () => {
    const content = PDF("telechargement");
    const { document } = (await create({}, { name: "Reçu été 2026.pdf", content })).json();

    const download = await request("GET", `/documents/${document.id}/download`, reader);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(content);
    expect(download.headers["content-type"]).toBe("application/pdf");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.headers["content-disposition"]).toContain("filename*=UTF-8''Re%C3%A7u%20%C3%A9t%C3%A9%202026.pdf");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.headers["content-security-policy"]).toContain("sandbox");
    expect(download.headers["cache-control"]).toContain("no-store");

    expect((await request("GET", `/documents/${document.id}/download`)).statusCode).toBe(401);
  });

  it("refuse les fichiers dangereux, déguisés ou vides, sans rien laisser sur le disque", async () => {
    const before = (await filesOnDisk()).length;
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    for (const file of [
      { name: "page.html", content: html },
      { name: "image.svg", content: Buffer.from("<svg onload=alert(1)></svg>") },
      { name: "programme.exe", content: Buffer.from("MZ\u0090\u0000\u0003") },
      { name: "facture.pdf", content: html },
      { name: "sans-extension", content: PDF() },
      { name: "vide.pdf", content: Buffer.alloc(0) },
    ]) {
      const response = await create({}, file);
      expect(response.statusCode, file.name).toBe(415);
    }
    expect((await filesOnDisk()).length).toBe(before);
    await expect(prisma.document.count({ where: { title: "Facture électricité", versions: { some: { originalName: "page.html" } } } })).resolves.toBe(0);
  });

  it("refuse un fichier trop grand (413) sans en conserver de trace", async () => {
    const before = (await filesOnDisk()).length;
    const huge = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(MAX_BYTES + 10, 0x61)]);
    expect((await create({}, { name: "enorme.pdf", content: huge })).statusCode).toBe(413);
    expect((await filesOnDisk()).length).toBe(before);
  });

  it("valide la requête : droits, champs obligatoires, catégorie, un seul fichier, type d'envoi", async () => {
    expect((await create({}, undefined, reader)).statusCode).toBe(403);
    expect((await upload("/documents", undefined, { title: "x", category: "facture" }, [{ name: "a.pdf", content: PDF() }])).statusCode).toBe(401);

    const before = (await filesOnDisk()).length;
    expect((await upload("/documents", treasurer, { title: "Sans fichier", category: "facture" }, [])).statusCode).toBe(400);
    expect((await create({ category: "inconnue" })).statusCode).toBe(400);
    expect((await create({ title: "   " })).statusCode).toBe(400);
    expect((await create({ links: "pas du json" })).statusCode).toBe(400);
    expect((await create({ links: JSON.stringify([{ objectType: "inconnu", objectId: "1" }]) })).statusCode).toBe(400);
    const two = await upload("/documents", treasurer, { title: "Deux", category: "facture" }, [
      { name: "a.pdf", content: PDF("a") },
      { name: "b.pdf", content: PDF("b") },
    ]);
    expect(two.statusCode).toBe(400);
    expect((await request("POST", "/documents", treasurer, { title: "json" })).statusCode).toBe(415);
    expect((await filesOnDisk()).length).toBe(before);
  });

  it("neutralise un nom de fichier malveillant : il ne sert jamais de chemin", async () => {
    const response = await create({}, { name: "../../../etc/passwd.pdf", content: PDF("traversal") });
    expect(response.statusCode).toBe(201);
    const version = response.json().document.versions[0];
    expect(version.originalName).toBe("passwd.pdf");
    const stored = await prisma.documentVersion.findFirstOrThrow({ where: { sha256: version.sha256 } });
    expect(stored.storageKey).not.toContain("passwd");
  });

  it("ajoute des versions immuables, numérotées sans doublon même en concurrence", async () => {
    const v1 = PDF("version-1");
    const { document } = (await create({}, { name: "convention.pdf", content: v1 })).json();

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        upload(`/documents/${document.id}/versions`, treasurer, { comment: `révision ${i}` }, [{ name: "convention.pdf", content: PDF(`v-${i}`) }]),
      ),
    );
    expect(concurrent.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);

    const detail = (await request("GET", `/documents/${document.id}`, treasurer)).json();
    expect(detail.versions.map((v: { number: number }) => v.number)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(detail.versionCount).toBe(6);
    expect(detail.latest.number).toBe(6);

    // L'ancienne version reste téléchargeable telle quelle.
    const old = await request("GET", `/documents/${document.id}/download?version=1`, reader);
    expect(old.rawPayload).toEqual(v1);
    expect((await request("GET", `/documents/${document.id}/download?version=99`, reader)).statusCode).toBe(404);
    expect((await request("GET", `/documents/${document.id}/download?version=abc`, reader)).statusCode).toBe(400);

    const version = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: document.id } });
    await expect(prisma.documentVersion.update({ where: { id: version.id }, data: { originalName: "x.pdf" } })).rejects.toThrow(/immuable/);
    await expect(prisma.documentVersion.delete({ where: { id: version.id } })).rejects.toThrow(/immuable/);
    await expect(prisma.document.delete({ where: { id: document.id } })).rejects.toThrow(/ne se supprime pas/);
  });

  it("signale un contenu déjà déposé sans le bloquer", async () => {
    const content = PDF("doublon");
    const first = (await create({ title: "Premier dépôt" }, { name: "a.pdf", content })).json();
    const second = (await create({ title: "Second dépôt" }, { name: "b.pdf", content })).json();
    expect(second.duplicates).toEqual([{ documentId: first.document.id, title: "Premier dépôt" }]);
    expect(second.document.title).toBe("Second dépôt");
  });

  it("relie un justificatif à une transaction dès le dépôt et le retrouve depuis ce mouvement", async () => {
    const transactionId = randomUUID();
    const { document } = (
      await create({ title: "Facture cartes de visite", category: "facture", links: JSON.stringify([{ objectType: "transaction", objectId: transactionId }]) }, { name: "facture.pdf", content: PDF("cartes") })
    ).json();
    const found = (await request("GET", `/documents?objectType=transaction&objectId=${transactionId}`, reader)).json();
    expect(found.items.map((d: { id: string }) => d.id)).toEqual([document.id]);
    expect((await request("GET", `/documents?objectType=transaction&objectId=${randomUUID()}`, reader)).json().total).toBe(0);
  });

  it("relie un document à plusieurs objets, sans doublon, et le retrouve par objet", async () => {
    const projectId = randomUUID();
    const { document } = (
      await create({ title: "Devis atelier", category: "devis", links: JSON.stringify([{ objectType: "project", objectId: projectId }]) }, { name: "devis.pdf", content: PDF("devis") })
    ).json();
    expect(document.linkCount).toBe(1);

    const memberId = randomUUID();
    const linked = (await request("POST", `/documents/${document.id}/links`, treasurer, { objectType: "member", objectId: memberId })).json();
    expect(linked.linkCount).toBe(2);
    expect((await request("POST", `/documents/${document.id}/links`, treasurer, { objectType: "member", objectId: memberId })).json().linkCount).toBe(2);
    expect((await request("POST", `/documents/${document.id}/links`, treasurer, { objectType: "inconnu", objectId: "1" })).statusCode).toBe(400);

    const byProject = (await request("GET", `/documents?objectType=project&objectId=${projectId}`, reader)).json();
    expect(byProject.items.map((d: { id: string }) => d.id)).toEqual([document.id]);
    expect((await request("GET", `/documents?objectType=project&objectId=${randomUUID()}`, reader)).json().total).toBe(0);

    const link = linked.links.find((l: { objectType: string }) => l.objectType === "project");
    const after = (await request("DELETE", `/documents/${document.id}/links/${link.id}`, treasurer)).json();
    expect(after.linkCount).toBe(1);
    // Retirer un lien ne supprime jamais le document.
    expect((await request("GET", `/documents/${document.id}`, reader)).statusCode).toBe(200);
    expect((await request("DELETE", `/documents/${document.id}/links/${link.id}`, treasurer)).statusCode).toBe(404);
    expect((await request("POST", `/documents/${document.id}/links`, reader, { objectType: "member", objectId: "1" })).statusCode).toBe(403);
  });

  it("cache les documents restreints à qui n'a pas la permission, partout (liste, détail, téléchargement)", async () => {
    const content = PDF("restreint");
    const { document } = (await create({ title: "Procès-verbal confidentiel", category: "proces-verbal", restricted: "true" }, { name: "pv.pdf", content })).json();
    expect(document.restricted).toBe(true);

    for (const outsider of [board, reader]) {
      expect((await request("GET", `/documents/${document.id}`, outsider)).statusCode).toBe(404);
      expect((await request("GET", `/documents/${document.id}/download`, outsider)).statusCode).toBe(404);
      const list = (await request("GET", "/documents?limit=200", outsider)).json();
      expect(list.items.some((d: { id: string }) => d.id === document.id)).toBe(false);
      expect((await request("GET", "/documents?q=confidentiel", outsider)).json().total).toBe(0);
    }

    // Un membre du bureau peut déposer des documents mais pas voir les restreints : il ne peut pas les modifier non plus.
    expect((await request("POST", `/documents/${document.id}/links`, board, { objectType: "member", objectId: "1" })).statusCode).toBe(404);
    expect((await upload(`/documents/${document.id}/versions`, board, {}, [{ name: "pv.pdf", content: PDF("x") }])).statusCode).toBe(404);
    expect((await request("PATCH", `/documents/${document.id}`, board, { title: "Pirate" })).statusCode).toBe(404);
    expect((await request("POST", `/documents/${document.id}/archive`, board)).statusCode).toBe(404);

    // Le trésorier (documents.restricted:view) y accède ; ce téléchargement est audité.
    const download = await request("GET", `/documents/${document.id}/download`, treasurer);
    expect(download.rawPayload).toEqual(content);
    const actions = (await prisma.auditEvent.findMany({ where: { objectId: document.id } })).map((e) => e.action);
    expect(actions).toContain("document.downloaded");

    // Sans la permission, on ne peut ni créer de document restreint ni en modifier le caractère restreint.
    expect((await create({ restricted: "true" }, undefined, board)).statusCode).toBe(403);
    const open = (await create({ title: "Ouvert" }, undefined, board)).json().document;
    expect((await request("PATCH", `/documents/${open.id}`, board, { restricted: true })).statusCode).toBe(403);
    expect((await request("PATCH", `/documents/${open.id}`, treasurer, { restricted: true })).json().restricted).toBe(true);
    expect((await request("GET", `/documents/${open.id}`, board)).statusCode).toBe(404);
  });

  it("archive au lieu de supprimer : masqué par défaut, figé tant qu'il est archivé, réactivable", async () => {
    const { document } = (await create({ title: "Document à archiver" })).json();
    expect((await request("POST", `/documents/${document.id}/archive`, reader)).statusCode).toBe(403);
    const archived = (await request("POST", `/documents/${document.id}/archive`, treasurer)).json();
    expect(archived.archivedAt).not.toBeNull();

    expect((await request("GET", "/documents?q=archiver", reader)).json().total).toBe(0);
    expect((await request("GET", "/documents?q=archiver&includeArchived=true", reader)).json().total).toBe(1);
    expect((await upload(`/documents/${document.id}/versions`, treasurer, {}, [{ name: "a.pdf", content: PDF("z") }])).statusCode).toBe(409);
    expect((await request("PATCH", `/documents/${document.id}`, treasurer, { title: "Autre" })).statusCode).toBe(409);
    expect((await request("POST", `/documents/${document.id}/links`, treasurer, { objectType: "member", objectId: "1" })).statusCode).toBe(409);

    expect((await request("POST", `/documents/${document.id}/unarchive`, treasurer)).json().archivedAt).toBeNull();
    expect((await request("PATCH", `/documents/${document.id}`, treasurer, { title: "Titre mis à jour" })).json().title).toBe("Titre mis à jour");
  });

  it("filtre et pagine la liste, et expose les options des formulaires", async () => {
    const byCategory = (await request("GET", "/documents?category=devis", reader)).json();
    expect(byCategory.items.every((d: { category: string }) => d.category === "devis")).toBe(true);
    expect(byCategory.total).toBeGreaterThanOrEqual(1);
    expect((await request("GET", "/documents?q=ÉLECTRICITÉ", reader)).json().total).toBeGreaterThanOrEqual(1);

    const page1 = (await request("GET", "/documents?page=1", reader)).json();
    expect(page1.pageSize).toBe(50);
    expect((await request("GET", "/documents?page=0", reader)).statusCode).toBe(400);
    expect((await request("GET", "/documents?page=abc", reader)).statusCode).toBe(400);

    const options = (await request("GET", "/documents/options", reader)).json();
    expect(options.categories.map((c: { key: string }) => c.key)).toContain("facture");
    expect(options.objectTypes).toContain("project");
    expect(options.allowedExtensions).toContain("pdf");
    expect(options.allowedExtensions).not.toContain("html");
    expect((await request("GET", `/documents/${randomUUID()}`, reader)).statusCode).toBe(404);
    expect((await request("GET", "/documents/pas-un-uuid", reader)).statusCode).toBe(404);
  });
});
