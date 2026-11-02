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

type Method = "GET" | "POST";

describe("États de synthèse : compte de résultat et bilan (ADR 0020, base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let contributor: Session;
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
    const email = `s-${randomUUID()}@test.invalid`;
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

  /** Écriture comptabilisée en une fois : débit sur un compte, crédit sur un autre. */
  const entry = async (date: string, label: string, debit: string, credit: string, amount: string) => {
    const created = await call("POST", "/entries", treasurer, {
      journalId: ids.od,
      date,
      label,
      lines: [
        { accountId: ids[debit], debit: amount, credit: "0.00" },
        { accountId: ids[credit], debit: "0.00", credit: amount },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const posted = await call("POST", `/entries/${created.json().id}/post`, treasurer);
    expect(posted.statusCode, posted.body).toBe(200);
    return created.json().id as string;
  };
  const income = (year: string, ...session: (Session | undefined)[]) => call("GET", `/reports/income-statement?fiscalYearId=${ids[year]}`, session.length > 0 ? session[0] : treasurer);
  const balance = (year: string, ...session: (Session | undefined)[]) => call("GET", `/reports/balance-sheet?fiscalYearId=${ids[year]}`, session.length > 0 ? session[0] : treasurer);
  const row = (groups: { rows: { code: string; amount: string; previous: string | null }[] }[], code: string) => groups.flatMap((g) => g.rows).find((r) => r.code === code)!;

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
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    contributor = await userWith("contributor");

    ids.y2025 = (await call("POST", "/fiscal-years", treasurer, { label: "2025", start: "2025-01-01", end: "2025-12-31" })).json().id;
    ids.y2026 = (await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" })).json().id;
    for (const [key, number, label] of [
      ["bank", "512", "Banque"],
      ["funds", "102", "Fonds associatifs"],
      ["cotis", "756", "Cotisations"],
      ["sales", "706", "Prestations"],
      ["purchases", "606", "Achats"],
      ["supplier", "401", "Fournisseurs"],
      ["volunteer", "864", "Bénévolat"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    ids.od = (await prisma.journal.findFirstOrThrow({ where: { code: "OD" } })).id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("2025 : pas d'exercice précédent, la colonne N−1 est explicitement absente", async () => {
    await entry("2025-01-01", "Fonds apportés", "bank", "funds", "1000.00");
    await entry("2025-03-10", "Cotisations de l'année", "bank", "cotis", "200.00");
    await entry("2025-06-02", "Achat de matériel", "purchases", "supplier", "50.00");

    const statement = (await income("y2025")).json();
    expect(statement.previous).toBeNull();
    expect(statement.fiscalYear).toMatchObject({ label: "2025", start: "2025-01-01", end: "2025-12-31" });
    expect(statement).toMatchObject({ products: "200.00", charges: "50.00", result: "150.00", previousResult: null });
    expect(row(statement.sections, "PRO_COTIS")).toEqual({ code: "PRO_COTIS", label: "Cotisations", amount: "200.00", previous: null });
    expect(statement.intermediate[0]).toMatchObject({ code: "OPERATING", amount: "150.00", previous: null });
    // Rangés par défaut selon leur numéro : l'état le dit.
    expect(statement.defaulted.map((a: { number: string }) => a.number)).toEqual(["606", "756"]);

    const sheet = (await balance("y2025")).json();
    expect(sheet).toMatchObject({ totalAssets: "1200.00", totalLiabilities: "1200.00", balanced: true, difference: "0.00", result: "150.00", previous: null });
    expect(row(sheet.assets, "ACT_DISPO").amount).toBe("1200.00");
    expect(row(sheet.liabilities, "PAS_FONDS").amount).toBe("1000.00");
    expect(row(sheet.liabilities, "PAS_RESULTAT").amount).toBe("150.00");
    expect(row(sheet.liabilities, "PAS_DETTES")).toMatchObject({ amount: "50.00", previous: null });
  });

  it("2026 : l'exercice précédent est en regard, y compris les montants d'un compte absent de l'année courante", async () => {
    await entry("2026-02-01", "Prestations", "bank", "sales", "80.00");
    await entry("2026-04-01", "Règlement fournisseur", "supplier", "bank", "50.00");

    const statement = (await income("y2026")).json();
    expect(statement.previous).toMatchObject({ label: "2025" });
    expect(statement).toMatchObject({ products: "80.00", charges: "0.00", result: "80.00", previousResult: "150.00" });
    expect(row(statement.sections, "PRO_VENTES")).toMatchObject({ amount: "80.00", previous: "0.00" });
    expect(row(statement.sections, "PRO_COTIS")).toMatchObject({ amount: "0.00", previous: "200.00" });
    expect(row(statement.sections, "CHG_ACHATS")).toMatchObject({ amount: "0.00", previous: "50.00" });
    expect(statement.sections.find((s: { code: string }) => s.code === "OPERATING_PRODUCTS")).toMatchObject({ total: "80.00", previousTotal: "200.00" });
  });

  it("le bilan de 2026 compare à 2025, reste équilibré et avertit que 2025 n'est pas clôturé (pas de report)", async () => {
    const sheet = (await balance("y2026")).json();
    // 2026 seul, sans à-nouveaux : banque +80 −50, règlement fournisseur sans sa dette (comptabilisée en 2025) = créance de 50.
    expect(sheet).toMatchObject({ totalAssets: "80.00", totalLiabilities: "80.00", balanced: true, previousTotalAssets: "1200.00", previousTotalLiabilities: "1200.00" });
    expect(row(sheet.assets, "ACT_DISPO")).toMatchObject({ amount: "30.00", previous: "1200.00" });
    expect(row(sheet.assets, "ACT_CREANCES").amount).toBe("50.00");
    expect(sheet.carryWarning).toContain("« 2025 » n'est pas clôturé");
    expect((await income("y2025")).json().carryWarning).toBeNull();
  });

  it("compte les brouillons sans les prendre en compte", async () => {
    const draft = await call("POST", "/entries", treasurer, {
      journalId: ids.od,
      date: "2026-05-01",
      label: "Brouillon",
      lines: [
        { accountId: ids.bank, debit: "999.00", credit: "0.00" },
        { accountId: ids.sales, debit: "0.00", credit: "999.00" },
      ],
    });
    expect(draft.statusCode).toBe(201);
    const statement = (await income("y2026")).json();
    expect(statement.draftEntries).toBe(1);
    expect(statement.products).toBe("80.00");
    await app.inject({ method: "DELETE", url: `/entries/${draft.json().id}`, headers: { cookie: treasurer.cookie, "x-csrf-token": treasurer.csrf } });
  });

  it("liste les comptes de classe 8 qu'aucune rubrique n'accueille et dit que le bilan est déséquilibré", async () => {
    await entry("2026-06-01", "Bénévolat valorisé", "volunteer", "funds", "10.00");
    const statement = (await income("y2026")).json();
    expect(statement.unclassified).toEqual([{ number: "864", label: "Bénévolat", amount: "10.00" }]);
    const sheet = (await balance("y2026")).json();
    expect(sheet.unclassified).toEqual([{ number: "864", label: "Bénévolat", amount: "10.00" }]);
    expect(sheet.balanced).toBe(false);
    expect(sheet.difference).toBe("-10.00");
  });

  it("réserve les synthèses à reports:view et refuse un exercice inconnu ou invalide", async () => {
    expect((await income("y2026", undefined)).statusCode).toBe(401);
    expect((await income("y2026", contributor)).statusCode).toBe(403);
    expect((await balance("y2026", contributor)).statusCode).toBe(403);
    expect((await call("GET", `/reports/income-statement?fiscalYearId=${randomUUID()}`, treasurer)).statusCode).toBe(404);
    expect((await call("GET", "/reports/balance-sheet?fiscalYearId=pas-un-uuid", treasurer)).statusCode).toBe(400);
    expect((await call("GET", "/reports/balance-sheet", treasurer)).statusCode).toBe(400);
  });
});
