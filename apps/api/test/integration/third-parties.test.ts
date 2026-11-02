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
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";

interface Session {
  cookie: string;
  csrf: string;
}
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Party {
  id: string;
  kind: string;
  name: string;
  archived: boolean;
}
interface Balances {
  fiscalYear: { label: string };
  rows: { id: string; name: string; owedToYou: string; youOwe: string; net: string; accounts: { number: string; net: string }[] }[];
  totals: { owedToYou: string; youOwe: string };
  untracked: { lines: number; net: string };
  carryWarning: string | null;
}

describe("Tiers sur les lignes d'écriture (ADR 0030, base vierge)", () => {
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
    const email = `t-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "T", password: PASSWORD });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD }, remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
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

  const party = async (body: object) => {
    const response = await call("POST", "/third-parties", treasurer, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as Party;
  };
  const entry = async (date: string, lines: { account: string; debit?: string; credit?: string; party?: string | null | undefined }[], post = true) => {
    const created = await call("POST", "/entries", treasurer, {
      journalId: ids.OD,
      date,
      label: "Écriture de test",
      lines: lines.map((l) => ({ accountId: ids[l.account], ...(l.debit && { debit: l.debit }), ...(l.credit && { credit: l.credit }), thirdPartyId: l.party ?? null })),
    });
    expect(created.statusCode, created.body).toBe(201);
    if (post) expect((await call("POST", `/entries/${created.json().id}/post`, treasurer)).statusCode).toBe(200);
    return created.json() as { id: string; lines: { thirdParty: { id: string; name: string } | null }[] };
  };
  const balances = async (year: string) => {
    const response = await call("GET", `/reports/third-parties?fiscalYearId=${ids[year]}`, treasurer);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Balances;
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
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Admin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");

    for (const [key, label, start, end] of [
      ["fy2025", "2025", "2025-01-01", "2025-12-31"],
      ["fy2026", "2026", "2026-01-01", "2026-12-31"],
      ["fy2020", "2020", "2020-01-01", "2020-12-31"],
      ["fy2021", "2021", "2021-01-01", "2021-12-31"],
    ] as const) {
      const created = await call("POST", "/fiscal-years", treasurer, { label, start, end });
      expect(created.statusCode, created.body).toBe(201);
      ids[key] = created.json().id;
    }
    for (const [key, number, label] of [
      ["bank", "512", "Banque"],
      ["owed", "411", "Adhérents"],
      ["grants", "441", "Subventions à recevoir"],
      ["suppliers", "401", "Fournisseurs"],
      ["sales", "706", "Prestations"],
      ["charges", "606", "Achats"],
      ["fonds", "102", "Fonds associatifs"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.OD = (await call("GET", "/journals", treasurer)).json().find((j: { code: string }) => j.code === "OD").id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("le référentiel", () => {
    it("réserve la lecture à entries:view, la création à entries:create, les corrections à l'administration de la comptabilité", async () => {
      expect((await call("GET", "/third-parties")).statusCode).toBe(401);
      expect((await call("GET", "/third-parties", reader)).statusCode).toBe(403);
      expect((await call("GET", "/third-parties", boardMember)).statusCode).toBe(200);
      expect((await call("POST", "/third-parties", boardMember, { kind: "OTHER", name: "X" })).statusCode).toBe(403);
      expect((await call("GET", "/reports/third-parties", reader)).statusCode).toBe(403);
      expect((await call("PATCH", `/third-parties/${randomUUID()}`, boardMember, { note: "x" })).statusCode).toBe(403);
      expect((await call("POST", `/third-parties/${randomUUID()}/archive`, boardMember)).statusCode).toBe(403);
    });

    it("crée un fournisseur ou un autre tiers, valide la saisie et refuse un doublon de nom (sans tenir compte de la casse)", async () => {
      const printer = await party({ kind: "SUPPLIER", name: "Imprimerie Martin", note: "Affiches" });
      expect(printer).toMatchObject({ kind: "SUPPLIER", name: "Imprimerie Martin", archived: false });
      ids.printer = printer.id;
      const duplicate = await call("POST", "/third-parties", treasurer, { kind: "OTHER", name: "IMPRIMERIE martin" });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().message).toContain("existe déjà");
      for (const body of [{ kind: "SUPPLIER" }, { kind: "SUPPLIER", name: " " }, { kind: "INCONNU" }, { kind: "OTHER", name: "A", extra: 1 }, { kind: "MEMBER" }, { kind: "MEMBER", memberId: "pas-un-uuid" }]) {
        expect((await call("POST", "/third-parties", treasurer, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await call("POST", "/third-parties", treasurer, { kind: "MEMBER", memberId: randomUUID() })).statusCode).toBe(404);
      expect((await call("POST", "/third-parties", treasurer, { kind: "FUNDER", funderId: randomUUID() })).statusCode).toBe(404);
    });

    it("désigne un adhérent ou un financeur sans le dupliquer, et lit leur nom en direct", async () => {
      const member = (await call("POST", "/members", treasurer, { firstName: "Marie", lastName: "Dupont" })).json();
      const first = await party({ kind: "MEMBER", memberId: member.id });
      expect(first).toMatchObject({ kind: "MEMBER", name: "Marie Dupont", memberId: member.id });
      ids.marie = first.id;
      const again = await call("POST", "/third-parties", treasurer, { kind: "MEMBER", memberId: member.id });
      expect(again.json().id).toBe(first.id);
      expect(await prisma.thirdParty.count({ where: { memberId: member.id } })).toBe(1);

      const funder = (await call("POST", "/funders", treasurer, { name: "Mairie", type: "LOCAL_AUTHORITY" })).json();
      const funderParty = await party({ kind: "FUNDER", funderId: funder.id });
      ids.mairie = funderParty.id;
      await prisma.funder.update({ where: { id: funder.id }, data: { name: "Mairie de Lyon" } });
      const list = (await call("GET", "/third-parties", treasurer)).json() as Party[];
      expect(list.find((p) => p.id === funderParty.id)!.name).toBe("Mairie de Lyon");
      expect(list.map((p) => p.name)).toEqual([...list.map((p) => p.name)].sort((a, b) => a.localeCompare(b, "fr")));

      const patch = await call("PATCH", `/third-parties/${funderParty.id}`, treasurer, { name: "Autre" });
      expect(patch.statusCode).toBe(409);
      expect(patch.json().message).toContain("propre fiche");
    });

    it("un membre anonymisé n'est plus nommé et ne peut plus être désigné", async () => {
      const former = (await call("POST", "/members", treasurer, { firstName: "Paul", lastName: "Durand" })).json();
      const tier = await party({ kind: "MEMBER", memberId: former.id });
      expect((await call("PATCH", `/members/${former.id}`, treasurer, { version: 1, status: "FORMER" })).statusCode).toBe(200);
      expect((await call("POST", `/members/${former.id}/anonymize`, treasurer, { reason: "Demande de la personne" })).statusCode).toBe(200);
      const list = (await call("GET", "/third-parties", treasurer)).json() as Party[];
      expect(list.find((p) => p.id === tier.id)!.name).toBe("Ancien membre");
      expect(JSON.stringify(list)).not.toContain("Durand");
      const other = (await call("POST", "/members", treasurer, { firstName: "Zoé", lastName: "Petit" })).json();
      await call("PATCH", `/members/${other.id}`, treasurer, { version: 1, status: "FORMER" });
      await call("POST", `/members/${other.id}/anonymize`, treasurer, { reason: "Demande de la personne" });
      const refused = await call("POST", "/third-parties", treasurer, { kind: "MEMBER", memberId: other.id });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("anonymisé");
    });

    it("corrige un fournisseur, l'archive pour de bon, et le masque de la liste par défaut", async () => {
      const patched = await call("PATCH", `/third-parties/${ids.printer}`, treasurer, { name: "Imprimerie Martin SARL", note: "" });
      expect(patched.json()).toMatchObject({ name: "Imprimerie Martin SARL" });
      const spare = await party({ kind: "OTHER", name: "Ancien prestataire" });
      const archived = await call("POST", `/third-parties/${spare.id}/archive`, treasurer);
      expect(archived.json().archived).toBe(true);
      expect((await call("POST", `/third-parties/${spare.id}/archive`, treasurer)).statusCode).toBe(409);
      expect((await call("PATCH", `/third-parties/${spare.id}`, treasurer, { note: "x" })).statusCode).toBe(409);
      expect(((await call("GET", "/third-parties", treasurer)).json() as Party[]).map((p) => p.id)).not.toContain(spare.id);
      expect(((await call("GET", "/third-parties?includeArchived=true", treasurer)).json() as Party[]).map((p) => p.id)).toContain(spare.id);
      ids.archived = spare.id;
    });
  });

  describe("sur les lignes d'écriture", () => {
    it("enregistre le tiers d'une ligne et le restitue avec son nom", async () => {
      const draft = await entry("2026-02-01", [{ account: "owed", debit: "100.00", party: ids.marie }, { account: "sales", credit: "100.00" }], false);
      expect(draft.lines[0]!.thirdParty).toMatchObject({ id: ids.marie, name: "Marie Dupont" });
      expect(draft.lines[1]!.thirdParty).toBeNull();
      const fetched = (await call("GET", `/entries/${draft.id}`, treasurer)).json();
      expect(fetched.lines[0].thirdParty.name).toBe("Marie Dupont");
      ids.draft = draft.id;
    });

    it("refuse un tiers inconnu ou archivé, avec un message qui dit quoi faire", async () => {
      const lines = (party: string) => [{ accountId: ids.owed, debit: "5.00", thirdPartyId: party }, { accountId: ids.sales, credit: "5.00" }];
      const unknown = await call("POST", "/entries", treasurer, { journalId: ids.OD, date: "2026-02-02", label: "x", lines: lines(randomUUID()) });
      expect(unknown.statusCode).toBe(409);
      expect(unknown.json().message).toContain("n'existe pas");
      const archived = await call("POST", "/entries", treasurer, { journalId: ids.OD, date: "2026-02-02", label: "x", lines: lines(ids.archived!) });
      expect(archived.statusCode).toBe(409);
      expect(archived.json().message).toContain("archivé");
      expect((await call("POST", "/entries", treasurer, { journalId: ids.OD, date: "2026-02-02", label: "x", lines: [{ ...lines("pas-un-uuid")[0] }, lines(ids.marie!)[1]] })).statusCode).toBe(400);
      const draft = (await call("GET", `/entries/${ids.draft}`, treasurer)).json();
      const update = await call("PUT", `/entries/${ids.draft}`, treasurer, {
        version: draft.version,
        journalId: draft.journalId,
        date: draft.date,
        label: draft.label,
        lines: [{ accountId: ids.owed, debit: "100.00", thirdPartyId: ids.archived }, { accountId: ids.sales, credit: "100.00" }],
      });
      expect(update.statusCode).toBe(409);
    });

    it("le tiers d'une ligne comptabilisée ne change plus, et la contrepassation le reprend", async () => {
      expect((await call("POST", `/entries/${ids.draft}/post`, treasurer)).statusCode).toBe(200);
      expect(await sqlError(`UPDATE "JournalLine" SET "thirdPartyId" = NULL WHERE "entryId" = '${ids.draft}'`)).toContain("immuables");
      const reversal = await call("POST", `/entries/${ids.draft}/reverse`, treasurer, { date: "2026-02-03" });
      expect(reversal.statusCode, reversal.body).toBe(201);
      expect(reversal.json().lines[0].thirdParty).toMatchObject({ id: ids.marie });
    });
  });

  describe("ce qu'on vous doit et ce que vous devez, par personne", () => {
    it("additionne par tiers les comptes de tiers de l'exercice, sans compter une écriture contrepassée", async () => {
      await entry("2026-03-01", [{ account: "owed", debit: "100.00", party: ids.marie }, { account: "sales", credit: "100.00" }]);
      await entry("2026-03-02", [{ account: "owed", debit: "40.00", party: ids.marie }, { account: "sales", credit: "40.00" }]);
      await entry("2026-03-03", [{ account: "grants", debit: "500.00", party: ids.mairie }, { account: "sales", credit: "500.00" }]);
      await entry("2026-03-04", [{ account: "charges", debit: "120.00" }, { account: "suppliers", credit: "120.00", party: ids.printer }]);
      await entry("2026-03-05", [{ account: "owed", debit: "7.00" }, { account: "sales", credit: "7.00" }]);

      const report = await balances("fy2026");
      const byName = Object.fromEntries(report.rows.map((r) => [r.name, r]));
      // Marie : 100 (écriture de février contrepassée = 0) + 100 + 40 = 140 ; la mairie : 500 ; l'imprimeur : on lui doit 120.
      expect(byName["Marie Dupont"]).toMatchObject({ owedToYou: "140.00", youOwe: "0.00", net: "140.00" });
      expect(byName["Mairie de Lyon"]).toMatchObject({ owedToYou: "500.00" });
      expect(byName["Imprimerie Martin SARL"]).toMatchObject({ owedToYou: "0.00", youOwe: "120.00", net: "-120.00" });
      expect(byName["Imprimerie Martin SARL"]!.accounts).toEqual([{ number: "401", label: "Fournisseurs", net: "-120.00" }]);
      expect(report.totals).toEqual({ owedToYou: "640.00", youOwe: "120.00" });
      expect(report.untracked).toEqual({ lines: 1, net: "7.00" });
      expect(report.rows.map((r) => r.name)).toEqual([...report.rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b, "fr")));
    });

    it("avertit quand l'exercice précédent n'est pas clôturé, valide sa requête et prend l'exercice ouvert par défaut", async () => {
      expect((await balances("fy2026")).carryWarning).toContain("n'est pas clôturé");
      expect((await balances("fy2020")).carryWarning).toBeNull();
      expect((await balances("fy2025")).rows).toEqual([]);
      expect((await balances("fy2025")).carryWarning).toContain("« 2021 »");
      expect((await call("GET", "/reports/third-parties?fiscalYearId=pas-un-uuid", treasurer)).statusCode).toBe(400);
      expect((await call("GET", `/reports/third-parties?fiscalYearId=${randomUUID()}`, treasurer)).statusCode).toBe(404);
      expect((await call("GET", "/reports/third-parties?x=1", treasurer)).statusCode).toBe(400);
      expect((await call("GET", "/reports/third-parties", treasurer)).json().fiscalYear.label).toBe("2026");
    });

    it("la progression signale les lignes de tiers sans tiers, sans rien bloquer", async () => {
      const progress = (await call("GET", "/recovery-progress", treasurer)).json();
      const year = progress.years.find((y: { fiscalYear: { label: string } }) => y.fiscalYear.label === "2026");
      const missing = year.anomalies.find((a: { code: string }) => a.code === "THIRD_PARTY_MISSING");
      expect(missing).toMatchObject({ level: "WARNING", count: 1, fix: "THIRD_PARTIES", financialAccountId: null });
      expect(missing.message).toContain("pas bloquant");
    });
  });

  describe("à la clôture, le suivi par personne est reporté", () => {
    it("reporte une ligne d'à-nouveaux par compte et par tiers, et les soldes de l'exercice suivant sont les mêmes", async () => {
      await entry("2020-02-01", [{ account: "bank", debit: "1000.00" }, { account: "fonds", credit: "1000.00" }]);
      await entry("2020-03-01", [{ account: "owed", debit: "100.00", party: ids.marie }, { account: "sales", credit: "100.00" }]);
      await entry("2020-03-02", [{ account: "owed", debit: "60.00", party: ids.mairie }, { account: "sales", credit: "60.00" }]);
      await entry("2020-03-03", [{ account: "owed", debit: "7.00" }, { account: "sales", credit: "7.00" }]);
      await entry("2020-03-04", [{ account: "charges", debit: "30.00" }, { account: "suppliers", credit: "30.00", party: ids.printer }]);

      const before = await balances("fy2020");
      expect((await call("POST", `/fiscal-years/${ids.fy2020}/closing/start`, treasurer)).statusCode).toBe(200);
      const closed = await call("POST", `/fiscal-years/${ids.fy2020}/closing/close`, treasurer, { surplusAccountId: ids.fonds });
      expect(closed.statusCode, closed.body).toBe(200);

      const opening = (await call("GET", `/entries/${closed.json().openingEntryId}`, treasurer)).json();
      const withParty = opening.lines.filter((l: { thirdParty: unknown }) => l.thirdParty);
      expect(withParty.map((l: { accountNumber: string; thirdParty: { name: string } }) => [l.accountNumber, l.thirdParty.name]).sort()).toEqual([
        ["401", "Imprimerie Martin SARL"],
        ["411", "Marie Dupont"],
        ["411", "Mairie de Lyon"],
      ].sort());
      // La part sans tiers du compte 411 (7,00) est reportée sur sa propre ligne.
      expect(opening.lines.filter((l: { accountNumber: string; thirdParty: unknown }) => l.accountNumber === "411" && !l.thirdParty)).toHaveLength(1);
      expect(Number(opening.totalDebit)).toBe(Number(opening.totalCredit));

      const after = await balances("fy2021");
      const pick = (report: Balances) => Object.fromEntries(report.rows.map((r) => [r.name, r.net]));
      expect(pick(after)).toEqual(pick(before));
      expect(after.untracked.net).toBe("7.00");
    });

    it("l'aperçu de clôture compte les comptes reportés, pas les lignes par tiers", async () => {
      const preview = (await call("GET", `/fiscal-years/${ids.fy2021}/closing`, treasurer)).json();
      expect(preview.preview.accountCount).toBe(4);
    });
  });

  describe("garanties en base", () => {
    it("un tiers ne se supprime pas, ne change ni de type ni de lien, ne se réactive pas, et TRUNCATE est refusé", async () => {
      expect(await sqlError(`DELETE FROM "ThirdParty" WHERE "id" = '${ids.printer}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`UPDATE "ThirdParty" SET "kind" = 'OTHER' WHERE "id" = '${ids.printer}'`)).toContain("ne changent pas");
      expect(await sqlError(`UPDATE "ThirdParty" SET "archivedAt" = NULL WHERE "id" = '${ids.archived}'`)).toContain("ne se réactive pas");
      expect(await sqlError(`TRUNCATE "ThirdParty" CASCADE`)).toMatch(/TRUNCATE|refus|interdit/i);
    });

    it("la cohérence du type est garantie : un adhérent a un membre, un fournisseur n'en a pas, un nom ne se répète pas", async () => {
      expect(await sqlError(`INSERT INTO "ThirdParty" ("id","kind","name") VALUES (gen_random_uuid(),'MEMBER','Sans membre')`)).toContain("ThirdParty_kind_consistent");
      const member = (await call("POST", "/members", treasurer, { firstName: "Léa", lastName: "Roux" })).json();
      expect(await sqlError(`INSERT INTO "ThirdParty" ("id","kind","name","memberId") VALUES (gen_random_uuid(),'SUPPLIER','Faux','${member.id}')`)).toContain("ThirdParty_kind_consistent");
      expect(await sqlError(`INSERT INTO "ThirdParty" ("id","kind","name") VALUES (gen_random_uuid(),'OTHER','imprimerie martin sarl')`)).toContain("ThirdParty_name_unique");
    });
  });
});
