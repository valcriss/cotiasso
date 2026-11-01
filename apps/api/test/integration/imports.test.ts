import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/ofx/${name}`, import.meta.url)));

interface Session {
  cookie: string;
  csrf: string;
}

/** Corps multipart/form-data sans dépendance. */
function multipart(files: { name: string; content: Buffer }[]) {
  const boundary = `----cotiasso${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Relevé OFX 1.x minimal : un compte en euro et les opérations données. */
function ofx(lines: { fitId?: string; date: string; amount: string; name: string }[], extra = ""): Buffer {
  const body = lines
    .map((l) => `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${l.date}<TRNAMT>${l.amount}${l.fitId ? `<FITID>${l.fitId}` : ""}<NAME>${l.name}</STMTTRN>`)
    .join("");
  return Buffer.from(
    `OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n\n<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</STATUS></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STATUS><CODE>0</STATUS><STMTRS><CURDEF>EUR<BANKACCTFROM><BANKID>1<ACCTID>00099887766</BANKACCTFROM><BANKTRANLIST><DTSTART>20260101<DTEND>20261231${body}</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>${extra}`,
    "latin1",
  );
}

describe("Import OFX : analyse, doublons, rapprochement et confirmation (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let users: UsersService;
  let treasurer: Session;
  let boardMember: Session;
  let reader: Session;
  const ids: Record<string, string> = {};

  const call = (method: "GET" | "POST", url: string, session?: Session, payload?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
      ...(payload !== undefined && { payload: payload as object }),
    });

  const upload = (session: Session | undefined, accountId: string, content: Buffer, name = "releve.ofx") => {
    const { payload, contentType } = multipart([{ name, content }]);
    return app.inject({
      method: "POST",
      url: `/financial-accounts/${accountId}/imports`,
      payload,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { "content-type": contentType, ...(session && { cookie: session.cookie, "x-csrf-token": session.csrf }) },
    });
  };
  const analyze = async (content: Buffer, accountId = ids.fBank!) => {
    const response = await upload(treasurer, accountId, content);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const commit = (importId: string, body: object = {}) => call("POST", `/imports/${importId}/commit`, treasurer, body);

  const userWith = async (roleKey: string): Promise<Session> => {
    const email = `i-${randomUUID()}@test.invalid`;
    const user = await users.createUser({ email, displayName: "I", password: PASSWORD });
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
      return String((error as Error).message);
    }
    return null;
  };
  const transactions = async (accountId = ids.fBank!) =>
    prisma.transaction.findMany({ where: { financialAccountId: accountId }, orderBy: [{ operationDate: "asc" }, { amount: "asc" }] });
  const manual = async (body: object) => {
    const response = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };

  beforeAll(async () => {
    db = await createTempDatabase();
    const env: AppEnv = { ...readEnv(), databaseUrl: db.url, cookieSecure: true };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ENV).useValue(env).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app, env);
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

    ids.bank = (await call("POST", "/accounts", treasurer, { number: "512", label: "Banque" })).json().id;
    ids.fBank = (
      await call("POST", "/financial-accounts", treasurer, { name: "Compte courant", type: "BANK", accountId: ids.bank, openedOn: "2026-01-01", openingBalance: "1000.00" })
    ).json().id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("réserve l'envoi à imports:post et la consultation à financial-accounts:view", async () => {
    expect((await upload(undefined, ids.fBank!, fixture("releve-sgml-1252.ofx"))).statusCode).toBe(401);
    expect((await upload(boardMember, ids.fBank!, fixture("releve-sgml-1252.ofx"))).statusCode).toBe(403);
    expect((await call("GET", `/financial-accounts/${ids.fBank}/imports`, boardMember)).statusCode).toBe(200);
    expect((await call("GET", `/financial-accounts/${ids.fBank}/imports`, reader)).statusCode).toBe(403);
    expect((await call("POST", `/imports/${randomUUID()}/commit`, boardMember, {})).statusCode).toBe(403);
    expect((await upload(treasurer, randomUUID(), fixture("releve-sgml-1252.ofx"))).statusCode).toBe(404);
  });

  describe("analyse d'un relevé OFX 1.x en Windows-1252", () => {
    it("classe les lignes sans créer aucune transaction et conserve les données brutes", async () => {
      const batch = await analyze(fixture("releve-sgml-1252.ofx"), ids.fBank!);
      ids.batch1 = batch.id;
      expect(batch).toMatchObject({
        status: "ANALYZED",
        format: "SGML",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        ledgerBalance: "1089.40",
        accountHint: "5678",
        summary: { total: 4, new: 3, duplicate: 0, probableMatch: 0, error: 1 },
      });
      expect(batch.lines.map((l: { status: string }) => l.status)).toEqual(["NEW", "NEW", "NEW", "ERROR"]);
      expect(batch.lines[3].errors[0]).toContain("FITID");
      expect(batch.lines[0]).toMatchObject({ operationDate: "2026-03-05", amount: "150.00", label: "VIREMENT M. DUPONT — Cotisation annuelle" });

      // L'analyse n'a rien créé, mais a gardé la ligne telle que lue (virgule décimale, heure comprise).
      expect(await transactions()).toHaveLength(0);
      const stored = await prisma.importLine.findFirstOrThrow({ where: { batchId: batch.id, position: 1 } });
      expect(stored.raw).toMatchObject({ TRNAMT: "150,00", DTPOSTED: "20260305120000", FITID: "2026030501" });
    });

    it("confirme sans décision : crée les lignes nouvelles, ignore l'erreur, ne fusionne pas deux paiements identiques", async () => {
      const response = await commit(ids.batch1!);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ status: "COMMITTED", summary: { result: { created: 3, linked: 0, skipped: 1 } } });
      const created = await transactions();
      expect(created.map((t) => [t.operationDate.toISOString().slice(0, 10), t.amount.toFixed(2), t.externalId])).toEqual([
        ["2026-03-05", "150.00", "2026030501"],
        ["2026-03-10", "-42.30", "2026031001"],
        ["2026-03-10", "-42.30", "2026031002"],
      ]);
      expect(created.every((t) => t.origin === "IMPORT" && t.source === "OFX")).toBe(true);
      expect(response.json().lines.map((l: { decision: string }) => l.decision)).toEqual(["CREATE", "CREATE", "CREATE", "SKIP"]);
    });

    it("refuse de confirmer ou d'annuler deux fois", async () => {
      expect((await commit(ids.batch1!)).statusCode).toBe(409);
      expect((await call("POST", `/imports/${ids.batch1}/cancel`, treasurer)).statusCode).toBe(409);
    });
  });

  describe("réimport du même relevé (CA-01)", () => {
    it("refuse le même fichier, octet pour octet, avec un message explicite", async () => {
      const response = await upload(treasurer, ids.fBank!, fixture("releve-sgml-1252.ofx"));
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("déjà été importé");
      expect(await prisma.importBatch.count()).toBe(1);
    });

    it("reconnaît tous les mouvements d'un fichier modifié comme doublons et n'en crée aucun", async () => {
      const variant = Buffer.concat([fixture("releve-sgml-1252.ofx"), Buffer.from("\r\n")]);
      const batch = await analyze(variant);
      expect(batch.summary).toMatchObject({ total: 4, new: 0, duplicate: 3, probableMatch: 0, error: 1 });
      expect(batch.lines.filter((l: { status: string }) => l.status === "DUPLICATE").every((l: { matchedTransactionId: string | null }) => l.matchedTransactionId)).toBe(true);

      // Créer un doublon n'est pas une décision permise.
      const forced = await commit(batch.id, { decisions: [{ lineId: batch.lines[0].id, action: "CREATE" }] });
      expect(forced.statusCode).toBe(422);
      expect(forced.json().message).toContain("doublon");
      expect(await transactions()).toHaveLength(3);

      const result = await commit(batch.id);
      expect(result.json().summary.result).toEqual({ created: 0, linked: 0, skipped: 4 });
      expect(await transactions()).toHaveLength(3);
    });

    it("refuse un identifiant bancaire répété dans le fichier et une opération avant l'ouverture du compte", async () => {
      const batch = await analyze(
        ofx([
          { fitId: "R1", date: "20260501", amount: "-5.00", name: "Une fois" },
          { fitId: "R1", date: "20260502", amount: "-6.00", name: "Répété" },
          { fitId: "R2", date: "20251231", amount: "-7.00", name: "Trop ancien" },
        ]),
      );
      expect(batch.summary).toMatchObject({ new: 1, error: 2 });
      expect(batch.lines[1].errors[0]).toContain("répété");
      expect(batch.lines[2].errors[0]).toContain("ouverture");
      await call("POST", `/imports/${batch.id}/cancel`, treasurer);
    });
  });

  describe("rapprochement avec une saisie manuelle (CA-02)", () => {
    it("propose le rapprochement sans le décider, et exige un choix explicite", async () => {
      const membership = await manual({ operationDate: "2026-04-03", amount: "75.00", label: "Adhésion Léa" });
      const rent = await manual({ operationDate: "2026-04-15", amount: "-120.50", label: "Salle d'avril" });
      ids.membership = membership.id;
      ids.rent = rent.id;
      // Hors fenêtre : ni même montant ni date proche, jamais proposée.
      await manual({ operationDate: "2026-04-30", amount: "75.00", label: "Trop loin" });

      const batch = await analyze(fixture("releve-xml-utf8.ofx"));
      ids.batch2 = batch.id;
      expect(batch).toMatchObject({ format: "XML", summary: { total: 2, new: 0, probableMatch: 2 } });
      expect(batch.lines[0].candidates.map((c: { transactionId: string }) => c.transactionId)).toEqual([ids.membership]);
      expect(batch.lines[1].candidates.map((c: { transactionId: string }) => c.transactionId)).toEqual([ids.rent]);
      expect(batch.lines[1]).toMatchObject({ reference: "0042", label: "Location de salle — Avril" });

      const undecided = await commit(batch.id);
      expect(undecided.statusCode).toBe(422);
      expect(undecided.json().message).toContain("2 ligne(s)");
      expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } }).then((b) => b.status)).toBe("ANALYZED");
    });

    it("refuse les décisions incohérentes", async () => {
      const batch = await call("GET", `/imports/${ids.batch2}`, treasurer).then((r) => r.json());
      const [first, second] = batch.lines;
      const decide = (decisions: object[]) => commit(ids.batch2!, { decisions });
      expect((await decide([{ lineId: first.id, action: "LINK", transactionId: ids.rent }, { lineId: second.id, action: "SKIP" }])).statusCode).toBe(422);
      expect((await decide([{ lineId: first.id, action: "LINK" }, { lineId: second.id, action: "SKIP" }])).statusCode).toBe(422);
      expect((await decide([{ lineId: first.id, action: "LINK", transactionId: ids.membership }, { lineId: first.id, action: "SKIP" }, { lineId: second.id, action: "SKIP" }])).statusCode).toBe(422);
      expect((await decide([{ lineId: randomUUID(), action: "SKIP" }, { lineId: first.id, action: "SKIP" }, { lineId: second.id, action: "SKIP" }])).statusCode).toBe(422);
      expect((await decide([{ lineId: first.id, action: "ECRASER" }])).statusCode).toBe(400);
      expect((await prisma.transaction.findUniqueOrThrow({ where: { id: ids.membership! } })).externalId).toBeNull();
    });

    it("rattache l'identifiant bancaire à la saisie choisie et crée l'autre ligne comme paiement distinct", async () => {
      const batch = await call("GET", `/imports/${ids.batch2}`, treasurer).then((r) => r.json());
      const [first, second] = batch.lines;
      const response = await commit(ids.batch2!, {
        decisions: [
          { lineId: first.id, action: "LINK", transactionId: ids.membership },
          { lineId: second.id, action: "CREATE" },
        ],
        recordStatement: true,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().summary.result).toEqual({ created: 1, linked: 1, skipped: 0 });

      // La saisie manuelle garde ses données et reçoit l'identifiant bancaire ; l'autre ligne devient une transaction à part.
      const linked = await prisma.transaction.findUniqueOrThrow({ where: { id: ids.membership! } });
      expect(linked).toMatchObject({ origin: "MANUAL", source: "OFX", externalId: "2026040201", label: "Adhésion Léa", version: 2 });
      expect(linked.operationDate.toISOString().slice(0, 10)).toBe("2026-04-03");
      expect((await prisma.transaction.findUniqueOrThrow({ where: { id: ids.rent! } })).externalId).toBeNull();
      expect(await prisma.transaction.count({ where: { externalId: "2026041501" } })).toBe(1);

      // Le solde du fichier est enregistré comme preuve datée, sans rapprocher le compte.
      const statement = await prisma.bankStatement.findFirstOrThrow({ where: { financialAccountId: ids.fBank! } });
      expect(statement.closingBalance.toFixed(2)).toBe("1043.90");
      expect(statement.periodEnd.toISOString().slice(0, 10)).toBe("2026-04-30");
    });

    it("fige la saisie rattachée : ni montant, ni date modifiables, ni suppression", async () => {
      const edit = await call("POST", `/financial-accounts/${ids.fBank}/transactions`, treasurer, {});
      expect(edit.statusCode).toBe(400);
      const patch = (body: object) => app.inject({ method: "PATCH", url: `/transactions/${ids.membership}`, headers: { cookie: treasurer.cookie, "x-csrf-token": treasurer.csrf }, payload: body });
      expect((await patch({ version: 2, amount: "76.00" })).statusCode).toBe(409);
      expect((await patch({ version: 2, operationDate: "2026-04-04" })).statusCode).toBe(409);
      const label = await patch({ version: 2, label: "Adhésion de Léa Martin" });
      expect(label.statusCode, label.body).toBe(200);
      expect(label.json()).toMatchObject({ bankIdentified: true, label: "Adhésion de Léa Martin" });
      const deleted = await app.inject({ method: "DELETE", url: `/transactions/${ids.membership}`, headers: { cookie: treasurer.cookie, "x-csrf-token": treasurer.csrf } });
      expect(deleted.statusCode).toBe(409);
      expect(await sqlError(`DELETE FROM "Transaction" WHERE id='${ids.membership}'`)).toContain("rattachée à un relevé");
      expect(await sqlError(`UPDATE "Transaction" SET "externalId"='AUTRE' WHERE id='${ids.membership}'`)).toContain("identifiant bancaire");
    });
  });

  describe("fichiers refusés", () => {
    it("refuse explicitement les variantes non prises en charge avec leur raison", async () => {
      const card = Buffer.from("OFXHEADER:100\n\n<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>");
      const refused = await upload(treasurer, ids.fBank!, card);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().message).toContain("carte bancaire");
      expect((await upload(treasurer, ids.fBank!, Buffer.from("date;libellé;montant"))).json().message).toContain("pas un fichier OFX");
      expect((await upload(treasurer, ids.fBank!, ofx([]))).json().message).toContain("aucune opération");
      const dtd = Buffer.from(`<?xml version="1.0"?><!DOCTYPE OFX [<!ENTITY x SYSTEM "file:///etc/passwd">]><OFX></OFX>`);
      expect((await upload(treasurer, ids.fBank!, dtd)).statusCode).toBe(422);
      expect(await prisma.importBatch.count({ where: { status: "ANALYZED" } })).toBe(0);
    });

    it("refuse un fichier trop gros, un envoi sans fichier ou hors multipart", async () => {
      expect((await upload(treasurer, ids.fBank!, Buffer.alloc(5 * 1024 * 1024 + 10, "a"))).statusCode).toBe(413);
      const empty = multipart([]);
      const none = await app.inject({
        method: "POST",
        url: `/financial-accounts/${ids.fBank}/imports`,
        payload: empty.payload,
        headers: { "content-type": empty.contentType, cookie: treasurer.cookie, "x-csrf-token": treasurer.csrf },
      });
      expect(none.statusCode).toBe(400);
      const json = await call("POST", `/financial-accounts/${ids.fBank}/imports`, treasurer, { file: "x" });
      expect(json.statusCode).toBe(415);
    });

    it("refuse l'import sur un compte archivé", async () => {
      const archived = (
        await call("POST", "/financial-accounts", treasurer, {
          name: "Ancien",
          type: "CASH",
          accountId: (await call("POST", "/accounts", treasurer, { number: "530", label: "Caisse" })).json().id,
          openedOn: "2026-01-01",
        })
      ).json();
      await app.inject({ method: "PATCH", url: `/financial-accounts/${archived.id}`, headers: { cookie: treasurer.cookie, "x-csrf-token": treasurer.csrf }, payload: { archived: true } });
      expect((await upload(treasurer, archived.id, ofx([{ fitId: "A1", date: "20260501", amount: "-1.00", name: "x" }]))).statusCode).toBe(409);
    });
  });

  describe("annulation et concurrence", () => {
    it("annule une analyse : plus de confirmation possible, et le fichier peut être analysé de nouveau", async () => {
      const file = ofx([{ fitId: "C1", date: "20260601", amount: "-9.00", name: "À annuler" }]);
      const batch = await analyze(file);
      const cancelled = await call("POST", `/imports/${batch.id}/cancel`, treasurer);
      expect(cancelled.json().status).toBe("CANCELLED");
      expect((await commit(batch.id)).statusCode).toBe(409);
      expect(await prisma.transaction.count({ where: { externalId: "C1" } })).toBe(0);
      const again = await analyze(file);
      expect(again.id).not.toBe(batch.id);
      await call("POST", `/imports/${again.id}/cancel`, treasurer);
    });

    it("tranche deux confirmations simultanées du même import : une seule réussit, aucun doublon", async () => {
      const batch = await analyze(ofx([{ fitId: "K1", date: "20260701", amount: "-3.00", name: "Course" }, { fitId: "K2", date: "20260702", amount: "-4.00", name: "Course 2" }]));
      const results = await Promise.all([commit(batch.id), commit(batch.id)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await prisma.transaction.count({ where: { externalId: { in: ["K1", "K2"] } } })).toBe(2);
    });

    it("protège contre deux imports concurrents du même identifiant : l'un est refusé en entier", async () => {
      const a = await analyze(ofx([{ fitId: "X1", date: "20260801", amount: "-11.00", name: "Même mouvement" }, { fitId: "X2", date: "20260802", amount: "-12.00", name: "Autre A" }]));
      const b = await analyze(ofx([{ fitId: "X1", date: "20260801", amount: "-11.00", name: "Même mouvement" }, { fitId: "X3", date: "20260803", amount: "-13.00", name: "Autre B" }]));
      const results = await Promise.all([commit(a.id), commit(b.id)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await prisma.transaction.count({ where: { externalId: "X1" } })).toBe(1);
      // Le refusé n'a rien écrit du tout : ni son autre ligne, ni sa confirmation.
      const refused = results[0]!.statusCode === 409 ? a : b;
      expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: refused.id } }).then((x) => x.status)).toBe("ANALYZED");
      const other = refused === a ? "X2" : "X3";
      expect(await prisma.transaction.count({ where: { externalId: other } })).toBe(0);
    });
  });

  it("garde les données d'import intactes en base (déclencheurs SQL)", async () => {
    expect(await sqlError(`UPDATE "ImportLine" SET "raw"='{}'::jsonb WHERE "batchId"='${ids.batch1}'`)).toContain("ne se réécrivent pas");
    expect(await sqlError(`DELETE FROM "ImportLine"`)).toContain("ne se supprime pas");
    expect(await sqlError(`DELETE FROM "ImportBatch"`)).toContain("ne se supprime pas");
    expect(await sqlError(`UPDATE "ImportBatch" SET "fileName"='autre.ofx' WHERE id='${ids.batch1}'`)).toContain("fichier");
    expect(await sqlError(`UPDATE "ImportBatch" SET "status"='ANALYZED' WHERE id='${ids.batch1}'`)).toContain("ne change plus");
    expect(await sqlError(`TRUNCATE "ImportBatch" CASCADE`)).toContain("TRUNCATE refusé");
    expect(await sqlError(`TRUNCATE "ImportLine"`)).toContain("TRUNCATE refusé");
    // Ni décision incohérente : on ne rattache pas une ligne qui n'est pas à rapprocher.
    const open = await analyze(ofx([{ fitId: "Z1", date: "20260901", amount: "-2.00", name: "Test" }]));
    expect(await sqlError(`UPDATE "ImportLine" SET "decision"='LINK', "transactionId"='${ids.membership}' WHERE "batchId"='${open.id}'`)).toContain("ImportLine_decision_shape");
    await call("POST", `/imports/${open.id}/cancel`, treasurer);
  });

  it("liste les imports d'un compte et trace chaque étape dans l'audit", async () => {
    const list = (await call("GET", `/financial-accounts/${ids.fBank}/imports`, boardMember)).json();
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list[0]).not.toHaveProperty("lines");
    expect(list.map((b: { status: string }) => b.status)).toEqual(expect.arrayContaining(["COMMITTED", "CANCELLED"]));
    expect((await call("GET", `/imports/${randomUUID()}`, treasurer)).statusCode).toBe(404);

    const actions = new Set((await prisma.auditEvent.findMany({ where: { objectType: "ImportBatch" } })).map((e) => e.action));
    for (const action of ["import.analyzed", "import.committed", "import.cancelled"]) expect(actions.has(action), action).toBe(true);
  });
});
