import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { SendMailOptions } from "nodemailer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv, type AppEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { MAIL_TRANSPORT, type MailTransport } from "../../src/mail/mail.service.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { MAX_ATTEMPTS, ReimbursementNotifier } from "../../src/reimbursements/reimbursement-notifier.js";
import { SetupService } from "../../src/setup/setup.service.js";
import type { Circuit } from "../../src/workflows/engine/circuit.js";
import { WorkflowsService } from "../../src/workflows/workflows.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";
const SMTP = { host: "smtp.asso.test", port: 587, secure: false, user: null, password: null, from: "no-reply@asso.test", publicUrl: "https://compta.asso.test" };

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  email: string;
}

class FakeTransport implements MailTransport {
  sent: SendMailOptions[] = [];
  failWith: Error | null = null;
  async sendMail(message: SendMailOptions): Promise<unknown> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return {};
  }
}

const PDF = Buffer.from(`%PDF-1.7\n% test\n${"x".repeat(200)}`);

function multipart(file: { name: string; content: Buffer }) {
  const boundary = `----cotiasso${randomUUID()}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Notifications des demandes de remboursement (ADR 0035, tranche 4, base vierge)", () => {
  let db: TempDatabase;
  let storageDir: string;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let notifier: ReimbursementNotifier;
  let lea: Session;
  let claire: Session;
  let paul: Session;
  let tess: Session;
  const transport = new FakeTransport();

  const call = (method: "GET" | "POST", url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });
  const account = async (roleKey: string, name: string): Promise<Session> => {
    const email = `n-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: name, password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    await prisma.member.create({ data: { firstName: name, lastName: "Test", userId: user.id } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
    return { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken, userId: user.id, email };
  };
  const submit = async (who: Session) => {
    const created = (await call("POST", "/reimbursements", who, { amount: "42.50", expenseDate: "2026-03-10", reason: "Peinture secrète pour l'atelier" })).json();
    const { payload, contentType } = multipart({ name: "t.pdf", content: PDF });
    await app.inject({ method: "POST", url: `/reimbursements/${created.id}/documents`, payload, headers: { "content-type": contentType, cookie: who.cookie, "x-csrf-token": who.csrf } });
    const sent = await call("POST", `/reimbursements/${created.id}/submit`, who);
    expect(sent.statusCode, sent.body).toBe(200);
    return created.id as string;
  };
  const outbox = (subjectId: string) => prisma.notificationOutbox.findMany({ where: { subjectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  /** Envoie tout ce qui attend (les tests précédents laissent des notifications), pour partir d'une file vide. */
  const flush = async () => {
    transport.failWith = null;
    await notifier.dispatchDue(new Date(Date.now() + 365 * 24 * 3_600_000));
    transport.sent.length = 0;
  };
  const kinds = async (subjectId: string) => (await outbox(subjectId)).map((n) => `${n.kind}:${n.recipientUserId}`).sort();

  beforeAll(async () => {
    db = await createTempDatabase();
    storageDir = await mkdtemp(join(tmpdir(), "cotiasso-e2e-notif-"));
    const env: AppEnv = { ...readEnv(), databaseUrl: db.url, cookieSecure: true, documentsDir: storageDir, smtp: SMTP };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENV).useValue(env).overrideProvider(MAIL_TRANSPORT).useValue(transport).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app, env);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    users = app.get(UsersService);
    notifier = app.get(ReimbursementNotifier);
    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@asso.test" } })).id;

    tess = await account("treasurer", "Tess");
    lea = await account("member", "Léa");
    claire = await account("member", "Claire");
    paul = await account("member", "Paul");
    const office = await prisma.officeRole.create({ data: { name: "Président", nameKey: "president" } });
    for (const who of [claire, paul]) {
      const member = await prisma.member.findFirstOrThrow({ where: { userId: who.userId } });
      await prisma.memberOffice.create({ data: { memberId: member.id, officeRoleId: office.id, startsOn: new Date("2020-01-01T00:00:00Z") } });
    }
    const circuit: Circuit = {
      schemaVersion: 1,
      allowSelfProcessing: false,
      nodes: [
        { id: "start", type: "START", label: "Dépôt", approvers: [], requesterExempt: true },
        { id: "president", type: "APPROVAL", label: "Accord du président", approvers: [{ kind: "OFFICE", id: office.id }], requesterExempt: true },
        { id: "treasurer", type: "PROCESSING", label: "Remboursement", approvers: [{ kind: "USER", id: tess.userId }, { kind: "USER", id: paul.userId }], requesterExempt: false },
        { id: "end", type: "END", label: "Fin", approvers: [], requesterExempt: true },
      ],
      edges: [
        { from: "start", to: "president" },
        { from: "president", to: "treasurer" },
        { from: "treasurer", to: "end" },
      ],
    };
    const workflows = app.get(WorkflowsService);
    const draft = await workflows.createDraft("reimbursement", { source: "STARTER" }, adminId);
    await workflows.updateDraft(draft.id, { revision: draft.revision, document: circuit }, adminId);
    await workflows.activate(draft.id, adminId);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
    await rm(storageDir, { recursive: true, force: true });
  });

  it("prévient les personnes désignées quand une demande attend leur accord, sans prévenir le demandeur", async () => {
    const id = await submit(lea);
    expect(await kinds(id)).toEqual([`REIMBURSEMENT_TO_DECIDE:${claire.userId}`, `REIMBURSEMENT_TO_DECIDE:${paul.userId}`].sort());
    transport.sent.length = 0;
    expect(await notifier.dispatchDue()).toEqual({ sent: 2, failed: 0, retried: 0 });
    expect(transport.sent.map((m) => m.to).sort()).toEqual([claire.email, paul.email].sort());
    const mail = transport.sent[0]!;
    expect(mail.subject).toContain("attend votre accord");
    expect(String(mail.text)).toContain("Léa Test");
    expect(String(mail.text)).toContain("https://compta.asso.test/remboursements?onglet=a-traiter");
    // Ni montant, ni motif, ni justificatif dans l'email : tout se lit dans l'application.
    expect(String(mail.text) + String(mail.html)).not.toMatch(/42[.,]50|Peinture|secrète/);
    // Un second passage n'envoie rien de plus.
    expect(await notifier.dispatchDue()).toEqual({ sent: 0, failed: 0, retried: 0 });
    expect(transport.sent).toHaveLength(2);
    expect((await outbox(id)).every((n) => n.status === "SENT" && n.sentAt)).toBe(true);
  });

  it("prévient le demandeur de l'accord, et ceux qui doivent rembourser, mais pas celui qui vient de décider", async () => {
    const id = await submit(lea);
    await notifier.dispatchDue();
    transport.sent.length = 0;
    expect((await call("POST", `/reimbursements/${id}/decision`, claire, { type: "APPROVE" })).statusCode).toBe(200);
    const fresh = (await outbox(id)).filter((n) => n.status === "PENDING");
    expect(fresh.map((n) => `${n.kind}:${n.recipientUserId}`).sort()).toEqual(
      [`REIMBURSEMENT_APPROVED:${lea.userId}`, `REIMBURSEMENT_TO_PAY:${tess.userId}`, `REIMBURSEMENT_TO_PAY:${paul.userId}`].sort(),
    );
    await notifier.dispatchDue();
    const subjects = transport.sent.map((m) => String(m.subject));
    expect(subjects.filter((s) => s.includes("a reçu un accord"))).toHaveLength(1);
    expect(subjects.filter((s) => s.includes("est à rembourser"))).toHaveLength(2);
  });

  it("prévient le demandeur d'un renvoi pour correction, d'un refus et d'un remboursement", async () => {
    const returned = await submit(lea);
    await call("POST", `/reimbursements/${returned}/decision`, claire, { type: "RETURN", message: "Ticket illisible" });
    expect((await outbox(returned)).map((n) => n.kind)).toContain("REIMBURSEMENT_RETURNED");

    const refused = await submit(lea);
    await call("POST", `/reimbursements/${refused}/decision`, paul, { type: "REFUSE", message: "Pas prévu" });
    expect((await outbox(refused)).filter((n) => n.recipientUserId === lea.userId).map((n) => n.kind)).toEqual(["REIMBURSEMENT_REFUSED"]);

    // Après un renvoi, la reprise prévient de nouveau ceux qui doivent décider.
    const before = (await outbox(returned)).length;
    await call("POST", `/reimbursements/${returned}/submit`, lea);
    expect((await outbox(returned)).length).toBe(before + 2);
  });

  it("ne défait jamais une décision quand l'écriture de la notification échoue", async () => {
    const id = await submit(lea);
    const spy = vi.spyOn(notifier, "enqueue").mockRejectedValueOnce(new Error("panne de la file"));
    const approved = await call("POST", `/reimbursements/${id}/decision`, claire, { type: "APPROVE" });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ status: "IN_CIRCUIT", awaitingLabel: "Remboursement" });
    spy.mockRestore();
  });

  it("réessaie après un échec d'envoi avec des délais croissants, puis abandonne, sans toucher à la demande", async () => {
    await flush();
    const id = await submit(lea);
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: id, recipientUserId: paul.userId } });
    transport.failWith = Object.assign(new Error("connexion refusée"), { code: "ECONNREFUSED" });
    const start = new Date();
    expect(await notifier.dispatchDue(start)).toEqual({ sent: 0, failed: 0, retried: 1 });
    let row = (await outbox(id))[0]!;
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, lastError: "ECONNREFUSED" });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(start.getTime());
    // Trop tôt : rien n'est retenté.
    expect(await notifier.dispatchDue(start)).toEqual({ sent: 0, failed: 0, retried: 0 });
    // La demande, elle, n'est pas affectée par l'échec.
    expect((await call("GET", `/reimbursements/${id}`, lea)).json()).toMatchObject({ status: "IN_CIRCUIT" });

    let now = start.getTime();
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      now += 24 * 3_600_000;
      await notifier.dispatchDue(new Date(now));
    }
    row = (await outbox(id))[0]!;
    expect(row).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    transport.failWith = null;
    expect(await notifier.dispatchDue(new Date(now + 24 * 3_600_000))).toEqual({ sent: 0, failed: 0, retried: 0 });
  });

  it("renvoie un message qui avait échoué dès que la messagerie répond de nouveau", async () => {
    await flush();
    const id = await submit(lea);
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: id, recipientUserId: paul.userId } });
    transport.failWith = new Error("indisponible");
    const start = new Date();
    await notifier.dispatchDue(start);
    transport.failWith = null;
    transport.sent.length = 0;
    expect(await notifier.dispatchDue(new Date(start.getTime() + 6 * 60_000))).toEqual({ sent: 1, failed: 0, retried: 0 });
    expect(transport.sent).toHaveLength(1);
  });

  it("abandonne sans réessayer quand la personne n'a plus de compte actif", async () => {
    await flush();
    const id = await submit(lea);
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: id, recipientUserId: paul.userId } });
    await prisma.user.update({ where: { id: claire.userId }, data: { status: "DISABLED" } });
    transport.sent.length = 0;
    expect(await notifier.dispatchDue()).toEqual({ sent: 0, failed: 1, retried: 0 });
    expect((await outbox(id))[0]).toMatchObject({ status: "FAILED", lastError: "GONE" });
    expect(transport.sent).toHaveLength(0);
    await prisma.user.update({ where: { id: claire.userId }, data: { status: "ACTIVE" } });
  });

  it("ne stocke aucun texte libre dans la file", async () => {
    const columns = (await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'NotificationOutbox'`).map((c) => c.column_name).sort();
    expect(columns).toEqual(["attempts", "createdAt", "id", "kind", "lastError", "nextAttemptAt", "recipientUserId", "sentAt", "status", "subjectId"]);
  });
});
