import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
import type { Circuit } from "../../src/workflows/engine/circuit.js";
import { WorkflowsService } from "../../src/workflows/workflows.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}
type Method = "GET" | "POST" | "PATCH" | "DELETE";

const PDF = (extra = "") => Buffer.from(`%PDF-1.7\n% test ${extra}\n${"x".repeat(200)}`);

function multipart(fields: Record<string, string>, files: { name: string; content: Buffer }[]) {
  const boundary = `----cotiasso${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.content, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Demandes de remboursement (ADR 0035, base vierge)", () => {
  let db: TempDatabase;
  let storageDir: string;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let workflows: WorkflowsService;
  let adminId: string;
  let lea: Session; // simple membre
  let claire: Session; // présidente
  let paul: Session; // président adjoint (même fonction)
  let tess: Session; // trésorière
  let remi: Session; // autre membre
  let outsider: Session; // lecteur, aucun droit sur les remboursements
  let boardMember: Session;
  let noMember: Session; // rôle « Membre » mais pas de fiche membre
  let bankId: string;
  let categoryId: string;
  let presidentOfficeId: string;

  const call = (method: Method, url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });
  const upload = (url: string, session: Session, fields: Record<string, string>, files: { name: string; content: Buffer }[]) => {
    const { payload, contentType } = multipart(fields, files);
    return app.inject({ method: "POST", url, payload, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`, headers: { "content-type": contentType, cookie: session.cookie, "x-csrf-token": session.csrf } });
  };
  const login = async (email: string): Promise<Session> => {
    const response = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
    expect(response.statusCode, response.body).toBe(200);
    return { cookie: String(response.headers["set-cookie"]).split(";")[0]!, csrf: response.json().csrfToken, userId: response.json().user.id };
  };
  const account = async (roleKey: string, name: string, withMember = true): Promise<Session> => {
    const email = `r-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: name, password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    if (withMember) await prisma.member.create({ data: { firstName: name, lastName: "Test", userId: user.id } });
    return login(email);
  };
  const sqlError = async (statement: string) => {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      return String((error as Error).message) + String((error as { cause?: unknown }).cause ?? "");
    }
    return null;
  };

  const circuit = (): Circuit => ({
    schemaVersion: 1,
    allowSelfProcessing: false,
    nodes: [
      { id: "start", type: "START", label: "Dépôt", approvers: [], requesterExempt: true },
      { id: "president", type: "APPROVAL", label: "Accord du président", approvers: [{ kind: "OFFICE", id: presidentOfficeId }], requesterExempt: true },
      { id: "treasurer", type: "PROCESSING", label: "Remboursement", approvers: [{ kind: "USER", id: tess.userId }, { kind: "USER", id: paul.userId }], requesterExempt: false },
      { id: "end", type: "END", label: "Fin", approvers: [], requesterExempt: true },
    ],
    edges: [
      { from: "start", to: "president" },
      { from: "president", to: "treasurer" },
      { from: "treasurer", to: "end" },
    ],
  });

  /** Brouillon rempli, justificatif déposé, déposée dans le circuit. */
  const submitted = async (who: Session, overrides: Record<string, unknown> = {}) => {
    const created = await call("POST", "/reimbursements", who, { amount: "42.50", expenseDate: "2026-03-10", reason: "Achat de peinture pour l'atelier", ...overrides });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const receipt = await upload(`/reimbursements/${id}/documents`, who, { title: "Ticket de caisse" }, [{ name: "ticket.pdf", content: PDF(id) }]);
    expect(receipt.statusCode, receipt.body).toBe(201);
    const sent = await call("POST", `/reimbursements/${id}/submit`, who);
    expect(sent.statusCode, sent.body).toBe(200);
    return { id, view: sent.json() };
  };
  const view = async (id: string, who: Session) => (await call("GET", `/reimbursements/${id}`, who)).json();

  beforeAll(async () => {
    db = await createTempDatabase();
    storageDir = await mkdtemp(join(tmpdir(), "cotiasso-e2e-reimb-"));
    const env: AppEnv = { ...readEnv(), databaseUrl: db.url, cookieSecure: true, documentsDir: storageDir };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENV).useValue(env).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app, env);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    users = app.get(UsersService);
    workflows = app.get(WorkflowsService);
    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@asso.test" } })).id;

    tess = await account("treasurer", "Tess");
    lea = await account("member", "Léa");
    remi = await account("member", "Rémi");
    claire = await account("member", "Claire");
    paul = await account("member", "Paul");
    outsider = await account("reader", "Olivier");
    boardMember = await account("board-member", "Bruno");
    noMember = await account("member", "Nina", false);

    const office = await prisma.officeRole.create({ data: { name: "Président", nameKey: "president" } });
    presidentOfficeId = office.id;
    for (const who of [claire, paul]) {
      const member = await prisma.member.findFirstOrThrow({ where: { userId: who.userId } });
      await prisma.memberOffice.create({ data: { memberId: member.id, officeRoleId: office.id, startsOn: new Date("2020-01-01T00:00:00Z") } });
    }

    // Comptabilité minimale : exercice, plan de départ, compte bancaire, catégorie de dépense.
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: true } } });
    expect((await call("POST", "/starter-template", tess)).statusCode).toBe(200);
    expect((await call("POST", "/fiscal-years", tess, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).statusCode).toBe(201);
    const accounts = (await call("GET", "/accounts", tess)).json() as { id: string; number: string }[];
    const bank = await call("POST", "/financial-accounts", tess, { name: "Banque", type: "BANK", accountId: accounts.find((a) => a.number === "512")!.id, openedOn: "2026-01-01", openingBalance: "1000.00" });
    expect(bank.statusCode, bank.body).toBe(201);
    bankId = bank.json().id;
    const categories = (await call("GET", "/operation-categories", tess)).json() as { id: string; label: string; direction: string }[];
    categoryId = categories.find((c) => c.direction === "OUT" && c.label === "Assurance")!.id;
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
    await rm(storageDir, { recursive: true, force: true });
  });

  describe("ouverture et droits", () => {
    it("reste fermé tant qu'aucun circuit n'est en vigueur, et dit pourquoi", async () => {
      const status = (await call("GET", "/reimbursements/status", lea)).json();
      expect(status).toMatchObject({ enabled: false, ready: false, canRequest: false });
      expect(status.reason).toContain("circuit de validation");
      const refused = await call("POST", "/reimbursements", lea, { amount: "10.00", expenseDate: "2026-03-10", reason: "Test" });
      expect(refused.statusCode).toBe(409);
      // Le circuit est mis en vigueur pour la suite.
      const draft = await workflows.createDraft("reimbursement", { source: "STARTER" }, adminId);
      await workflows.updateDraft(draft.id, { revision: draft.revision, document: circuit() }, adminId);
      await workflows.activate(draft.id, adminId);
      expect((await call("GET", "/reimbursements/status", lea)).json()).toMatchObject({ enabled: true, ready: true, canRequest: true, reason: null });
    });

    it("n'est plus prêt (donc masqué du menu) quand plus personne ne peut décider d'une étape, et le redevient ensuite", async () => {
      await prisma.memberOffice.updateMany({ where: { officeRoleId: presidentOfficeId }, data: { endsOn: new Date("2021-01-01T00:00:00Z") } });
      const blocked = (await call("GET", "/reimbursements/status", lea)).json();
      expect(blocked).toMatchObject({ enabled: true, ready: false, canRequest: false });
      expect(blocked.reason).toContain("Accord du président");
      expect(blocked.reason).toContain("Paramètres › Circuits de validation");

      await prisma.memberOffice.updateMany({ where: { officeRoleId: presidentOfficeId }, data: { endsOn: null } });
      expect((await call("GET", "/reimbursements/status", lea)).json()).toMatchObject({ enabled: true, ready: true, canRequest: true });
    });

    it("déclare ses accès : anonyme refusé, lecteur sans droit refusé, compte sans fiche membre informé", async () => {
      expect((await call("GET", "/reimbursements/mine")).statusCode).toBe(401);
      expect((await call("GET", "/reimbursements/mine", outsider)).statusCode).toBe(403);
      expect((await call("POST", "/reimbursements", outsider, { amount: "10.00", expenseDate: "2026-03-10", reason: "Test" })).statusCode).toBe(403);
      expect((await call("GET", "/reimbursements", lea)).statusCode).toBe(403);
      expect((await call("GET", "/reimbursements", tess)).statusCode).toBe(200);
      const lonely = await call("POST", "/reimbursements", noMember, { amount: "10.00", expenseDate: "2026-03-10", reason: "Test" });
      expect(lonely.statusCode).toBe(409);
      expect(lonely.json().message).toContain("fiche de membre");
    });
  });

  describe("brouillon et justificatif", () => {
    it("crée un brouillon valide, le modifie avec contrôle de version, et refuse une saisie incorrecte", async () => {
      expect((await call("POST", "/reimbursements", lea, { amount: "0", expenseDate: "2026-03-10", reason: "Test" })).statusCode).toBe(400);
      expect((await call("POST", "/reimbursements", lea, { amount: "10.00", expenseDate: "2026-02-31", reason: "Test valide" })).statusCode).toBe(400);
      const created = await call("POST", "/reimbursements", lea, { amount: "12.30", expenseDate: "2026-03-10", reason: "Timbres" });
      expect(created.statusCode, created.body).toBe(201);
      const draft = created.json();
      expect(draft).toMatchObject({ status: "DRAFT", amount: "12.30", requesterName: "Léa Test", can: { edit: true, submit: true, delete: true, decide: false } });
      const edited = await call("PATCH", `/reimbursements/${draft.id}`, lea, { version: draft.version, amount: "13.00" });
      expect(edited.json()).toMatchObject({ amount: "13.00", version: draft.version + 1 });
      expect((await call("PATCH", `/reimbursements/${draft.id}`, lea, { version: draft.version, amount: "14.00" })).statusCode).toBe(409);
      // Personne d'autre ne voit ni ne modifie un brouillon.
      expect((await call("GET", `/reimbursements/${draft.id}`, remi)).statusCode).toBe(404);
      expect((await call("PATCH", `/reimbursements/${draft.id}`, remi, { version: edited.json().version, amount: "1.00" })).statusCode).toBe(404);
      expect((await call("GET", `/reimbursements/${draft.id}`, tess)).statusCode).toBe(404);
      expect((await call("DELETE", `/reimbursements/${draft.id}`, lea)).statusCode).toBe(204);
      expect((await call("GET", `/reimbursements/${draft.id}`, lea)).statusCode).toBe(404);
    });

    it("exige un justificatif avant de déposer, et le range en document confidentiel relié à la demande", async () => {
      const created = (await call("POST", "/reimbursements", lea, { amount: "20.00", expenseDate: "2026-03-10", reason: "Fournitures de bureau" })).json();
      const early = await call("POST", `/reimbursements/${created.id}/submit`, lea);
      expect(early.statusCode).toBe(409);
      expect(early.json().message).toContain("justificatif");

      const bad = await upload(`/reimbursements/${created.id}/documents`, lea, {}, [{ name: "virus.exe", content: Buffer.from("MZ....") }]);
      expect(bad.statusCode).toBe(415);
      expect(await prisma.documentLink.count({ where: { objectType: "reimbursement-request", objectId: created.id } })).toBe(0);
      // Un fichier refusé ne laisse rien sur le disque.
      const before = (await readdir(storageDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;
      await upload(`/reimbursements/${created.id}/documents`, lea, {}, [{ name: "virus.exe", content: Buffer.from("MZ....") }]);
      expect((await readdir(storageDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length).toBe(before);

      const ok = await upload(`/reimbursements/${created.id}/documents`, lea, { title: "Ticket" }, [{ name: "ticket.pdf", content: PDF("a") }]);
      expect(ok.statusCode, ok.body).toBe(201);
      expect(ok.json()).toMatchObject({ title: "Ticket", category: "facture", restricted: true });
      expect((await call("GET", `/reimbursements/${created.id}`, lea)).json().documentCount).toBe(1);
      expect((await call("POST", `/reimbursements/${created.id}/submit`, lea)).statusCode).toBe(200);
      // Une fois déposée, la demande ne reçoit plus de justificatif de son demandeur.
      const late = await upload(`/reimbursements/${created.id}/documents`, lea, {}, [{ name: "autre.pdf", content: PDF("b") }]);
      expect(late.statusCode).toBe(409);
    });
  });

  describe("circuit et visibilité", () => {
    it("attend l'accord du président, que seules les personnes désignées voient et décident", async () => {
      const { id, view: sent } = await submitted(lea);
      expect(sent).toMatchObject({ status: "IN_CIRCUIT", awaitingLabel: "Accord du président", can: { edit: false, cancel: true, decide: false } });

      // Visibles : la demandeuse, les deux présidents (désignés), la trésorière (droit de tout voir). Pas les autres.
      expect((await call("GET", `/reimbursements/${id}`, claire)).statusCode).toBe(200);
      expect((await call("GET", `/reimbursements/${id}`, paul)).statusCode).toBe(200);
      expect((await call("GET", `/reimbursements/${id}`, tess)).statusCode).toBe(200);
      expect((await call("GET", `/reimbursements/${id}`, remi)).statusCode).toBe(404);
      expect((await call("GET", `/reimbursements/${id}`, outsider)).statusCode).toBe(404);
      expect((await call("GET", `/reimbursements/${id}`, boardMember)).statusCode).toBe(404);

      // Le justificatif suit la même règle et son téléchargement est tracé.
      const docs = (await call("GET", `/reimbursements/${id}/documents`, claire)).json();
      expect(docs).toHaveLength(1);
      const download = await call("GET", `/reimbursements/${id}/documents/${docs[0].id}/download`, claire);
      expect(download.statusCode).toBe(200);
      expect(download.headers["content-disposition"]).toContain("attachment");
      expect(download.headers["x-content-type-options"]).toBe("nosniff");
      expect(await prisma.auditEvent.count({ where: { action: "document.downloaded", objectId: docs[0].id } })).toBe(1);
      expect((await call("GET", `/reimbursements/${id}/documents/${docs[0].id}/download`, remi)).statusCode).toBe(404);
      expect((await call("GET", `/reimbursements/${id}/documents`, outsider)).statusCode).toBe(404);

      // Ni la demandeuse, ni la trésorière, ni un autre membre ne peuvent donner l'accord.
      for (const who of [lea, tess]) expect((await call("POST", `/reimbursements/${id}/decision`, who, { type: "APPROVE" })).statusCode).toBe(409);
      expect((await call("POST", `/reimbursements/${id}/decision`, remi, { type: "APPROVE" })).statusCode).toBe(404);
      expect((await view(id, lea)).status).toBe("IN_CIRCUIT");
    });

    it("garde les justificatifs hors de la page Documents pour qui n'a pas le droit des documents confidentiels", async () => {
      const { id } = await submitted(lea);
      const asBoard = (await call("GET", `/documents?objectType=reimbursement-request&objectId=${id}`, boardMember)).json();
      expect(asBoard.items).toHaveLength(0);
      const asTreasurer = (await call("GET", `/documents?objectType=reimbursement-request&objectId=${id}`, tess)).json();
      expect(asTreasurer.items).toHaveLength(1);
      expect(asTreasurer.items[0]).toMatchObject({ restricted: true });
      // Un responsable limité à un projet ne le voit pas non plus.
      const project = await prisma.project.findFirstOrThrow({ where: { permanent: true } });
      const manager = await prisma.role.findUniqueOrThrow({ where: { key: "project-manager" } });
      const scoped = await account("reader", "Sandra");
      await prisma.roleAssignment.create({ data: { userId: scoped.userId, roleId: manager.id, projectId: project.id } });
      const asScoped = await call("GET", `/documents?objectType=reimbursement-request&objectId=${id}`, scoped);
      expect(asScoped.statusCode).toBe(200);
      expect(asScoped.json().items).toHaveLength(0);
    });

    it("la présidente qui demande saute son étape, la trésorière qui demande passe par le président", async () => {
      const own = await submitted(claire);
      expect(own.view.instance.steps.map((s: { state: string }) => s.state)).toEqual(["AUTO", "CURRENT"]);
      expect(own.view.awaitingLabel).toBe("Remboursement");
      const fromTreasurer = await submitted(tess);
      expect(fromTreasurer.view.awaitingLabel).toBe("Accord du président");
      // La présidente ne traite pas non plus sa propre demande : elle n'est pas désignée au traitement, et Paul l'est.
      expect((await call("POST", `/reimbursements/${own.id}/process`, claire, { mode: "CREATE", financialAccountId: bankId, date: "2026-03-12", categoryId })).statusCode).toBe(403);
    });

    it("refuse, renvoie et annule avec un message, et fige la demande une fois terminée", async () => {
      const refused = await submitted(lea);
      const noMessage = await call("POST", `/reimbursements/${refused.id}/decision`, claire, { type: "REFUSE" });
      expect(noMessage.statusCode).toBe(409);
      expect(noMessage.json().message).toContain("quelques mots");
      const done = await call("POST", `/reimbursements/${refused.id}/decision`, claire, { type: "REFUSE", message: "Pas prévu au budget" });
      expect(done.json()).toMatchObject({ status: "REFUSED", lastMessage: "Pas prévu au budget" });
      expect((await call("PATCH", `/reimbursements/${refused.id}`, lea, { version: done.json().version, amount: "1.00" })).statusCode).toBe(409);
      expect((await call("POST", `/reimbursements/${refused.id}/cancel`, lea, { message: "Oups" })).statusCode).toBe(409);
      expect(await sqlError(`UPDATE "ReimbursementRequest" SET "status" = 'IN_CIRCUIT' WHERE "id" = '${refused.id}'`)).toContain("terminée");

      const cancelled = await submitted(lea);
      expect((await call("POST", `/reimbursements/${cancelled.id}/cancel`, claire, { message: "Je m'en occupe" })).statusCode).toBe(404);
      const result = await call("POST", `/reimbursements/${cancelled.id}/cancel`, lea, { message: "Finalement inutile" });
      expect(result.json()).toMatchObject({ status: "CANCELLED", can: { cancel: false } });
    });

    it("renvoie pour correction : la reprise suit l'étape, ou repart du début si le montant change", async () => {
      const kept = await submitted(lea);
      const returned = await call("POST", `/reimbursements/${kept.id}/decision`, claire, { type: "RETURN", message: "Précisez à quoi sert cet achat" });
      expect(returned.json()).toMatchObject({ status: "RETURNED", lastMessage: "Précisez à quoi sert cet achat" });
      expect((await view(kept.id, lea)).can).toMatchObject({ edit: true, submit: true });
      // On ne décide plus tant que la demande n'est pas corrigée.
      expect((await call("POST", `/reimbursements/${kept.id}/decision`, claire, { type: "APPROVE" })).statusCode).toBe(409);
      const patched = await call("PATCH", `/reimbursements/${kept.id}`, lea, { version: returned.json().version, reason: "Peinture pour repeindre l'atelier" });
      expect(patched.statusCode, patched.body).toBe(200);
      const resumed = await call("POST", `/reimbursements/${kept.id}/submit`, lea);
      expect(resumed.json()).toMatchObject({ status: "IN_CIRCUIT", awaitingLabel: "Accord du président" });
      expect(resumed.json().instance.round).toBe(2);

      // Le montant change après un accord : le circuit repart de la première étape.
      const changed = await submitted(lea);
      await call("POST", `/reimbursements/${changed.id}/decision`, claire, { type: "APPROVE" });
      const back = await call("POST", `/reimbursements/${changed.id}/decision`, tess, { type: "RETURN", message: "Le montant est faux" });
      expect(back.json().status).toBe("RETURNED");
      await call("PATCH", `/reimbursements/${changed.id}`, lea, { version: back.json().version, amount: "40.00" });
      const restarted = await call("POST", `/reimbursements/${changed.id}/submit`, lea);
      expect(restarted.json()).toMatchObject({ status: "IN_CIRCUIT", awaitingLabel: "Accord du président", amount: "40.00" });
    });
  });

  describe("traitement : rembourser et enregistrer", () => {
    it("rembourse en créant l'opération, enregistre l'écriture, et la demande est soldée", async () => {
      const { id } = await submitted(lea, { amount: "42.50" });
      await call("POST", `/reimbursements/${id}/decision`, claire, { type: "APPROVE" });
      expect((await call("GET", "/reimbursements/to-decide", tess)).json().map((r: { id: string }) => r.id)).toContain(id);
      expect((await call("GET", "/reimbursements/to-decide", claire)).json().map((r: { id: string }) => r.id)).not.toContain(id);

      const paid = await call("POST", `/reimbursements/${id}/process`, tess, { mode: "CREATE", financialAccountId: bankId, date: "2026-03-12", categoryId });
      expect(paid.statusCode, paid.body).toBe(200);
      expect(paid.json()).toMatchObject({ status: "PAID", paid: { transactionId: expect.any(String), entryId: expect.any(String) }, can: { process: false } });
      const payment = await prisma.reimbursementPayment.findUniqueOrThrow({ where: { requestId: id } });
      const movement = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.transactionId } });
      expect(movement.amount.toFixed(2)).toBe("-42.50");
      expect(movement.reference).toMatch(/^Demande n° \d+$/);
      expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: payment.entryId } })).status).toBe("POSTED");
      expect((await view(id, lea)).instance.decisions.map((d: { outcome: string }) => d.outcome)).toEqual(["APPROVED", "PROCESSED"]);
      expect(await prisma.auditEvent.count({ where: { action: "reimbursement.paid", objectId: id } })).toBe(1);
      // Sans messagerie configurée, aucune notification n'est mise en file.
      expect(await prisma.notificationOutbox.count()).toBe(0);
      // Déjà remboursée : une seconde fois est refusée, rien n'est créé.
      expect((await call("POST", `/reimbursements/${id}/process`, tess, { mode: "CREATE", financialAccountId: bankId, date: "2026-03-12", categoryId })).statusCode).toBe(409);
      expect(await prisma.reimbursementPayment.count({ where: { requestId: id } })).toBe(1);
    });

    it("défait tout si l'enregistrement est refusé : la demande reste à rembourser", async () => {
      const { id } = await submitted(lea, { amount: "15.00" });
      await call("POST", `/reimbursements/${id}/decision`, claire, { type: "APPROVE" });
      const transactionsBefore = await prisma.transaction.count();
      // Aucun exercice ne couvre 2031 : l'opération est refusée, et la décision de traiter ne doit pas rester.
      const refused = await call("POST", `/reimbursements/${id}/process`, tess, { mode: "CREATE", financialAccountId: bankId, date: "2031-01-10", categoryId });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("exercice");
      expect(await prisma.transaction.count()).toBe(transactionsBefore);
      const after = await view(id, tess);
      expect(after).toMatchObject({ status: "IN_CIRCUIT", awaitingLabel: "Remboursement", paid: null });
      expect(after.instance.decisions.map((d: { outcome: string }) => d.outcome)).toEqual(["APPROVED"]);
    });

    it("n'autorise le remboursement qu'à une personne désignée, qui a les droits de saisie, et pas pour sa propre demande", async () => {
      const { id } = await submitted(lea, { amount: "9.90" });
      await call("POST", `/reimbursements/${id}/decision`, claire, { type: "APPROVE" });
      const body = { mode: "CREATE", financialAccountId: bankId, date: "2026-03-12", categoryId };
      expect((await call("POST", `/reimbursements/${id}/process`, lea, body)).statusCode).toBe(403);
      expect((await call("POST", `/reimbursements/${id}/process`, boardMember, body)).statusCode).toBe(403);
      // Paul est désigné mais n'a pas les droits de saisie comptable : refusé par la route.
      expect((await call("POST", `/reimbursements/${id}/process`, paul, body)).statusCode).toBe(403);
      // Tess est désignée mais ne peut pas rembourser sa propre demande.
      const own = await submitted(tess, { amount: "5.00" });
      await call("POST", `/reimbursements/${own.id}/decision`, claire, { type: "APPROVE" });
      const self = await call("POST", `/reimbursements/${own.id}/process`, tess, body);
      expect(self.statusCode).toBe(409);
      expect(self.json().message).toContain("pas à vous");
      expect((await view(id, lea)).status).toBe("IN_CIRCUIT");
    });

    it("associe un mouvement bancaire existant du même montant, et refuse un montant différent", async () => {
      const { id } = await submitted(lea, { amount: "31.00" });
      await call("POST", `/reimbursements/${id}/decision`, claire, { type: "APPROVE" });
      const add = async (amount: string) =>
        (await call("POST", `/financial-accounts/${bankId}/transactions`, tess, { operationDate: "2026-03-15", amount, label: `Virement ${amount}` })).json().id as string;
      const wrong = await add("-30.00");
      const right = await add("-31.00");
      const candidates = (await call("GET", `/reimbursements/${id}/transaction-candidates`, tess)).json();
      expect(candidates.map((c: { id: string }) => c.id)).toEqual([right]);
      const mismatch = await call("POST", `/reimbursements/${id}/process`, tess, { mode: "EXISTING", transactionId: wrong, categoryId });
      expect(mismatch.statusCode).toBe(409);
      expect(mismatch.json().message).toContain("même montant");
      const paid = await call("POST", `/reimbursements/${id}/process`, tess, { mode: "EXISTING", transactionId: right, categoryId });
      expect(paid.statusCode, paid.body).toBe(200);
      expect(paid.json()).toMatchObject({ status: "PAID" });
      expect((await prisma.reimbursementPayment.findUniqueOrThrow({ where: { requestId: id } })).transactionId).toBe(right);
      // Ce mouvement ne rembourse pas une seconde demande.
      const next = await submitted(lea, { amount: "31.00" });
      await call("POST", `/reimbursements/${next.id}/decision`, claire, { type: "APPROVE" });
      expect((await call("GET", `/reimbursements/${next.id}/transaction-candidates`, tess)).json().map((c: { id: string }) => c.id)).not.toContain(right);
      expect((await call("POST", `/reimbursements/${next.id}/process`, tess, { mode: "EXISTING", transactionId: right, categoryId })).statusCode).toBe(409);
    });
  });

  describe("vue d'ensemble et garanties en base", () => {
    it("fait apparaître dans « À faire » ce que chacun doit décider ou corriger, même sans autre droit", async () => {
      const waiting = await submitted(lea);
      const codes = async (who: Session) => ((await call("GET", "/overview", who)).json().todo as { code: string; count?: number }[]).map((t) => t.code);
      expect(await codes(claire)).toContain("REIMBURSEMENTS_TO_APPROVE");
      expect(await codes(lea)).not.toContain("REIMBURSEMENTS_TO_APPROVE");
      await call("POST", `/reimbursements/${waiting.id}/decision`, claire, { type: "RETURN", message: "Merci d'ajouter la date" });
      expect(await codes(lea)).toContain("REIMBURSEMENTS_TO_FIX");
      const other = await submitted(lea);
      await call("POST", `/reimbursements/${other.id}/decision`, claire, { type: "APPROVE" });
      expect(await codes(tess)).toContain("REIMBURSEMENTS_TO_PAY");
    });

    it("compte dans les pastilles du menu les demandes à décider, à rembourser ou à corriger, comme « À faire »", async () => {
      const badge = async (who: Session) => (await call("GET", "/overview/badges", who)).json() as { reimbursements: number; accounts: number; members: number };
      const before = { claire: (await badge(claire)).reimbursements, lea: (await badge(lea)).reimbursements, tess: (await badge(tess)).reimbursements };
      const waiting = await submitted(lea);
      expect((await badge(claire)).reimbursements).toBe(before.claire + 1);
      expect((await badge(lea)).reimbursements).toBe(before.lea);
      await call("POST", `/reimbursements/${waiting.id}/decision`, claire, { type: "RETURN", message: "Merci d'ajouter la date" });
      expect((await badge(claire)).reimbursements).toBe(before.claire);
      expect((await badge(lea)).reimbursements).toBe(before.lea + 1);
      const other = await submitted(lea);
      await call("POST", `/reimbursements/${other.id}/decision`, claire, { type: "APPROVE" });
      expect((await badge(tess)).reimbursements).toBe(before.tess + 1);
    });

    it("protège la demande en SQL : figée une fois déposée, jamais supprimée, remboursée seulement avec son paiement", async () => {
      const { id } = await submitted(lea, { amount: "7.00" });
      expect(await sqlError(`UPDATE "ReimbursementRequest" SET "amount" = 700 WHERE "id" = '${id}'`)).toContain("ne se modifie pas");
      expect(await sqlError(`DELETE FROM "ReimbursementRequest" WHERE "id" = '${id}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`TRUNCATE "ReimbursementRequest" CASCADE`)).not.toBeNull();
      expect(await sqlError(`UPDATE "ReimbursementRequest" SET "requesterUserId" = '${claire.userId}' WHERE "id" = '${id}'`)).toContain("ne changent pas");
      // « Remboursée » sans paiement : refusé à la fin de la transaction.
      await expect(prisma.$transaction((tx) => tx.$executeRawUnsafe(`UPDATE "ReimbursementRequest" SET "status" = 'PAID' WHERE "id" = '${id}'`))).rejects.toThrow(/n.est remboursée qu.avec/);
      expect((await view(id, lea)).status).toBe("IN_CIRCUIT");
      const payment = await prisma.reimbursementPayment.findFirstOrThrow();
      expect(await sqlError(`DELETE FROM "ReimbursementPayment" WHERE "id" = '${payment.id}'`)).toContain("ne se modifie ni ne se supprime");
      expect(await sqlError(`UPDATE "ReimbursementPayment" SET "entryId" = '${randomUUID()}' WHERE "id" = '${payment.id}'`)).toContain("ne se modifie ni ne se supprime");
    });

    it("supprime un brouillon abandonné en archivant ses justificatifs", async () => {
      const created = (await call("POST", "/reimbursements", lea, { amount: "3.00", expenseDate: "2026-03-10", reason: "Brouillon abandonné" })).json();
      const receipt = (await upload(`/reimbursements/${created.id}/documents`, lea, {}, [{ name: "t.pdf", content: PDF("d") }])).json();
      expect((await call("DELETE", `/reimbursements/${created.id}`, lea)).statusCode).toBe(204);
      expect((await prisma.document.findUniqueOrThrow({ where: { id: receipt.id } })).archivedAt).not.toBeNull();
    });
  });
});
