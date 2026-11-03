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
import type { Circuit, Designation } from "../../src/workflows/engine/circuit.js";
import { WorkflowSubjectRegistry, type SubjectEvent } from "../../src/workflows/subject-handlers.js";
import { WorkflowEngineService } from "../../src/workflows/workflow-engine.service.js";
import { WorkflowsService } from "../../src/workflows/workflows.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
}
type Method = "GET" | "POST" | "PUT" | "DELETE";

describe("Circuits de validation (ADR 0035, base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let workflows: WorkflowsService;
  let engine: WorkflowEngineService;
  let treasurer: Session;
  let reader: Session;
  let adminId: string;
  let presidentOfficeId: string;
  const events: SubjectEvent[] = [];

  const person: Record<"lea" | "claire" | "paul" | "tess", { id: string; memberId: string }> = {} as never;

  const call = (method: Method, url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const login = async (email: string): Promise<Session> => {
    const response = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
    return { cookie: String(response.headers["set-cookie"]).split(";")[0]!, csrf: response.json().csrfToken };
  };
  const userWith = async (roleKey: string): Promise<Session & { id: string }> => {
    const email = `w-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "T", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    return { ...(await login(email)), id: user.id };
  };
  /** Compte lié à une fiche membre (un compte sans rôle). */
  const memberUser = async (firstName: string): Promise<{ id: string; memberId: string }> => {
    const user = await users.createUser({ email: `w-${randomUUID()}@test.invalid`, displayName: firstName, password: PASSWORD });
    const member = await prisma.member.create({ data: { firstName, lastName: "Test", userId: user.id } });
    return { id: user.id, memberId: member.id };
  };
  const sqlError = async (statement: string) => {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      return String((error as Error).message) + String((error as { cause?: unknown }).cause ?? "");
    }
    return null;
  };

  /** membre → président (fonction « Président ») → trésorier (personne nommée), avec des options réglables. */
  const circuitDoc = (options: { president?: Designation[]; processors?: Designation[]; exempt?: boolean; allowSelfProcessing?: boolean; withPresident?: boolean } = {}): Circuit => {
    const withPresident = options.withPresident ?? true;
    const nodes: Circuit["nodes"] = [
      { id: "start", type: "START", label: "Dépôt", approvers: [], requesterExempt: true },
      ...(withPresident
        ? [{ id: "president", type: "APPROVAL" as const, label: "Accord du président", approvers: options.president ?? [{ kind: "OFFICE" as const, id: presidentOfficeId }], requesterExempt: options.exempt ?? true }]
        : []),
      { id: "treasurer", type: "PROCESSING", label: "Remboursement", approvers: options.processors ?? [{ kind: "USER", id: person.tess.id }], requesterExempt: false },
      { id: "end", type: "END", label: "Fin", approvers: [], requesterExempt: true },
    ];
    const ids = nodes.map((n) => n.id);
    return { schemaVersion: 1, allowSelfProcessing: options.allowSelfProcessing ?? false, nodes, edges: ids.slice(1).map((to, i) => ({ from: ids[i]!, to })) };
  };

  /** Met en vigueur un circuit complet (brouillon, contenu, activation). */
  const activate = async (doc: Circuit) => {
    const existing = await prisma.workflowDefinitionVersion.findFirst({ where: { status: "DRAFT", definition: { subjectType: "reimbursement" } } });
    if (existing) await workflows.deleteDraft(existing.id, adminId);
    const draft = await workflows.createDraft("reimbursement", { source: "STARTER" }, adminId);
    const updated = await workflows.updateDraft(draft.id, { revision: draft.revision, document: doc }, adminId);
    return workflows.activate(updated.id, adminId);
  };

  const start = (requester: string, subjectId = randomUUID()) => prisma.$transaction((tx) => engine.start({ subjectType: "reimbursement", subjectId, requesterUserId: requester }, tx));

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
    workflows = app.get(WorkflowsService);
    engine = app.get(WorkflowEngineService);
    app.get(WorkflowSubjectRegistry).register({ subjectType: "reimbursement", onEvent: async (event) => void events.push(event) });
    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@asso.test" } })).id;
    treasurer = await userWith("treasurer");
    reader = await userWith("reader");

    // Léa est simple membre ; Claire et Paul occupent la fonction « Président » ; Tess est désignée au traitement.
    const office = await prisma.officeRole.create({ data: { name: "Président", nameKey: "president" } });
    presidentOfficeId = office.id;
    person.lea = await memberUser("Léa");
    person.claire = await memberUser("Claire");
    person.paul = await memberUser("Paul");
    person.tess = await memberUser("Tess");
    for (const holder of [person.claire, person.paul]) {
      await prisma.memberOffice.create({ data: { memberId: holder.memberId, officeRoleId: office.id, startsOn: new Date("2020-01-01T00:00:00Z") } });
    }
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("définition des circuits", () => {
    it("réserve la consultation à workflows:view et le réglage à workflows:admin", async () => {
      expect((await call("GET", "/workflows")).statusCode).toBe(401);
      expect((await call("GET", "/workflows", reader)).statusCode).toBe(403);
      expect((await call("GET", "/workflows", treasurer)).statusCode).toBe(200);
      expect((await call("POST", "/workflows/reimbursement/draft", reader, {})).statusCode).toBe(403);
      expect((await call("GET", "/workflows/inconnu", treasurer)).statusCode).toBe(404);
    });

    it("prépare un brouillon depuis le modèle de départ, préremplit président et trésorier, et refuse un second brouillon", async () => {
      const created = await call("POST", "/workflows/reimbursement/draft", treasurer, { source: "STARTER" });
      expect(created.statusCode, created.body).toBe(201);
      const draft = created.json();
      expect(draft).toMatchObject({ status: "DRAFT", subjectType: "reimbursement", label: "Demande de remboursement" });
      const nodes = draft.document.nodes as { id: string; approvers: Designation[] }[];
      expect(nodes.find((n) => n.id === "president")!.approvers).toEqual([{ kind: "OFFICE", id: presidentOfficeId }]);
      expect(nodes.find((n) => n.id === "treasurer")!.approvers[0]).toMatchObject({ kind: "ROLE" });
      expect(draft.issues).toEqual([]);
      const twice = await call("POST", "/workflows/reimbursement/draft", treasurer, {});
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toContain("brouillon");
      expect((await call("DELETE", `/workflow-versions/${draft.id}`, treasurer)).statusCode).toBe(204);
    });

    it("refuse un type d'étape réservé, un brouillon périmé et une activation incomplète, en disant quoi faire", async () => {
      const draft = (await call("POST", "/workflows/reimbursement/draft", treasurer, { source: "STARTER" })).json();
      const withCondition = { ...draft.document, nodes: [...draft.document.nodes, { id: "if", type: "CONDITION", label: "Seuil", approvers: [], requesterExempt: true }] };
      const reserved = await call("PUT", `/workflow-versions/${draft.id}`, treasurer, { revision: draft.revision, document: withCondition });
      expect(reserved.statusCode).toBe(400);
      expect(JSON.stringify(reserved.json())).toContain("pas encore prises en charge");

      const empty = { ...draft.document, nodes: draft.document.nodes.map((n: { id: string }) => (n.id === "president" ? { ...n, approvers: [] } : n)) };
      const saved = await call("PUT", `/workflow-versions/${draft.id}`, treasurer, { revision: draft.revision, document: empty });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().issues).toMatchObject([{ nodeId: "president", code: "NO_APPROVERS" }]);
      const stale = await call("PUT", `/workflow-versions/${draft.id}`, treasurer, { revision: draft.revision, document: empty });
      expect(stale.statusCode).toBe(409);

      const incomplete = await call("POST", `/workflow-versions/${draft.id}/activate`, treasurer);
      expect(incomplete.statusCode).toBe(400);
      expect(JSON.stringify(incomplete.json())).toContain("Désignez au moins une personne");
      expect((await call("DELETE", `/workflow-versions/${draft.id}`, treasurer)).statusCode).toBe(204);
    });

    it("refuse d'activer un circuit qui désigne une fonction ou une personne inexistante", async () => {
      const draft = await workflows.createDraft("reimbursement", { source: "STARTER" }, adminId);
      const doc = circuitDoc({ president: [{ kind: "OFFICE", id: randomUUID() }] });
      const saved = await workflows.updateDraft(draft.id, { revision: draft.revision, document: doc }, adminId);
      expect(saved.issues).toMatchObject([{ code: "UNKNOWN_DESIGNATION" }]);
      await expect(workflows.activate(draft.id, adminId)).rejects.toThrow();
      await workflows.deleteDraft(draft.id, adminId);
    });

    it("met un circuit en vigueur, retire le précédent, et fige la version active en base", async () => {
      const first = await activate(circuitDoc());
      expect(first).toMatchObject({ status: "ACTIVE", number: expect.any(Number) });
      const second = await activate(circuitDoc({ withPresident: false }));
      expect(second.number).toBe(first.number + 1);
      const history = (await call("GET", "/workflows/reimbursement", treasurer)).json();
      expect(history.versions.filter((v: { status: string }) => v.status === "ACTIVE")).toHaveLength(1);
      expect(history.versions.find((v: { id: string }) => v.id === first.id).status).toBe("RETIRED");

      expect(await sqlError(`UPDATE "WorkflowDefinitionVersion" SET "document" = '{}'::jsonb WHERE "id" = '${second.id}'`)).toContain("ne se modifie pas");
      expect(await sqlError(`DELETE FROM "WorkflowDefinitionVersion" WHERE "id" = '${second.id}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`UPDATE "WorkflowDefinitionVersion" SET "status" = 'DRAFT' WHERE "id" = '${first.id}'`)).toContain("ne change plus");
      expect(await sqlError(`TRUNCATE "WorkflowDefinitionVersion" CASCADE`)).not.toBeNull();
      expect(await sqlError(`DELETE FROM "WorkflowDefinition"`)).toContain("ne se supprime pas");
    });

    it("signale une étape que personne ne peut décider aujourd'hui, sans empêcher l'activation", async () => {
      const lonely = await prisma.officeRole.create({ data: { name: `Vacante ${randomUUID().slice(0, 6)}`, nameKey: `vacante-${randomUUID()}` } });
      const draft = await workflows.createDraft("reimbursement", { source: "STARTER" }, adminId);
      const saved = await workflows.updateDraft(draft.id, { revision: draft.revision, document: circuitDoc({ president: [{ kind: "OFFICE", id: lonely.id }] }) }, adminId);
      expect(saved.issues).toEqual([]);
      expect(saved.warnings).toMatchObject([{ nodeId: "president", code: "NOBODY_ELIGIBLE" }]);
      await workflows.deleteDraft(draft.id, adminId);
    });
  });

  describe("exécution d'une demande", () => {
    it("la demande d'un simple membre attend le président, puis le trésorier ; l'historique est conservé", async () => {
      await activate(circuitDoc());
      events.length = 0;
      const started = await start(person.lea.id);
      expect(started).toMatchObject({ status: "RUNNING", currentNodeId: "president" });
      expect(events.map((e) => e.type)).toEqual(["STARTED", "STEP_ACTIVATED"]);

      // Ni la demandeuse, ni la trésorière (pas désignée à cette étape) ne peuvent donner l'accord.
      await expect(engine.decide(started.instanceId, { type: "APPROVE", actorId: person.lea.id })).rejects.toThrow(/ne faites pas partie|ne pouvez pas/);
      await expect(engine.decide(started.instanceId, { type: "APPROVE", actorId: person.tess.id })).rejects.toThrow(/ne faites pas partie/);

      const approved = await engine.decide(started.instanceId, { type: "APPROVE", actorId: person.claire.id });
      expect(approved).toMatchObject({ status: "RUNNING", currentNodeId: "treasurer" });
      expect(approved.steps.map((s) => s.state)).toEqual(["DONE", "CURRENT"]);
      const done = await engine.decide(started.instanceId, { type: "PROCESS", actorId: person.tess.id });
      expect(done.status).toBe("COMPLETED");
      expect(done.decisions.map((d) => [d.nodeId, d.outcome, d.actorUserId])).toEqual([
        ["president", "APPROVED", person.claire.id],
        ["treasurer", "PROCESSED", person.tess.id],
      ]);
      expect(events.at(-1)).toMatchObject({ type: "COMPLETED", requesterUserId: person.lea.id });
      await expect(engine.decide(started.instanceId, { type: "APPROVE", actorId: person.paul.id })).rejects.toThrow(/terminée/);
    });

    it("la présidente qui demande saute son étape, en laissant une décision « validée d'office »", async () => {
      await activate(circuitDoc());
      const started = await start(person.claire.id);
      expect(started).toMatchObject({ status: "RUNNING", currentNodeId: "treasurer" });
      const view = await engine.view(started.instanceId);
      expect(view.decisions).toMatchObject([{ nodeId: "president", outcome: "AUTO_APPROVED", actorUserId: person.claire.id }]);
      expect(view.steps.map((s) => s.state)).toEqual(["AUTO", "CURRENT"]);
    });

    it("la trésorière qui demande passe quand même par le président, et ne traite pas sa propre demande", async () => {
      await activate(circuitDoc({ processors: [{ kind: "USER", id: person.tess.id }, { kind: "USER", id: person.paul.id }] }));
      const started = await start(person.tess.id);
      expect(started.currentNodeId).toBe("president");
      await engine.decide(started.instanceId, { type: "APPROVE", actorId: person.paul.id });
      await expect(engine.decide(started.instanceId, { type: "PROCESS", actorId: person.tess.id })).rejects.toThrow(/votre propre demande/);
      expect((await engine.view(started.instanceId)).status).toBe("RUNNING");
      // Une autre personne désignée peut rembourser.
      expect((await engine.decide(started.instanceId, { type: "PROCESS", actorId: person.paul.id })).status).toBe("COMPLETED");
    });

    it("refuse de soumettre une demande dont une étape n'aurait personne d'autre que le demandeur", async () => {
      await activate(circuitDoc());
      // Seule Tess traite : sa propre demande ne peut pas être remboursée par quelqu'un d'autre.
      const subjectId = randomUUID();
      await expect(start(person.tess.id, subjectId).then(() => start(person.tess.id, subjectId))).rejects.toThrow();
      await activate(circuitDoc({ withPresident: false, allowSelfProcessing: false }));
      await expect(start(person.tess.id)).rejects.toThrow(/Personne d'autre que vous/);
      await activate(circuitDoc({ withPresident: false, allowSelfProcessing: true }));
      expect((await start(person.tess.id)).currentNodeId).toBe("treasurer");
    });

    it("ne retient qu'une décision quand deux validateurs cliquent en même temps", async () => {
      await activate(circuitDoc());
      const started = await start(person.lea.id);
      const results = await Promise.allSettled([
        engine.decide(started.instanceId, { type: "APPROVE", actorId: person.claire.id }),
        engine.decide(started.instanceId, { type: "APPROVE", actorId: person.paul.id }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const view = await engine.view(started.instanceId);
      expect(view.decisions.filter((d) => d.nodeId === "president")).toHaveLength(1);
      expect(view.currentNodeId).toBe("treasurer");
    });

    it("garde la version du circuit de la soumission quand le circuit change (CA-09)", async () => {
      await activate(circuitDoc());
      const old = await start(person.lea.id);
      const oldVersion = (await engine.view(old.instanceId)).versionNumber;
      await activate(circuitDoc({ withPresident: false }));
      const fresh = await start(person.lea.id);
      expect(fresh.currentNodeId).toBe("treasurer");
      const oldView = await engine.view(old.instanceId);
      expect(oldView.versionNumber).toBe(oldVersion);
      expect(oldView.currentNodeId).toBe("president");
      // La demande ancienne suit toujours l'ancien circuit, président compris.
      const next = await engine.decide(old.instanceId, { type: "APPROVE", actorId: person.claire.id });
      expect(next.currentNodeId).toBe("treasurer");
    });

    it("suit le titulaire de la fonction : un mandat terminé retire le droit de valider", async () => {
      await activate(circuitDoc());
      const holder = await memberUser("Odile");
      const mandate = await prisma.memberOffice.create({ data: { memberId: holder.memberId, officeRoleId: presidentOfficeId, startsOn: new Date("2021-01-01T00:00:00Z") } });
      const started = await start(person.lea.id);
      await prisma.memberOffice.update({ where: { id: mandate.id }, data: { endsOn: new Date("2021-12-31T00:00:00Z") } });
      await expect(engine.decide(started.instanceId, { type: "APPROVE", actorId: holder.id })).rejects.toThrow(/ne faites pas partie/);
    });

    it("refuse et renvoie pour correction avec un message, puis reprend ou repart de la première étape", async () => {
      await activate(circuitDoc());
      const refusedRun = await start(person.lea.id);
      await expect(engine.decide(refusedRun.instanceId, { type: "REFUSE", actorId: person.claire.id })).rejects.toThrow(/quelques mots/);
      const refused = await engine.decide(refusedRun.instanceId, { type: "REFUSE", actorId: person.claire.id, message: "Hors budget cette année" });
      expect(refused.status).toBe("REFUSED");

      const run = await start(person.lea.id);
      await engine.decide(run.instanceId, { type: "APPROVE", actorId: person.claire.id });
      const returned = await engine.decide(run.instanceId, { type: "RETURN", actorId: person.tess.id, message: "Le justificatif est illisible" });
      expect(returned.status).toBe("RETURNED");
      await expect(engine.decide(run.instanceId, { type: "PROCESS", actorId: person.tess.id })).rejects.toThrow(/correction/);
      await expect(engine.resume(run.instanceId, person.paul.id, { restartFromFirst: false })).rejects.toThrow(/Seule la personne/);

      const resumed = await engine.resume(run.instanceId, person.lea.id, { restartFromFirst: false });
      expect(resumed).toMatchObject({ status: "RUNNING", currentNodeId: "treasurer", round: 2 });
      // Le même traitement peut recevoir une nouvelle décision dans la passe suivante.
      const returnedAgain = await engine.decide(run.instanceId, { type: "RETURN", actorId: person.tess.id, message: "Toujours illisible" });
      expect(returnedAgain.status).toBe("RETURNED");
      const restarted = await engine.resume(run.instanceId, person.lea.id, { restartFromFirst: true });
      expect(restarted).toMatchObject({ status: "RUNNING", currentNodeId: "president", round: 3 });
      expect(restarted.decisions.map((d) => d.outcome)).toEqual(["APPROVED", "RETURNED", "RETURNED"]);
    });

    it("annule à la demande de la personne qui l'a faite, avec un motif", async () => {
      await activate(circuitDoc());
      const run = await start(person.lea.id);
      await expect(engine.decide(run.instanceId, { type: "CANCEL", actorId: person.claire.id, message: "Je m'en occupe" })).rejects.toThrow(/Seule la personne/);
      const cancelled = await engine.decide(run.instanceId, { type: "CANCEL", actorId: person.lea.id, message: "Plus nécessaire" });
      expect(cancelled.status).toBe("CANCELLED");
    });

    it("ajoute une personne à une étape pour une seule demande (réaffectation motivée et auditée)", async () => {
      await activate(circuitDoc());
      const interim = await memberUser("Rémi");
      const run = await start(person.lea.id);
      await expect(engine.decide(run.instanceId, { type: "APPROVE", actorId: interim.id })).rejects.toThrow(/ne faites pas partie/);
      await expect(engine.reassign(run.instanceId, { nodeId: "president", designation: { kind: "USER", id: interim.id }, reason: "ok" }, adminId)).rejects.toThrow();
      await engine.reassign(run.instanceId, { nodeId: "president", designation: { kind: "USER", id: interim.id }, reason: "Le président est absent ce mois-ci" }, adminId);
      const approved = await engine.decide(run.instanceId, { type: "APPROVE", actorId: interim.id });
      expect(approved.currentNodeId).toBe("treasurer");
      const audit = await prisma.auditEvent.findFirst({ where: { action: "workflow.step.reassigned", objectId: run.instanceId } });
      expect(audit?.justification).toContain("absent");
    });

    it("liste les demandes qu'une personne peut décider maintenant", async () => {
      await activate(circuitDoc());
      const run = await start(person.lea.id);
      expect((await engine.awaiting(person.claire.id, "reimbursement")).map((a) => a.instanceId)).toContain(run.instanceId);
      expect((await engine.awaiting(person.lea.id, "reimbursement")).map((a) => a.instanceId)).not.toContain(run.instanceId);
      expect((await engine.awaiting(person.tess.id, "reimbursement")).map((a) => a.instanceId)).not.toContain(run.instanceId);
    });

    it("ne démarre pas sans circuit en vigueur ni sur une version retirée", async () => {
      const retired = await prisma.workflowDefinitionVersion.findFirstOrThrow({ where: { status: "RETIRED" } });
      const error = await sqlError(
        `INSERT INTO "WorkflowInstance" ("id", "definitionVersionId", "subjectType", "subjectId", "requesterUserId", "updatedAt") VALUES (gen_random_uuid(), '${retired.id}', 'reimbursement', gen_random_uuid(), '${person.lea.id}', now())`,
      );
      expect(error).toContain("version active");
    });

    it("garde l'historique en ajout seul et la demande attachée à sa version", async () => {
      await activate(circuitDoc());
      const run = await start(person.lea.id);
      await engine.decide(run.instanceId, { type: "APPROVE", actorId: person.claire.id });
      expect(await sqlError(`UPDATE "ApprovalDecision" SET "message" = 'x' WHERE "instanceId" = '${run.instanceId}'`)).toContain("ajout seul");
      expect(await sqlError(`DELETE FROM "ApprovalDecision" WHERE "instanceId" = '${run.instanceId}'`)).toContain("ajout seul");
      expect(await sqlError(`DELETE FROM "WorkflowInstance" WHERE "id" = '${run.instanceId}'`)).toContain("ne se supprime pas");
      const other = await prisma.workflowDefinitionVersion.findFirstOrThrow({ where: { status: "RETIRED" } });
      expect(await sqlError(`UPDATE "WorkflowInstance" SET "definitionVersionId" = '${other.id}' WHERE "id" = '${run.instanceId}'`)).toContain("garde sa version");
      await engine.decide(run.instanceId, { type: "PROCESS", actorId: person.tess.id });
      expect(await sqlError(`UPDATE "WorkflowInstance" SET "status" = 'RUNNING' WHERE "id" = '${run.instanceId}'`)).toContain("terminée");
      expect(await sqlError(`TRUNCATE "ApprovalDecision" CASCADE`)).not.toBeNull();
    });
  });
});
