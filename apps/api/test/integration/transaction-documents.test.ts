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

describe("Indicateur « pièce jointe » des mouvements (#30)", () => {
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

  it("montre qu'un mouvement a une pièce jointe, seulement à qui peut lire les documents, sans révéler un document restreint", async () => {
    const accounts = (await request("POST", "/accounts", treasurer, { number: "512", label: "Banque" })).json();
    const fa = (await request("POST", "/financial-accounts", treasurer, { name: "Banque", type: "BANK", accountId: accounts.id, openedOn: "2026-01-01", openingBalance: "0.00" })).json();
    const add = async (label: string) => (await request("POST", `/financial-accounts/${fa.id}/transactions`, treasurer, { operationDate: "2026-03-01", amount: "-10.00", label })).json().id as string;
    const withDoc = await add("Avec facture");
    const withRestricted = await add("Avec pièce restreinte");
    const without = await add("Sans pièce");
    const archivedDoc = await add("Pièce archivée");

    const link = (id: string) => JSON.stringify([{ objectType: "transaction", objectId: id }]);
    expect((await create({ title: "Facture A", links: link(withDoc) })).statusCode).toBe(201);
    expect((await create({ title: "Pièce confidentielle", restricted: "true", links: link(withRestricted) }, { name: "p.pdf", content: PDF("r") })).statusCode).toBe(201);
    const archived = await create({ title: "À archiver", links: link(archivedDoc) }, { name: "a.pdf", content: PDF("a") });
    expect((await request("POST", `/documents/${archived.json().document.id}/archive`, treasurer)).statusCode).toBe(200);

    const flags = async (session: Session) => {
      const response = await request("GET", `/financial-accounts/${fa.id}/transactions?limit=100`, session);
      expect(response.statusCode, response.body).toBe(200);
      return new Map((response.json().transactions as { id: string; hasDocument?: boolean }[]).map((t) => [t.id, t.hasDocument]));
    };
    // Droit de lire tous les documents (dont les restreints) : la pièce restreinte compte, l'archivée non.
    const full = await prisma.role.create({ data: { key: `full-${randomUUID()}`, name: `Full ${randomUUID()}`, permissions: ["financial-accounts:view", "documents:view", "documents.restricted:view"], requiresMfa: false } });
    const fullUser = await users.createUser({ email: `f-${randomUUID()}@test.invalid`, displayName: "F", password: PASSWORD });
    await prisma.roleAssignment.create({ data: { userId: fullUser.id, roleId: full.id } });
    const fullSession = await login(fullUser.email);
    const all = await flags(fullSession);
    expect(all.get(withDoc)).toBe(true);
    expect(all.get(withRestricted)).toBe(true);
    expect(all.get(without)).toBe(false);
    expect(all.get(archivedDoc)).toBe(false);

    // Sans le droit sur les documents restreints : la pièce restreinte n'apparaît pas (aucune fuite).
    const plain = await prisma.role.create({ data: { key: `plain-${randomUUID()}`, name: `Plain ${randomUUID()}`, permissions: ["financial-accounts:view", "documents:view"], requiresMfa: false } });
    const plainUser = await users.createUser({ email: `p-${randomUUID()}@test.invalid`, displayName: "P", password: PASSWORD });
    await prisma.roleAssignment.create({ data: { userId: plainUser.id, roleId: plain.id } });
    const some = await flags(await login(plainUser.email));
    expect(some.get(withDoc)).toBe(true);
    expect(some.get(withRestricted)).toBe(false);

    // Sans le droit de lire les documents : le champ est absent, pas « faux ».
    const nodoc = await prisma.role.create({ data: { key: `nodoc-${randomUUID()}`, name: `NoDoc ${randomUUID()}`, permissions: ["financial-accounts:view"], requiresMfa: false } });
    const nodocUser = await users.createUser({ email: `n-${randomUUID()}@test.invalid`, displayName: "N", password: PASSWORD });
    await prisma.roleAssignment.create({ data: { userId: nodocUser.id, roleId: nodoc.id } });
    const none = await flags(await login(nodocUser.email));
    expect([...none.values()].every((v) => v === undefined)).toBe(true);
  });
});
