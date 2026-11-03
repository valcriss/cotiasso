import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { UsersService } from "../../src/auth/users.service.js";
import { readEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { OverviewService } from "../../src/guided/overview.service.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

describe("Parcours simplifiés : catégories, saisie guidée et vue d'ensemble (ADR 0028, base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let boardMember: Session;
  let reader: Session;
  const ids: Record<string, string> = {};

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
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: PASSWORD },
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    });
    return { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
  };

  const sqlError = async (statement: string) => {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      return String((error as Error).message) + String((error as { cause?: unknown }).cause ?? "");
    }
    return null;
  };

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
    await app.inject({
      method: "POST",
      url: "/setup",
      payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD },
    });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("sur une base vide, la vue d'ensemble dit quoi faire en premier", async () => {
    const response = await call("GET", "/overview", treasurer);
    expect(response.statusCode).toBe(200);
    const overview = response.json();
    expect(overview.setup).toEqual({ fiscalYear: false, accounts: false, financialAccount: false, categories: false, startMode: null, openingSituation: "NONE" });
    expect(overview.todo.map((t: { code: string }) => t.code)).toEqual(["NO_FISCAL_YEAR", "NO_FINANCIAL_ACCOUNT"]);
  });

  it("la vue d'ensemble n'est jamais refusée à un utilisateur connecté et reste filtrée selon ses droits", async () => {
    expect((await call("GET", "/overview")).statusCode).toBe(401);
    const response = await call("GET", "/overview", reader);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cash: null, month: null, todo: [] });
  });

  describe("modèle de démarrage et catégories", () => {
    it("n'est réservé qu'à l'administration de la comptabilité", async () => {
      expect((await call("POST", "/starter-template", boardMember)).statusCode).toBe(403);
      expect((await call("POST", "/starter-template")).statusCode).toBe(401);
    });

    it("installe le plan et les catégories, puis ne change rien en relançant", async () => {
      await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: true } } });
      const first = await call("POST", "/starter-template", treasurer);
      expect(first.statusCode, first.body).toBe(200);
            expect(first.json().accountsCreated).toBeGreaterThan(15);
      expect(first.json().categoriesCreated).toBeGreaterThan(10);

      const second = await call("POST", "/starter-template", treasurer);
      expect(second.json()).toEqual({ accountsCreated: 0, categoriesCreated: 0 });

      const list = (await call("GET", "/operation-categories", boardMember)).json();
      expect(list.length).toBe(first.json().categoriesCreated);
      expect(list.find((c: { label: string }) => c.label === "Assurance")).toMatchObject({ direction: "OUT", account: { number: "616" } });
    });

    it("désigne la catégorie des cotisations et celle des subventions, un rôle n'a qu'une catégorie et une catégorie désactivée n'en garde pas", async () => {
      const list = async () => (await call("GET", "/operation-categories/all", treasurer)).json() as { id: string; label: string; usage: string | null; direction: string; active: boolean }[];
      const find = async (label: string) => (await list()).find((c) => c.label === label)!;
      expect((await find("Cotisations des adhérents")).usage).toBe("MEMBERSHIP");
      expect((await find("Subvention")).usage).toBe("GRANT");
      expect((await find("Dons")).usage).toBeNull();

      // Donner le rôle à une autre catégorie le retire à l'ancienne, dans la même opération.
      const dons = await find("Dons");
      expect((await call("PATCH", `/operation-categories/${dons.id}`, treasurer, { usage: "MEMBERSHIP" })).json().usage).toBe("MEMBERSHIP");
      expect((await find("Cotisations des adhérents")).usage).toBeNull();
      // Seule une catégorie d'argent reçu peut avoir un rôle.
      const assurance = await find("Assurance");
      const refused = await call("PATCH", `/operation-categories/${assurance.id}`, treasurer, { usage: "GRANT" });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("argent reçu");
      // Désactiver une catégorie lui retire son rôle.
      expect((await call("PATCH", `/operation-categories/${dons.id}`, treasurer, { active: false })).json().usage).toBeNull();
      // Retour à l'état initial pour la suite.
      await call("PATCH", `/operation-categories/${dons.id}`, treasurer, { active: true });
      const cotis = await find("Cotisations des adhérents");
      expect((await call("PATCH", `/operation-categories/${cotis.id}`, treasurer, { usage: "MEMBERSHIP" })).json().usage).toBe("MEMBERSHIP");
      // Réinstaller le modèle ne déplace pas un rôle déjà attribué.
      await call("POST", "/starter-template", treasurer);
      expect((await find("Cotisations des adhérents")).usage).toBe("MEMBERSHIP");
      expect(await sqlError(`UPDATE "OperationCategory" SET "usage"='GRANT' WHERE label='Assurance'`)).toContain("OperationCategory_usage_incoming");
    });

    it("refuse un compte qui ne correspond pas au sens, un doublon, et désactive sans supprimer", async () => {
      const accounts = (await call("GET", "/accounts", treasurer)).json() as { id: string; number: string }[];
      const id = (n: string) => accounts.find((a) => a.number === n)!.id;
      const wrong = await call("POST", "/operation-categories", treasurer, { direction: "IN", label: "Mauvaise", accountId: id("606") });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json().message).toContain("produits");

      const created = await call("POST", "/operation-categories", treasurer, { direction: "OUT", label: "Abonnement logiciel", hint: "Outils en ligne", accountId: id("606") });
      expect(created.statusCode, created.body).toBe(201);
      const duplicate = await call("POST", "/operation-categories", treasurer, { direction: "OUT", label: "abonnement LOGICIEL", accountId: id("606") });
      expect(duplicate.statusCode).toBe(409);

      const off = await call("PATCH", `/operation-categories/${created.json().id}`, treasurer, { active: false });
      expect(off.json().active).toBe(false);
      expect((await call("GET", "/operation-categories", treasurer)).json().some((c: { id: string }) => c.id === created.json().id)).toBe(false);
      expect((await call("GET", "/operation-categories/all", treasurer)).json().some((c: { id: string }) => c.id === created.json().id)).toBe(true);
      expect(await sqlError(`DELETE FROM "OperationCategory" WHERE id = '${created.json().id}'`)).toContain("ne se supprime pas");
    });
  });

  describe("saisie guidée d'une opération", () => {
    const category = async (label: string) =>
      ((await call("GET", "/operation-categories", treasurer)).json() as { id: string; label: string }[]).find((c) => c.label === label)!.id;

    beforeAll(async () => {
      expect((await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).statusCode).toBe(201);
      const accounts = (await call("GET", "/accounts", treasurer)).json() as { id: string; number: string }[];
      ids.bankAccount = accounts.find((a) => a.number === "512")!.id;
      const bank = await call("POST", "/financial-accounts", treasurer, { name: "Banque", type: "BANK", accountId: ids.bankAccount, openedOn: "2026-01-01", openingBalance: "100.00" });
      expect(bank.statusCode, bank.body).toBe(201);
      ids.fBank = bank.json().id;
    });

    it("enregistre une recette en une action : transaction, écriture à partie double comptabilisée, projet « Fonctionnement » par défaut", async () => {
      const response = await call("POST", "/guided-operations", treasurer, {
        financialAccountId: ids.fBank,
        direction: "IN",
        amount: "30.00",
        date: "2026-03-10",
        label: "Cotisation de Marie",
        categoryId: await category("Cotisations des adhérents"),
      });
      expect(response.statusCode, response.body).toBe(201);
      const result = response.json();
      expect(result).toMatchObject({ posted: true, journalCode: "BQ-1", number: 1 });

      const entry = (await call("GET", `/entries/${result.entryId}`, treasurer)).json();
      expect(entry).toMatchObject({ status: "POSTED", label: "Cotisation de Marie" });
      expect(entry.lines).toMatchObject([
        { accountNumber: "512", debit: "30.00", credit: "0.00" },
        { accountNumber: "756", debit: "0.00", credit: "30.00", allocations: [{ projectCode: expect.any(String), amount: "30.00" }] },
      ]);
      const tx = (await call("GET", `/financial-accounts/${ids.fBank}/transactions`, treasurer)).json().transactions[0];
      expect(tx).toMatchObject({ amount: "30.00", accounting: "POSTED" });
    });

    it("enregistre une dépense en négatif sur la banque et débite la charge", async () => {
      const response = await call("POST", "/guided-operations", treasurer, {
        financialAccountId: ids.fBank,
        direction: "OUT",
        amount: "12.50",
        date: "2026-03-11",
        label: "Assurance",
        categoryId: await category("Assurance"),
      });
      expect(response.statusCode, response.body).toBe(201);
      const entry = (await call("GET", `/entries/${response.json().entryId}`, treasurer)).json();
      expect(entry.lines).toMatchObject([
        { accountNumber: "512", debit: "0.00", credit: "12.50" },
        { accountNumber: "616", debit: "12.50", credit: "0.00" },
      ]);
    });

    it("tout ou rien : une date hors exercice, une catégorie de l'autre sens ou un montant nul ne laissent rien derrière eux", async () => {
      const before = await prisma.transaction.count();
      const entriesBefore = await prisma.journalEntry.count();
      const base = { financialAccountId: ids.fBank, direction: "OUT", amount: "5.00", date: "2026-03-12", label: "Test", categoryId: await category("Assurance") };
      expect((await call("POST", "/guided-operations", treasurer, { ...base, date: "2030-01-01" })).statusCode).toBe(409);
      expect((await call("POST", "/guided-operations", treasurer, { ...base, categoryId: await category("Dons") })).statusCode).toBe(409);
      expect((await call("POST", "/guided-operations", treasurer, { ...base, amount: "0.00" })).statusCode).toBe(400);
      expect((await call("POST", "/guided-operations", treasurer, { ...base, amount: "-5.00" })).statusCode).toBe(400);
      expect(await prisma.transaction.count()).toBe(before);
      expect(await prisma.journalEntry.count()).toBe(entriesBefore);
    });

    it("sans le droit de comptabiliser, prépare un brouillon au lieu de refuser ; refuse sans droit de saisie", async () => {
      const role = await prisma.role.create({
        data: { key: `saisie-${randomUUID()}`, name: `Saisie ${randomUUID()}`, permissions: ["financial-accounts:view", "transactions:manage", "entries:create", "entries:view"], requiresMfa: false },
      });
      const limitedUser = await users.createUser({ email: `s-${randomUUID()}@test.invalid`, displayName: "S", password: PASSWORD });
      await prisma.roleAssignment.create({ data: { userId: limitedUser.id, roleId: role.id } });
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: limitedUser.email, password: PASSWORD }, remoteAddress: "198.51.100.77" });
      const limited = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };

      const response = await call("POST", "/guided-operations", limited, {
        financialAccountId: ids.fBank,
        direction: "OUT",
        amount: "8.00",
        date: "2026-03-13",
        label: "Timbres",
        categoryId: await category("Courrier et téléphone"),
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ posted: false, number: null });
      expect((await call("GET", `/entries/${response.json().entryId}`, treasurer)).json().status).toBe("DRAFT");

      expect((await call("POST", "/guided-operations", reader, { financialAccountId: ids.fBank, direction: "OUT", amount: "1.00", date: "2026-03-13", label: "x", categoryId: await category("Assurance") })).statusCode).toBe(403);
    });

    it("la vue d'ensemble compte l'argent, le mois et les brouillons à relire", async () => {
      const overview = (await call("GET", "/overview", treasurer)).json();
      expect(overview.setup).toEqual({ fiscalYear: true, accounts: true, financialAccount: true, categories: true, startMode: null, openingSituation: "NONE" });
      expect(overview.cash.total).toBe("109.50");
      expect(overview.todo.map((t: { code: string }) => t.code)).toContain("DRAFTS");
      expect(overview.todo.find((t: { code: string }) => t.code === "TO_VERIFY")).toMatchObject({ level: "INFO" });
    });

    it("la vue d'ensemble montre les dernières opérations, ouvre « à classer » sur le bon compte et annonce la fin de période (#27)", async () => {
      const loose = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-03-25", amount: "-12.00", label: "Ticket sans catégorie" });
      expect(loose.statusCode, loose.body).toBe(201);
      const overview = (await call("GET", "/overview", treasurer)).json();

      expect(overview.recent.length).toBeGreaterThan(1);
      expect(overview.recent.length).toBeLessThanOrEqual(5);
      expect(overview.recent[0]).toMatchObject({ label: "Ticket sans catégorie", amount: "-12.00", accountName: "Banque", situation: "TO_CLASSIFY", date: "2026-03-25" });
      const dates = overview.recent.map((r: { date: string }) => r.date);
      expect([...dates].sort().reverse()).toEqual(dates);
      expect(overview.recent.map((r: { situation: string }) => r.situation)).toEqual(expect.arrayContaining(["BOOKED"]));

      const toClassify = overview.todo.find((t: { code: string }) => t.code === "TO_CLASSIFY");
      expect(toClassify).toMatchObject({ link: "/comptes", query: { compte: ids.fBank } });
      // Sans droit de lire les comptes, ni dernières opérations ni montants.
      expect((await call("GET", "/overview", reader)).json().recent).toBeNull();

      // Fin de période : la marche à suivre apparaît un mois avant, puis passe en avertissement quand la période est dépassée.
      const me = (await call("GET", "/auth/me", treasurer)).json().user.id as string;
      const svc = app.get(OverviewService);
      const code = (view: { todo: { code: string; detail: string }[] }) => view.todo.find((t) => t.code === "PERIOD_END");
      expect(code(await svc.overview(me, new Date("2026-06-01T10:00:00Z")))).toBeUndefined();
      const soon = code(await svc.overview(me, new Date("2026-12-10T10:00:00Z")));
      expect(soon).toMatchObject({ level: "INFO", title: "Votre période se termine le 31/12/2026 (dans 21 jours)", link: "/parametres" });
      expect(soon!.detail).toContain("clôturez la période");
      expect(code(await svc.overview(me, new Date("2026-12-31T10:00:00Z")))).toMatchObject({ title: "Votre période se termine aujourd'hui" });
      expect(code(await svc.overview(me, new Date("2027-01-05T10:00:00Z")))).toMatchObject({ level: "WARNING", title: "Votre période est terminée depuis le 31/12/2026" });
      // Réservé à qui peut clôturer.
      expect((await svc.overview((await call("GET", "/auth/me", reader)).json().user.id as string, new Date("2026-12-10T10:00:00Z"))).todo.some((t) => t.code === "PERIOD_END")).toBe(false);
    });

    it("la vue d'ensemble annonce les cotisations qui restent à payer de la saison en cours (#27)", async () => {
      const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const campaign = await call("POST", "/campaigns", treasurer, { name: "Saison en cours", startsOn: shift(-30), endsOn: shift(300), effectiveMode: "PAYMENT" });
      expect(campaign.statusCode, campaign.body).toBe(201);
      const tariffId = (await call("POST", `/campaigns/${campaign.json().id}/tariffs`, treasurer, { label: "Plein tarif", amount: "30.00" })).json().tariffs[0].id as string;
      for (const firstName of ["Alice", "Bob"]) {
        const memberId = (await call("POST", "/members", treasurer, { firstName, lastName: "Test" })).json().id as string;
        expect((await call("POST", `/campaigns/${campaign.json().id}/memberships`, treasurer, { memberId, tariffId })).statusCode).toBe(201);
      }
      const late = (await call("GET", "/overview", treasurer)).json().todo.find((t: { code: string }) => t.code === "MEMBERSHIPS_LATE");
      expect(late).toMatchObject({ level: "INFO", count: 2, title: "2 cotisations restent à payer (60,00 €)", link: "/membres", query: { cotisation: "late" } });
      expect((await call("GET", "/overview", reader)).json().todo.some((t: { code: string }) => t.code === "MEMBERSHIPS_LATE")).toBe(false);
    });

    describe("corriger une opération enregistrée (#17)", () => {
      const record = async (label: string, categoryLabel: string, amount = "40.00") => {
        const response = await call("POST", "/guided-operations", treasurer, { financialAccountId: ids.fBank, direction: "OUT", amount, date: "2026-04-02", label, categoryId: await category(categoryLabel) });
        expect(response.statusCode, response.body).toBe(201);
        return response.json() as { transactionId: string; entryId: string };
      };
      const entryOf = async (id: string) => (await call("GET", `/entries/${id}`, treasurer)).json();
      const correct = (transactionId: string, body: object, session: Session | undefined = treasurer) => call("POST", `/transactions/${transactionId}/correct`, session, body);

      it("contrepasse puis refait l'écriture avec la nouvelle catégorie, en gardant tout l'historique", async () => {
        const op = await record("Facture mal classée", "Assurance");
        const done = await correct(op.transactionId, { categoryId: await category("Communication et publicité"), label: "Facture de l'imprimeur" });
        expect(done.statusCode, done.body).toBe(200);
        const result = done.json();
        expect(result).toMatchObject({ transactionId: op.transactionId, posted: true, reversedEntryId: op.entryId });
        expect(result.entryId).not.toBe(op.entryId);

        expect((await entryOf(op.entryId)).status).toBe("REVERSED");
        const fresh = await entryOf(result.entryId);
        expect(fresh.status).toBe("POSTED");
        const numbers = fresh.lines.map((l: { accountNumber: string }) => l.accountNumber);
        expect(numbers).toContain("512");
        expect(numbers).not.toContain("616");
        // L'écriture inverse existe, comptabilisée, et le mouvement pointe sur la nouvelle écriture uniquement.
        const reversals = await prisma.journalEntry.findMany({ where: { reversalOfId: op.entryId } });
        expect(reversals).toHaveLength(1);
        expect(reversals[0]!.status).toBe("POSTED");
        const links = await prisma.treasuryMatch.findMany({ where: { transactionId: op.transactionId }, orderBy: { createdAt: "asc" } });
        expect(links.map((l) => l.status)).toEqual(["ENDED", "ACTIVE"]);
        const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: op.transactionId } });
        expect(tx.label).toBe("Facture de l'imprimeur");
        expect(tx.amount.toString()).toBe("-40");
        const audit = await prisma.auditEvent.findFirst({ where: { action: "operation.corrected", objectId: op.transactionId } });
        expect(audit?.details).toMatchObject({ entryId: result.entryId, reversedEntryId: op.entryId, posted: true });
      });

      it("change le projet seul, et rend rien de plus quand rien ne change", async () => {
        const op = await record("Achat pour l'atelier", "Assurance");
        const project = (await call("POST", "/projects", treasurer, { code: "ATELIER", name: "Atelier" })).json();
        const done = await correct(op.transactionId, { projectId: project.id });
        expect(done.statusCode, done.body).toBe(200);
        expect((await prisma.transaction.findUniqueOrThrow({ where: { id: op.transactionId } })).projectId).toBe(project.id);
        const again = await correct(op.transactionId, { projectId: project.id });
        expect(again.statusCode).toBe(409);
        expect(again.json().message).toContain("Rien n'a changé");
        expect((await correct(op.transactionId, {})).statusCode).toBe(400);
      });

      it("est tout ou rien : un refus en cours de route laisse l'écriture d'origine intacte", async () => {
        const op = await record("Facture à ne pas perdre", "Assurance");
        const archived = (await call("POST", "/projects", treasurer, { code: "ARCHIVE", name: "Archivé" })).json();
        expect((await call("PATCH", `/projects/${archived.id}`, treasurer, { version: archived.version, status: "ARCHIVED" })).statusCode).toBe(200);
        const entriesBefore = await prisma.journalEntry.count();
        const refused = await correct(op.transactionId, { projectId: archived.id });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().message).toContain("projet archivé");
        expect((await entryOf(op.entryId)).status).toBe("POSTED");
        expect(await prisma.journalEntry.count()).toBe(entriesBefore);
        expect((await prisma.treasuryMatch.findMany({ where: { transactionId: op.transactionId } })).map((m) => m.status)).toEqual(["ACTIVE"]);
      });

      it("refuse une catégorie du mauvais sens, un brouillon, un mouvement non enregistré et un droit insuffisant", async () => {
        const op = await record("Facture", "Assurance");
        expect((await correct(op.transactionId, { categoryId: await category("Dons") })).json().message).toContain("argent dépensé");

        const loose = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-04-03", amount: "-5.00", label: "Pas encore enregistré" });
        const notBooked = await correct(loose.json().id, { label: "Autre" });
        expect(notBooked.statusCode).toBe(409);
        expect(notBooked.json().message).toContain("pas encore enregistré dans les comptes");

        const draft = await call("POST", "/guided-operations", treasurer, { financialAccountId: ids.fBank, direction: "OUT", amount: "6.00", date: "2026-04-03", label: "Brouillon", categoryId: await category("Assurance"), post: false });
        expect(draft.json().posted).toBe(false);
        const refusedDraft = await correct(draft.json().transactionId, { label: "Autre" });
        expect(refusedDraft.statusCode).toBe(409);
        expect(refusedDraft.json().message).toContain("encore en brouillon");

        expect((await correct(op.transactionId, { label: "Autre" }, reader)).statusCode).toBe(403);
        expect((await call("POST", `/transactions/${op.transactionId}/correct`, undefined, { label: "Autre" })).statusCode).toBe(401);
      });

      const adjust = (transactionId: string, body: object, session: Session | undefined = treasurer) => call("POST", `/transactions/${transactionId}/adjust-amount`, session, body);

      it("corrige un montant par un mouvement de régularisation de l'écart, sans toucher à l'original (ADR 0032)", async () => {
        const op = await record("Facture saisie trop haute", "Assurance", "49.00");
        const done = await adjust(op.transactionId, { amount: "40.00", date: "2026-04-05" });
        expect(done.statusCode, done.body).toBe(201);
        const result = done.json();
        expect(result).toMatchObject({ adjustedTransactionId: op.transactionId, difference: "9.00", posted: true });
        expect(result.transactionId).not.toBe(op.transactionId);

        const original = await prisma.transaction.findUniqueOrThrow({ where: { id: op.transactionId } });
        expect(original.amount.toString()).toBe("-49");
        expect((await entryOf(op.entryId)).status).toBe("POSTED");
        const fix = await prisma.transaction.findUniqueOrThrow({ where: { id: result.transactionId } });
        expect(fix.amount.toString()).toBe("9");
        expect(fix.label).toBe("Correction : Facture saisie trop haute");
        expect(fix.counterpartAccountId).toBe(original.counterpartAccountId);
        // Le net de la dépense et de la banque vaut le bon montant : 49 − 9 = 40.
        const fixEntry = await entryOf(result.entryId);
        expect(fixEntry.status).toBe("POSTED");
        const audit = await prisma.auditEvent.findFirst({ where: { action: "operation.amount-adjusted", objectId: op.transactionId } });
        expect(audit?.details).toMatchObject({ adjustmentTransactionId: result.transactionId });
      });

      it("ajoute une dépense quand le montant était trop bas, et refuse un montant identique, un brouillon, un virement et un droit insuffisant", async () => {
        const op = await record("Facture trop basse", "Assurance", "40.00");
        const more = await adjust(op.transactionId, { amount: "45.00", date: "2026-04-05" });
        expect(more.statusCode, more.body).toBe(201);
        expect(more.json().difference).toBe("-5.00");
        expect((await prisma.transaction.findUniqueOrThrow({ where: { id: more.json().transactionId } })).amount.toString()).toBe("-5");

        const same = await adjust(op.transactionId, { amount: "40.00", date: "2026-04-05" });
        expect(same.statusCode).toBe(409);
        expect(same.json().message).toContain("déjà celui de l'opération");

        const draft = await call("POST", "/guided-operations", treasurer, { financialAccountId: ids.fBank, direction: "OUT", amount: "6.00", date: "2026-04-03", label: "Brouillon", categoryId: await category("Assurance"), post: false });
        expect((await adjust(draft.json().transactionId, { amount: "7.00", date: "2026-04-05" })).statusCode).toBe(409);

        expect((await adjust(op.transactionId, { amount: "0", date: "2026-04-05" })).statusCode).toBe(400);
        expect((await adjust(op.transactionId, { amount: "41.00", date: "2026-04-05" }, reader)).statusCode).toBe(403);
        expect((await call("POST", `/transactions/${op.transactionId}/adjust-amount`, undefined, { amount: "41.00", date: "2026-04-05" })).statusCode).toBe(401);
      });

      it("ne laisse aucun mouvement derrière lui quand la date tombe hors de tout exercice", async () => {
        const op = await record("Facture à régulariser", "Assurance", "30.00");
        const before = await prisma.transaction.count();
        const refused = await adjust(op.transactionId, { amount: "20.00", date: "2001-01-01" });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().message).toContain("Aucun exercice");
        expect(await prisma.transaction.count()).toBe(before);
      });
    });

    it("classe et enregistre en un geste un mouvement qui existe déjà (importé ou saisi), puis refuse de le refaire", async () => {
      const tx = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-03-20", amount: "-60.00", label: "Facture de l'imprimeur" });
      expect(tx.statusCode, tx.body).toBe(201);
      const booked = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, { categoryId: await category("Communication et publicité") });
      expect(booked.statusCode, booked.body).toBe(201);
      expect(booked.json()).toMatchObject({ posted: true, transactionId: tx.json().id });
      const entry = (await call("GET", `/entries/${booked.json().entryId}`, treasurer)).json();
      expect(entry.lines).toMatchObject([
        { accountNumber: "512", debit: "0.00", credit: "60.00" },
        { accountNumber: "623", debit: "60.00", credit: "0.00" },
      ]);
      const listed = (await call("GET", `/financial-accounts/${ids.fBank}/transactions`, treasurer)).json().transactions.find((t: { id: string }) => t.id === tx.json().id);
      expect(listed).toMatchObject({ accounting: "POSTED", counterpartAccountNumber: "623" });

      const again = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, { categoryId: await category("Communication et publicité") });
      expect(again.statusCode).toBe(409);
      expect(again.json().message).toContain("déjà enregistré");
    });

    it("refuse de classer un mouvement avec une catégorie du mauvais sens, sans rien modifier", async () => {
      const tx = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-03-21", amount: "40.00", label: "Don de Paul" });
      const wrong = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, { categoryId: await category("Assurance") });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json().message).toContain("argent reçu");
      const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.json().id } });
      expect(row.counterpartAccountId).toBeNull();
      expect(await prisma.treasuryMatch.count({ where: { transactionId: tx.json().id } })).toBe(0);
      const ok = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, { categoryId: await category("Dons"), post: false });
      expect(ok.json()).toMatchObject({ posted: false });
    });

    it("n'accepte pas de classer un mouvement membre d'un virement", async () => {
      const accounts = (await call("GET", "/accounts", treasurer)).json() as { id: string; number: string }[];
      const cash = await call("POST", "/financial-accounts", treasurer, { name: "Caisse", type: "CASH", accountId: accounts.find((a) => a.number === "530")!.id, openedOn: "2026-01-01", openingBalance: "0.00" });
      const transfer = await call("POST", "/transfers", treasurer, { fromAccountId: ids.fBank, toAccountId: cash.json().id, amount: "10.00", date: "2026-03-22", prepareEntry: false });
      expect(transfer.statusCode, transfer.body).toBe(201);
      const out = await prisma.transfer.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
      const refused = await call("POST", `/transactions/${out.outTransactionId}/book`, treasurer, { categoryId: await category("Assurance") });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("virement");
    });

    describe("enregistrement en masse des mouvements classés", () => {
      let acc: string;
      const classified = async (date: string, amount: string, label: string, counterpart: string | null) => {
        const res = await call("POST", `/financial-accounts/${acc}/transactions`, treasurer, { operationDate: date, amount, label, ...(counterpart && { counterpartAccountId: counterpart }) });
        expect(res.statusCode, res.body).toBe(201);
        return res.json().id as string;
      };
      beforeAll(async () => {
        const accounts = (await call("GET", "/accounts", treasurer)).json() as { id: string; number: string }[];
        ids.p616 = accounts.find((a) => a.number === "616")!.id;
        ids.p756 = accounts.find((a) => a.number === "756")!.id;
        ids.p511 = (await call("POST", "/accounts", treasurer, { number: "5125", label: "Banque 2" })).json().id;
        const created = await call("POST", "/financial-accounts", treasurer, { name: "Banque 2", type: "BANK", accountId: ids.p511, openedOn: "2026-01-01", openingBalance: "0.00" });
        acc = created.json().id;
      });

      it("enregistre tout ce qui est classé, dans l'ordre, isole les refus et dit pourquoi chaque mouvement est ignoré", async () => {
        const a = await classified("2026-04-02", "-15.00", "Assurance avril", ids.p616!);
        const b = await classified("2026-04-01", "25.00", "Cotisation de Jean", ids.p756!);
        const unclassified = await classified("2026-04-03", "-3.00", "Inconnu", null);
        const outOfYear = await classified("2030-01-01", "-9.00", "Hors exercice", ids.p616!);

        // Sélection explicite : les raisons de chaque refus sont rendues, les autres passent.
        const selected = await call("POST", `/financial-accounts/${acc}/transactions/book`, treasurer, { transactionIds: [a, unclassified, outOfYear] });
        expect(selected.statusCode, selected.body).toBe(200);
        expect(selected.json()).toMatchObject({ booked: 1, posted: 1, drafts: 0 });
        const reasons = Object.fromEntries(selected.json().ignored.map((i: { transactionId: string; reason: string }) => [i.transactionId, i.reason]));
        expect(reasons[unclassified]).toContain("Pas encore classé");
        expect(reasons[outOfYear]).toContain("Aucun exercice ne couvre");

        // Sans sélection : tous les classés restants (b), jamais deux fois le même (a est déjà enregistré, il n'est même pas rappelé).
        const all = await call("POST", `/financial-accounts/${acc}/transactions/book`, treasurer, {});
        expect(all.json()).toMatchObject({ booked: 1, posted: 1 });
        // Le mouvement hors exercice reste classé mais refusé : il est rappelé à chaque fois, avec sa raison.
        expect(all.json().ignored.map((i: { transactionId: string }) => i.transactionId)).toEqual([outOfYear]);
        const again = await call("POST", `/financial-accounts/${acc}/transactions/book`, treasurer, {});
        expect(again.json()).toMatchObject({ booked: 0 });
        expect(again.json().ignored).toHaveLength(1);
        const list = (await call("GET", `/financial-accounts/${acc}/transactions`, treasurer)).json().transactions as { id: string; accounting: string }[];
        expect(list.find((t) => t.id === a)!.accounting).toBe("POSTED");
        expect(list.find((t) => t.id === b)!.accounting).toBe("POSTED");
        expect(list.find((t) => t.id === unclassified)!.accounting).toBe("NONE");
        // Dans un même lot, l'ordre est chronologique : saisi en second, le 10 avril reçoit le numéro le plus petit.
        const late = await classified("2026-04-12", "-2.00", "Plus tard", ids.p616!);
        const early = await classified("2026-04-10", "-1.00", "Plus tôt", ids.p616!);
        const batch = await call("POST", `/financial-accounts/${acc}/transactions/book`, treasurer, { transactionIds: [late, early] });
        expect(batch.json()).toMatchObject({ booked: 2, posted: 2 });
        const numbers = await prisma.journalEntry.findMany({ where: { matches: { some: { transactionId: { in: [late, early] } } } }, orderBy: { number: "asc" }, select: { date: true } });
        expect(numbers.map((n) => n.date.toISOString().slice(0, 10))).toEqual(["2026-04-10", "2026-04-12"]);
      });

      it("sans le droit de comptabiliser, prépare des brouillons ; refuse sans droit de saisie", async () => {
        const c = await classified("2026-04-05", "-4.00", "Timbres avril", ids.p616!);
        const role = await prisma.role.create({ data: { key: `masse-${randomUUID()}`, name: `Masse ${randomUUID()}`, permissions: ["financial-accounts:view", "transactions:manage", "entries:create"], requiresMfa: false } });
        const user = await users.createUser({ email: `b-${randomUUID()}@test.invalid`, displayName: "B", password: PASSWORD });
        await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
        const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: user.email, password: PASSWORD }, remoteAddress: "198.51.100.88" });
        const limited = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken };
        const done = await call("POST", `/financial-accounts/${acc}/transactions/book`, limited, { transactionIds: [c] });
        expect(done.json()).toMatchObject({ booked: 1, posted: 0, drafts: 1 });
        expect((await call("POST", `/financial-accounts/${acc}/transactions/book`, reader, {})).statusCode).toBe(403);
        expect((await call("POST", `/financial-accounts/${acc}/transactions/book`, treasurer, { transactionIds: [] })).statusCode).toBe(400);
      });
    });

    it("le rôle « Expert-comptable » lit les comptes et les rapports mais ne peut rien saisir", async () => {
      const accountant = await userWith("accountant");
      expect((await call("GET", "/entries", accountant)).statusCode).toBe(200);
      expect((await call("GET", "/reports/trial-balance?fiscalYearId=x", accountant)).statusCode).not.toBe(403);
      expect((await call("POST", "/guided-operations", accountant, { financialAccountId: ids.fBank, direction: "OUT", amount: "1.00", date: "2026-03-13", label: "x", categoryId: await category("Assurance") })).statusCode).toBe(403);
      expect((await call("POST", "/starter-template", accountant)).statusCode).toBe(403);
    });

    describe("fractionner un montant sur plusieurs catégories", () => {
      const listed = async (id: string) =>
        (await call("GET", `/financial-accounts/${ids.fBank}/transactions`, treasurer)).json().transactions.find((t: { id: string }) => t.id === id);

      it("enregistre en une action 20 € reçus : 10 € de cotisations et 10 € de dons, en une seule écriture à trois lignes", async () => {
        const response = await call("POST", "/guided-operations", treasurer, {
          financialAccountId: ids.fBank,
          direction: "IN",
          amount: "20.00",
          date: "2026-04-02",
          label: "Cotisation et don de Marie",
          splits: [
            { categoryId: await category("Cotisations des adhérents"), amount: "10.00" },
            { categoryId: await category("Dons"), amount: "10.00" },
          ],
        });
        expect(response.statusCode, response.body).toBe(201);
        const entry = (await call("GET", `/entries/${response.json().entryId}`, treasurer)).json();
        expect(entry.status).toBe("POSTED");
        expect(entry.lines).toMatchObject([
          { accountNumber: "512", debit: "20.00", credit: "0.00" },
          { accountNumber: "756", debit: "0.00", credit: "10.00", allocations: [{ amount: "10.00" }] },
          { accountNumber: "754", debit: "0.00", credit: "10.00", allocations: [{ amount: "10.00" }] },
        ]);

        const tx = await listed(response.json().transactionId);
        expect(tx).toMatchObject({ amount: "20.00", accounting: "POSTED", split: true, qualified: true, counterpartAccountId: null });
        const classed = (await call("GET", `/financial-accounts/${ids.fBank}/transactions?qualified=true`, treasurer)).json().transactions;
        const unclassed = (await call("GET", `/financial-accounts/${ids.fBank}/transactions?qualified=false`, treasurer)).json().transactions;
        expect(classed.map((t: { id: string }) => t.id)).toContain(tx.id);
        expect(unclassed.map((t: { id: string }) => t.id)).not.toContain(tx.id);
      });

      it("fractionne un mouvement qui existe déjà, puis l'annulation le remet à classer", async () => {
        const tx = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-04-03", amount: "-60.00", label: "Facture mixte" });
        expect(tx.statusCode, tx.body).toBe(201);
        const booked = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, {
          splits: [
            { categoryId: await category("Assurance"), amount: "40.00" },
            { categoryId: await category("Communication et publicité"), amount: "20.00" },
          ],
        });
        expect(booked.statusCode, booked.body).toBe(201);
        const entry = (await call("GET", `/entries/${booked.json().entryId}`, treasurer)).json();
        expect(entry.lines).toMatchObject([
          { accountNumber: "512", debit: "0.00", credit: "60.00" },
          { accountNumber: "616", debit: "40.00", credit: "0.00" },
          { accountNumber: "623", debit: "20.00", credit: "0.00" },
        ]);
        expect(await listed(tx.json().id)).toMatchObject({ split: true, accounting: "POSTED" });

        const reversed = await call("POST", `/entries/${booked.json().entryId}/reverse`, treasurer, { date: "2026-04-03" });
        expect(reversed.statusCode, reversed.body).toBe(201);
        expect(await listed(tx.json().id)).toMatchObject({ split: false, qualified: false, accounting: "NONE" });
      });

      it("refuse une répartition dont le total n'est pas exact, en disant ce qu'il reste, sans rien laisser derrière", async () => {
        const tx = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-04-04", amount: "20.00", label: "À répartir" });
        const before = await prisma.journalEntry.count();
        const dons = await category("Dons");
        const cotisations = await category("Cotisations des adhérents");
        const short = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, { splits: [{ categoryId: dons, amount: "10.00" }, { categoryId: cotisations, amount: "9.99" }] });
        expect(short.statusCode).toBe(409);
        expect(short.json().message).toContain("19.99");
        expect(short.json().message).toContain("20.00");
        expect(short.json().message).toContain("0.01");
        const over = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, { splits: [{ categoryId: dons, amount: "10.00" }, { categoryId: cotisations, amount: "10.01" }] });
        expect(over.statusCode).toBe(409);
        expect(await prisma.journalEntry.count()).toBe(before);
        expect(await prisma.treasuryMatch.count({ where: { transactionId: tx.json().id } })).toBe(0);
        expect((await listed(tx.json().id))).toMatchObject({ accounting: "NONE", split: false });
      });

      it("refuse une catégorie du mauvais sens, un doublon, une seule part, ou une catégorie en plus des parts", async () => {
        const tx = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-04-05", amount: "20.00", label: "Contrôles" });
        const dons = await category("Dons");
        const assurance = await category("Assurance");
        const book = (payload: object) => call("POST", `/transactions/${tx.json().id}/book`, treasurer, payload);
        const wrongWay = await book({ splits: [{ categoryId: dons, amount: "10.00" }, { categoryId: assurance, amount: "10.00" }] });
        expect(wrongWay.statusCode).toBe(409);
        expect(wrongWay.json().message).toContain("Assurance");
        const duplicate = await book({ splits: [{ categoryId: dons, amount: "10.00" }, { categoryId: dons, amount: "10.00" }] });
        expect(duplicate.statusCode).toBe(409);
        expect(duplicate.json().message).toContain("qu'une fois");
        expect((await book({ splits: [{ categoryId: dons, amount: "20.00" }] })).statusCode).toBe(400);
        expect((await book({ categoryId: dons, splits: [{ categoryId: dons, amount: "10.00" }, { categoryId: await category("Cotisations des adhérents"), amount: "10.00" }] })).statusCode).toBe(400);
        expect((await book({})).statusCode).toBe(400);
        expect((await book({ splits: [{ categoryId: dons, amount: "0.00" }, { categoryId: await category("Cotisations des adhérents"), amount: "20.00" }] })).statusCode).toBe(400);
        expect(await prisma.treasuryMatch.count({ where: { transactionId: tx.json().id } })).toBe(0);
      });

      it("sans le droit de comptabiliser, prépare un brouillon à plusieurs lignes", async () => {
        const tx = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, { operationDate: "2026-04-06", amount: "20.00", label: "Brouillon fractionné" });
        const draft = await call("POST", `/transactions/${tx.json().id}/book`, treasurer, {
          post: false,
          splits: [
            { categoryId: await category("Dons"), amount: "5.50" },
            { categoryId: await category("Cotisations des adhérents"), amount: "14.50" },
          ],
        });
        expect(draft.statusCode, draft.body).toBe(201);
        expect(draft.json()).toMatchObject({ posted: false });
        expect(await listed(tx.json().id)).toMatchObject({ accounting: "IN_PROGRESS", split: true });
      });
    });

    it("l'opération s'annule par contrepassation, comme toute écriture comptabilisée", async () => {
      const response = await call("POST", "/guided-operations", treasurer, {
        financialAccountId: ids.fBank,
        direction: "OUT",
        amount: "4.00",
        date: "2026-03-14",
        label: "Erreur de saisie",
        categoryId: await category("Assurance"),
      });
      const reversed = await call("POST", `/entries/${response.json().entryId}/reverse`, treasurer, { date: "2026-03-14" });
      expect(reversed.statusCode, reversed.body).toBe(201);
    });
  });
});
