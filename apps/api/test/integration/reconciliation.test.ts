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

describe("Trésorerie : rapprochement bancaire par pointage (ADR 0018, base vierge)", () => {
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
    const email = `r-${randomUUID()}@test.invalid`;
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

  const tx = async (amount: string, date: string, label: string, account: string = ids.fBank!) => {
    const response = await call("POST", `/financial-accounts/${account}/transactions`, treasurer, {
      operationDate: date,
      amount,
      label,
      counterpartAccountId: ids.sales,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; version: number };
  };
  /** Comptabilise la transaction : brouillon préparé puis comptabilisé. */
  const account = async (transactionId: string) => {
    const prepared = await call("POST", `/transactions/${transactionId}/entry`, treasurer, {});
    expect(prepared.statusCode, prepared.body).toBe(201);
    const posted = await call("POST", `/entries/${prepared.json().entryId}/post`, treasurer);
    expect(posted.statusCode, posted.body).toBe(200);
    return prepared.json().entryId as string;
  };
  const statement = async (periodEnd: string, closingBalance: string, accountId: string = ids.fBank!) => {
    const response = await call("POST", `/financial-accounts/${accountId}/statements`, treasurer, { periodStart: "2026-01-01", periodEnd, closingBalance });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  };
  const start = (statementId: string, accountId: string = ids.fBank!) =>
    call("POST", `/financial-accounts/${accountId}/reconciliations`, treasurer, { statementId });
  const point = (reconciliationId: string, transactionIds: string[]) => call("POST", `/reconciliations/${reconciliationId}/point`, treasurer, { transactionIds });
  const unpoint = (reconciliationId: string, transactionIds: string[]) => call("POST", `/reconciliations/${reconciliationId}/unpoint`, treasurer, { transactionIds });
  const validate = (reconciliationId: string) => call("POST", `/reconciliations/${reconciliationId}/validate`, treasurer);
  const getTx = async (transactionId: string, accountId: string = ids.fBank!) => {
    const list = (await call("GET", `/financial-accounts/${accountId}/transactions?limit=200`, treasurer)).json();
    return list.transactions.find((t: { id: string }) => t.id === transactionId);
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
    const treasurerRole = await prisma.role.findUniqueOrThrow({ where: { key: "treasurer" } });
    await prisma.role.update({ where: { id: treasurerRole.id }, data: { permissions: [...treasurerRole.permissions, "fiscal-years:close"] } });
    await prisma.settingsVersion.create({ data: { section: "accounting", payload: { projectRequired: false } } });
    treasurer = await userWith("treasurer");
    boardMember = await userWith("board-member");
    reader = await userWith("reader");

    const year = await call("POST", "/fiscal-years", treasurer, { label: "2026", start: "2026-01-01", end: "2026-12-31" });
    expect(year.statusCode).toBe(201);
    ids.year = year.json().id;
    for (const [key, number, label] of [
      ["bank", "5121", "Banque principale"],
      ["cash", "530", "Caisse"],
      ["sales", "706", "Cotisations"],
    ] as const) {
      ids[key] = (await call("POST", "/accounts", treasurer, { number, label })).json().id;
    }
    const open = (name: string, accountId: string, openingBalance: string) =>
      call("POST", "/financial-accounts", treasurer, { name, type: name === "Caisse" ? "CASH" : "BANK", accountId, openedOn: "2026-01-01", openingBalance });
    ids.fBank = (await open("Banque", ids.bank!, "1000.00")).json().id;
    ids.fCash = (await open("Caisse", ids.cash!, "0.00")).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  describe("pointage et validation", () => {
    it("part du solde d'ouverture, calcule l'écart et les opérations en circulation, et bloque tant que ça ne tombe pas juste", async () => {
      const a = await tx("50.00", "2026-03-05", "Cotisation de Marie");
      const b = await tx("-30.00", "2026-03-10", "Fournitures");
      const c = await tx("12.00", "2026-03-25", "Don pas encore sur le relevé");
      ids.a = a.id;
      ids.b = b.id;
      ids.c = c.id;
      const s1 = await statement("2026-03-31", "1020.00");

      const started = await start(s1);
      expect(started.statusCode, started.body).toBe(201);
      const rec = started.json();
      ids.r1 = rec.id;
      expect(rec).toMatchObject({
        status: "IN_PROGRESS",
        openingBalance: "1000.00",
        closingBalance: "1020.00",
        pointedCount: 0,
        pointedBalance: "1000.00",
        gap: "20.00",
        outstandingCount: 3,
        outstandingTotal: "32.00",
        canValidate: false,
      });
      expect(rec.checks.map((x: { code: string }) => x.code)).toContain("GAP");

      // Les transactions candidates : les trois, aucune pointée.
      const candidates = (await call("GET", `/reconciliations/${rec.id}/transactions`, treasurer)).json();
      expect(candidates).toHaveLength(3);
      expect(candidates.every((x: { pointed: boolean }) => !x.pointed)).toBe(true);

      // On pointe A et B : l'écart disparaît, la dernière transaction reste « en circulation ».
      const pointed = await point(rec.id, [a.id, b.id]);
      expect(pointed.statusCode, pointed.body).toBe(200);
      expect(pointed.json()).toMatchObject({ pointedCount: 2, pointedTotal: "20.00", pointedBalance: "1020.00", gap: "0.00", outstandingCount: 1, outstandingTotal: "12.00" });
      // Écart nul mais transactions non comptabilisées : toujours bloqué, et expliqué.
      expect(pointed.json().canValidate).toBe(false);
      expect(pointed.json().checks).toMatchObject([{ code: "UNPOSTED_POINTED", level: "BLOCKING" }]);
      expect(pointed.json().checks[0].message).toContain("Comptabiliser");
      const refused = await validate(rec.id);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("pas comptabilisée");
    });

    it("refuse de valider avec un écart, même si tout est comptabilisé", async () => {
      await account(ids.a!);
      await account(ids.b!);
      // Retirer B du pointage recrée un écart.
      expect((await unpoint(ids.r1!, [ids.b!])).json()).toMatchObject({ gap: "-30.00".replace("-", "") === "30.00" ? "-30.00" : "-30.00" });
      const gap = await validate(ids.r1!);
      expect(gap.statusCode).toBe(409);
      expect(gap.json().message).toContain("écart");
      expect((await point(ids.r1!, [ids.b!])).json().gap).toBe("0.00");
    });

    it("signale en avertissement une écriture sur le compte de banque sans transaction, sans bloquer", async () => {
      const journal = (await call("GET", "/journals", treasurer)).json().find((j: { code: string }) => j.code === "BQ-1");
      const manual = await call("POST", "/entries", treasurer, {
        journalId: journal.id,
        date: "2026-03-12",
        label: "Frais saisis directement",
        lines: [
          { accountId: ids.sales, debit: "0.00", credit: "5.00" },
          { accountId: ids.bank, debit: "5.00", credit: "0.00" },
        ],
      });
      expect(manual.statusCode, manual.body).toBe(201);
      expect((await call("POST", `/entries/${manual.json().id}/post`, treasurer)).statusCode).toBe(200);

      const rec = (await call("GET", `/reconciliations/${ids.r1}`, treasurer)).json();
      expect(rec.checks).toMatchObject([{ code: "ENTRIES_WITHOUT_TRANSACTION", level: "WARNING" }]);
      expect(rec.canValidate).toBe(true);
    });

    it("valide : le rapprochement est figé, les transactions rapprochées ne bougent plus et le compte est dit rapproché", async () => {
      const validated = await validate(ids.r1!);
      expect(validated.statusCode, validated.body).toBe(200);
      expect(validated.json()).toMatchObject({ status: "VALIDATED", gap: "0.00", checks: [], canValidate: false });
      expect(validated.json().validatedAt).not.toBeNull();

      const a = await getTx(ids.a!);
      expect(a).toMatchObject({ financialLock: "RECONCILED", deletable: false, reconciliation: { status: "VALIDATED", periodEnd: "2026-03-31" } });
      expect((await getTx(ids.c!)).reconciliation).toBeNull();

      // Ni montant ni date, ni suppression, ni dépointage.
      expect((await call("PATCH", `/transactions/${ids.a}`, treasurer, { version: a.version, amount: "51.00" })).statusCode).toBe(409);
      expect((await call("DELETE", `/transactions/${ids.a}`, treasurer)).statusCode).toBe(409);
      const un = await unpoint(ids.r1!, [ids.a!]);
      expect(un.statusCode).toBe(409);
      expect(un.json().message).toContain("ne se modifie plus");
      expect(await sqlError(`UPDATE "Transaction" SET "reconciliationId" = NULL WHERE id = '${ids.a}'`)).toContain("annulez d'abord le rapprochement");

      const bank = (await call("GET", `/financial-accounts/${ids.fBank}`, treasurer)).json();
      expect(bank.balances.reconciled).toEqual({ periodEnd: "2026-03-31", closingBalance: "1020.00" });
    });

    it("l'écriture liée à une transaction rapprochée ne se contrepasse pas tant que le rapprochement tient", async () => {
      const a = await getTx(ids.a!);
      const reversed = await call("POST", `/entries/${a.entry.id}/reverse`, treasurer, {});
      expect(reversed.statusCode).toBe(422);
      expect(JSON.stringify(reversed.json())).toContain("déjà rapprochée");
    });
  });

  describe("chaîne des rapprochements", () => {
    it("refuse un relevé qui ne finit pas après le dernier rapprochement validé", async () => {
      const early = await statement("2026-02-28", "1000.00");
      const refused = await start(early);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toContain("après le dernier rapprochement validé");
    });

    it("reprend le solde du dernier rapprochement et n'admet qu'un rapprochement en cours par compte", async () => {
      const s2 = await statement("2026-04-30", "1032.00");
      const started = await start(s2);
      expect(started.statusCode, started.body).toBe(201);
      ids.r2 = started.json().id;
      expect(started.json()).toMatchObject({ openingBalance: "1020.00", closingBalance: "1032.00", gap: "12.00" });
      ids.s2 = s2;

      const another = await start(await statement("2026-05-31", "1032.00"));
      expect(another.statusCode).toBe(409);
      const same = await start(s2);
      expect(same.statusCode).toBe(409);
    });

    it("ne pointe qu'au plus tard à la date du relevé, sur le bon compte, et tout ou rien", async () => {
      const late = await tx("7.00", "2026-05-10", "Trop tard pour ce relevé");
      const cash = await tx("3.00", "2026-04-02", "Autre compte", ids.fCash);
      const tooLate = await point(ids.r2!, [late.id]);
      expect(tooLate.statusCode).toBe(409);
      expect(tooLate.json().message).toContain("au plus tard");
      const other = await point(ids.r2!, [ids.c!, cash.id]);
      expect(other.statusCode).toBe(409);
      expect(other.json().message).toContain("n'appartiennent pas à ce compte");
      // Tout ou rien : la transaction valide n'a pas été pointée.
      expect((await call("GET", `/reconciliations/${ids.r2}`, treasurer)).json().pointedCount).toBe(0);
      // Une transaction déjà rapprochée ailleurs ne se pointe pas.
      const already = await point(ids.r2!, [ids.a!]);
      expect(already.statusCode).toBe(409);
    });

    it("propose de pointer les transactions venues de la banque, sans rien pointer d'autre", async () => {
      await prisma.$executeRawUnsafe(`UPDATE "Transaction" SET "externalId" = 'BANK-1', "source" = 'ofx' WHERE id = '${ids.c}'`);
      const manual = await tx("1.00", "2026-04-03", "Saisie manuelle");
      const result = await call("POST", `/reconciliations/${ids.r2}/point-imported`, treasurer);
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json()).toMatchObject({ pointedCount: 1, pointedTotal: "12.00", gap: "0.00" });
      expect((await getTx(manual.id)).reconciliation).toBeNull();
      await unpoint(ids.r2!, [ids.c!]);
    });

    it("abandonne un rapprochement en cours : le pointage est libéré", async () => {
      expect((await point(ids.r2!, [ids.c!])).statusCode).toBe(200);
      expect((await call("POST", `/reconciliations/${ids.r2}/cancel`, treasurer)).statusCode).toBe(204);
      expect((await getTx(ids.c!)).reconciliation).toBeNull();
      expect((await call("GET", `/reconciliations/${ids.r2}`, treasurer)).statusCode).toBe(404);
    });

    it("annule seulement le dernier rapprochement validé, et libère ses transactions", async () => {
      // Un deuxième rapprochement validé (c comptabilisée puis pointée), puis annulation du premier refusée.
      await account(ids.c!);
      const second = (await start(ids.s2!)).json();
      await point(second.id, [ids.c!]);
      expect((await validate(second.id)).statusCode).toBe(200);

      const notLast = await call("POST", `/reconciliations/${ids.r1}/cancel`, treasurer);
      expect(notLast.statusCode).toBe(409);
      expect(notLast.json().message).toContain("dernier rapprochement");

      const open = (await start(await statement("2026-06-30", "1032.00"))).json();
      const blocked = await call("POST", `/reconciliations/${second.id}/cancel`, treasurer);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().message).toContain("Abandonnez");
      expect((await call("POST", `/reconciliations/${open.id}/cancel`, treasurer)).statusCode).toBe(204);

      expect((await call("POST", `/reconciliations/${second.id}/cancel`, treasurer)).statusCode).toBe(204);
      const list = (await call("GET", `/financial-accounts/${ids.fBank}/reconciliations`, treasurer)).json();
      expect(list.find((r: { id: string }) => r.id === second.id)).toMatchObject({ status: "CANCELLED" });
      expect((await getTx(ids.c!)).reconciliation).toBeNull();
      // Le premier redevient le dernier validé : le compte est dit rapproché au 31 mars.
      expect((await call("GET", `/financial-accounts/${ids.fBank}`, treasurer)).json().balances.reconciled.periodEnd).toBe("2026-03-31");
      expect((await call("POST", `/reconciliations/${second.id}/cancel`, treasurer)).statusCode).toBe(409);
    });
  });

  describe("droits, clôture et garanties en base", () => {
    it("réserve les écritures à imports:post et la lecture à financial-accounts:view", async () => {
      expect((await call("GET", `/financial-accounts/${ids.fBank}/reconciliations`)).statusCode).toBe(401);
      expect((await call("GET", `/financial-accounts/${ids.fBank}/reconciliations`, reader)).statusCode).toBe(403);
      expect((await call("GET", `/financial-accounts/${ids.fBank}/reconciliations`, boardMember)).statusCode).toBe(200);
      expect((await call("POST", `/financial-accounts/${ids.fBank}/reconciliations`, boardMember, { statementId: randomUUID() })).statusCode).toBe(403);
      expect((await call("POST", `/reconciliations/${ids.r1}/cancel`, boardMember)).statusCode).toBe(403);
    });

    it("la clôture avertit, sans bloquer, des comptes non rapprochés jusqu'à la fin de l'exercice", async () => {
      const closing = (await call("GET", `/fiscal-years/${ids.year}/closing`, treasurer)).json();
      const warnings = closing.checks.filter((c: { code: string }) => c.code === "UNRECONCILED_ACCOUNT");
      expect(warnings.map((w: { message: string }) => w.message).join(" ")).toContain("« Banque »");
      expect(warnings.map((w: { message: string }) => w.message).join(" ")).toContain("« Caisse »");
      expect(warnings.every((w: { level: string }) => w.level === "WARNING")).toBe(true);
    });

    it("refuse en SQL un rapprochement incohérent, la suppression d'un validé et le TRUNCATE", async () => {
      const s = await statement("2026-07-31", "1100.00");
      expect(
        await sqlError(`INSERT INTO "Reconciliation"(id, "financialAccountId", "statementId", "periodEnd", "openingBalance", "closingBalance") VALUES (gen_random_uuid(), '${ids.fBank}', '${s}', '2026-07-31', 500.00, 1100.00)`),
      ).toContain("solde de départ");
      expect(await sqlError(`DELETE FROM "Reconciliation" WHERE id = '${ids.r1}'`)).toContain("ne se supprime pas");
      expect(await sqlError(`UPDATE "Reconciliation" SET "closingBalance" = 1.00 WHERE id = '${ids.r1}'`)).toContain("ne changent pas");
      expect(await sqlError(`UPDATE "Reconciliation" SET status = 'IN_PROGRESS' WHERE id = '${ids.r1}'`)).toContain("pas permis");
      expect(await sqlError(`TRUNCATE "Reconciliation"`)).not.toBeNull();
    });
  });
});
