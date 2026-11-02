import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { AUDIT_EXPORT_MAX } from "../../src/audit/audit-query.service.js";
import { AuditService } from "../../src/audit/audit.service.js";
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
  userId: string;
}

describe("Export du journal d'audit (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let audit: AuditService;
  let admin: Session;

  const call = (url: string, session?: Session) =>
    app.inject({
      method: "GET",
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie }) },
    });

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

  const verify = async () => (await call("/audit/verify", admin)).json() as {
    ok: boolean;
    checked: number;
    unchained: number;
    firstBrokenSeq: number | null;
    reason: string | null;
  };

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `a-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "A", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    return login(email);
  };
  /** Lignes de données du CSV (après les 4 lignes d'en-tête et la ligne de titres), découpées sur « ; ». */
  const dataRows = (body: string) => body.split("\r\n").slice(5).filter(Boolean);

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
    audit = app.get(AuditService);

    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin Test", password: PASSWORD },
    });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    admin = await login("admin@asso.test");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("réserve l'export à audit:view", async () => {
    expect((await call("/audit/csv")).statusCode).toBe(401);
    expect((await call("/audit/csv", await userWith("reader"))).statusCode).toBe(403);
    expect((await call("/audit/csv", await userWith("president"))).statusCode).toBe(200);
  });

  it("envoie un CSV en pièce jointe, sans cache, avec son contexte et ses colonnes", async () => {
    const response = await call("/audit/csv", admin);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="journal-d-audit-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body.startsWith("\uFEFF")).toBe(true);
    const lines = response.body.split("\r\n");
    expect(lines[0]).toMatch(/^\uFEFFJournal d'audit;exporté le \d{4}-.*;\d+ événement\(s\)$/);
    expect(lines[1]).toBe("Filtres appliqués;aucun (journal complet)");
    expect(lines[2]).toContain("copie de contrôle");
    expect(lines[2]).toContain("ne constitue pas un archivage à valeur probante");
    expect(lines[4]).toBe("N°;Date et heure (UTC);Acteur;Email de l'acteur;Action;Type d'objet;Identifiant de l'objet;Justification;Détails;Empreinte;Empreinte précédente");
  });

  it("exporte les événements du plus ancien au plus récent, avec leurs empreintes exactes", async () => {
    await audit.record({ action: "test.export", objectType: "Test", objectId: "1", actorId: admin.userId, details: { zeta: 1, alpha: 2 } });
    await audit.record({ action: "test.export", objectType: "Test", objectId: "2" });
    // Le décompte est pris avant l'appel : l'export écrit ensuite son propre événement, qu'il ne contient donc pas.
    const countBefore = await prisma.auditEvent.count();
    const body = (await call("/audit/csv", admin)).body;
    const rows = dataRows(body).map((line) => line.split(";"));
    const seqs = rows.map((r) => Number(r[0]));
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(rows.length).toBe(countBefore);

    const stored = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" }, take: countBefore });
    rows.forEach((row, index) => {
      expect(row[9]).toBe(stored[index]!.hash ?? "");
      expect(row[10]).toBe(stored[index]!.previousHash ?? "");
    });
    // Le premier événement n'a pas de précédent ; chacun cite l'empreinte du précédent.
    expect(rows[0]![10]).toBe("");
    expect(rows[1]![10]).toBe(rows[0]![9]);

    const mine = rows.find((r) => r[5] === "Test" && r[6] === "1")!;
    expect(mine.slice(2, 5)).toEqual(["Admin Test", "admin@asso.test", "test.export"]);
  });

  it("filtre comme la liste : action, objet, acteur, période", async () => {
    const byAction = dataRows((await call("/audit/csv?action=test.export", admin)).body);
    expect(byAction).toHaveLength(2);
    expect((await call("/audit/csv?action=test.export", admin)).body.split("\r\n")[1]).toBe("Filtres appliqués;action « test.export »");
    expect(dataRows((await call("/audit/csv?objectType=Test&objectId=2", admin)).body)).toHaveLength(1);
    expect(dataRows((await call(`/audit/csv?actorId=${admin.userId}&action=test.export`, admin)).body)).toHaveLength(1);
    expect(dataRows((await call("/audit/csv?from=2999-01-01", admin)).body)).toHaveLength(0);
    expect(dataRows((await call("/audit/csv?to=2000-01-01", admin)).body)).toHaveLength(0);
    expect((await call("/audit/csv?actorId=pas-un-id", admin)).statusCode).toBe(400);
    expect((await call("/audit/csv?from=demain", admin)).statusCode).toBe(400);
  });

  it("neutralise les formules et met entre guillemets les cellules à séparateur", async () => {
    await audit.record({ action: "test.formula", objectType: "Test", objectId: "@cmd", justification: "=1+1; \"piège\"", details: { note: "+x" } });
    const body = (await call("/audit/csv?action=test.formula", admin)).body;
    expect(body).toContain("'@cmd");
    expect(body).toContain("\"'=1+1; \"\"piège\"\"\"");
    expect(body).not.toMatch(/;=1\+1/);
  });

  it("exporte sans les vérifier les événements antérieurs à la chaîne (empreintes vides)", async () => {
    await prisma.auditEvent.create({ data: { action: "test.legacy", objectType: "Test" } });
    const row = dataRows((await call("/audit/csv?action=test.legacy", admin)).body)[0]!.split(";");
    expect(row.slice(9)).toEqual(["", ""]);
  });

  it("trace l'export dans le journal, sans en recopier le contenu, et ne s'y inclut pas", async () => {
    const before = await prisma.auditEvent.count({ where: { action: "report.exported" } });
    const response = await call("/audit/csv?action=test.export", admin);
    expect(response.body).not.toContain("report.exported");
    const events = await prisma.auditEvent.findMany({ where: { action: "report.exported" }, orderBy: { seq: "desc" }, take: 1 });
    expect(await prisma.auditEvent.count({ where: { action: "report.exported" } })).toBe(before + 1);
    expect(events[0]!.details).toMatchObject({ kind: "audit", events: 2, query: { action: "test.export" } });
    expect(JSON.stringify(events[0]!.details)).not.toContain("alpha");
    // L'export suivant, lui, contient le précédent.
    expect((await call("/audit/csv?action=report.exported", admin)).body).toContain("report.exported");
  });

  it("refuse un export trop gros avec un message qui invite à restreindre, sans le tronquer", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditEvent" ("id","occurredAt","action","objectType") SELECT gen_random_uuid(), now(), 'test.bulk', 'Test' FROM generate_series(1, ${AUDIT_EXPORT_MAX + 1})`,
    );
    const refused = await call("/audit/csv", admin);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toContain("Restreignez la période ou les filtres");
    // Restreint, l'export passe.
    expect((await call("/audit/csv?action=test.export", admin)).statusCode).toBe(200);
  }, 60_000);
});
