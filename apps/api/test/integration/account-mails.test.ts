import "reflect-metadata";
import { deflateSync } from "node:zlib";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { SendMailOptions } from "nodemailer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { readEnv, type AppEnv } from "../../src/config/env.js";
import { ENV } from "../../src/config/tokens.js";
import { MAIL_TRANSPORT, type MailTransport } from "../../src/mail/mail.service.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { BrandLogoService } from "../../src/settings/brand-logo.service.js";
import { SettingsService } from "../../src/settings/settings.service.js";
import { SetupService } from "../../src/setup/setup.service.js";
import { createTempDatabase, type TempDatabase } from "./support/temp-database.js";

const PASSWORD = "une phrase de passe correcte";
const SMTP = { host: "smtp.asso.test", port: 587, secure: false, user: null, password: null, from: "no-reply@asso.test", publicUrl: "https://compta.asso.test" };

interface Session {
  cookie: string;
  csrf: string;
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, deflateSync(Buffer.alloc(8))]);
}

/** Boîte aux lettres factice : garde les messages envoyés, ou échoue à la demande. */
class FakeTransport implements MailTransport {
  sent: SendMailOptions[] = [];
  failWith: Error | null = null;
  async sendMail(message: SendMailOptions): Promise<unknown> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return {};
  }
}

describe("Emails d'invitation et de réinitialisation (base vierge)", () => {
  let db: TempDatabase;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let admin: Session;
  const transport = new FakeTransport();
  let adminId: string;

  const call = (method: "GET" | "POST", url: string, session?: Session, body?: unknown) =>
    app.inject({
      method,
      url,
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      headers: { ...(session && { cookie: session.cookie }), ...(session && method !== "GET" && { "x-csrf-token": session.csrf }) },
      ...(body !== undefined && { payload: body as Record<string, unknown> }),
    });

  beforeAll(async () => {
    db = await createTempDatabase();
    const env: AppEnv = { ...readEnv(), databaseUrl: db.url, cookieSecure: true, smtp: SMTP };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);

    const token = (await app.get(SetupService).ensureToken())!;
    await app.inject({ method: "POST", url: "/setup", payload: { token, email: "admin@asso.test", displayName: "Sam Martin", password: PASSWORD } });
    await prisma.role.updateMany({ data: { requiresMfa: false } });
    const login = await call("POST", "/auth/login", undefined, { email: "admin@asso.test", password: PASSWORD });
    admin = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken as string };
    adminId = login.json().user.id as string;
    await app.get(SettingsService).update("identity", { name: "Club des amis", address: "", postalCode: "", city: "", email: "bureau@asso.test", phone: "", rna: "", siren: "" }, adminId);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  beforeEach(() => {
    transport.sent = [];
    transport.failWith = null;
  });

  const invite = (email: string, displayName = "Camille Durand") => call("POST", "/users", admin, { email, displayName, roleIds: [] });

  it("envoie l'invitation à la personne invitée, avec l'adresse publique, le nom de l'association et l'expéditeur choisi", async () => {
    const response = await invite("camille@exemple.test");
    expect(response.statusCode, response.body).toBe(201);
    const { invitation, mail } = response.json();
    expect(mail).toEqual({ status: "SENT", to: "camille@exemple.test" });

    expect(transport.sent).toHaveLength(1);
    const message = transport.sent[0]!;
    expect(message.to).toBe("camille@exemple.test");
    expect(message.from).toEqual({ address: "no-reply@asso.test", name: "Club des amis" });
    expect(message.replyTo).toBe("bureau@asso.test");
    expect(message.subject).toBe("Vous êtes invité·e à rejoindre Club des amis sur Cotiasso");
    const link = `https://compta.asso.test${invitation.path}`;
    expect(link).toContain("/reinitialisation#token=");
    expect(String(message.text)).toContain(link);
    expect(String(message.html)).toContain(`href="${link}"`);
    expect(String(message.text)).toContain("Sam Martin vous a ouvert un accès à Cotiasso");
    // Le lien reste aussi renvoyé à l'administrateur, comme secours.
    expect(invitation.token).toBeTruthy();
  });

  it("envoie le lien de réinitialisation et le garde disponible pour l'administrateur", async () => {
    const created = (await invite("reset@exemple.test", "Alex Roy")).json();
    transport.sent = [];
    const response = await call("POST", `/users/${created.user.id}/password-reset`, admin);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().mail).toEqual({ status: "SENT", to: "reset@exemple.test" });
    expect(response.json().path).toContain("/reinitialisation#token=");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.subject).toBe("Réinitialisez votre mot de passe Club des amis sur Cotiasso");
    expect(String(transport.sent[0]!.text)).toContain(`https://compta.asso.test${response.json().path}`);
  });

  it("ne défait pas le compte quand l'email échoue : le lien reste transmis et l'échec est tracé sans le lien", async () => {
    transport.failWith = Object.assign(new Error("connexion refusée"), { code: "ECONNREFUSED" });
    const response = await invite("echec@exemple.test", "Robin Petit");
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().mail).toEqual({ status: "FAILED", to: "echec@exemple.test" });
    expect(response.json().invitation.token).toBeTruthy();
    await expect(prisma.user.count({ where: { email: "echec@exemple.test" } })).resolves.toBe(1);

    const events = await prisma.auditEvent.findMany({ where: { action: { in: ["user.mail.failed", "user.mail.sent"] } }, orderBy: { seq: "desc" }, take: 1 });
    expect(events[0]!.action).toBe("user.mail.failed");
    expect(JSON.stringify(events[0]!.details)).not.toContain(response.json().invitation.token);
  });

  it("trace les envois réussis sans jamais enregistrer le jeton", async () => {
    const response = await invite("trace@exemple.test", "Lou Blanc");
    const token = response.json().invitation.token as string;
    const events = await prisma.auditEvent.findMany({ where: { action: "user.mail.sent" } });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events.map((e) => e.details))).not.toContain(token);
    expect(events.at(-1)!.details).toEqual({ kind: "invitation" });
  });

  it("envoie un essai à la seule personne connectée, sans lien secret, et en explique l'échec", async () => {
    const report = await call("GET", "/operations", admin);
    expect(report.json().mail).toEqual({ configured: true, host: "smtp.asso.test", port: 587, secure: false, from: "no-reply@asso.test", authenticated: false });
    expect(JSON.stringify(report.json().mail)).not.toMatch(/password|pass"/i);

    const sent = await call("POST", "/operations/test-email", admin, {});
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual({ status: "SENT", to: "admin@asso.test" });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe("admin@asso.test");
    expect(String(transport.sent[0]!.text)).not.toContain("#token=");

    transport.failWith = Object.assign(new Error("connexion refusée"), { code: "ECONNREFUSED" });
    const failed = await call("POST", "/operations/test-email", admin, {});
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({ status: "FAILED", to: "admin@asso.test", detail: "ECONNREFUSED : connexion refusée" });

    const events = await prisma.auditEvent.findMany({ where: { action: { in: ["mail.test.sent", "mail.test.failed"] } }, orderBy: { seq: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["mail.test.sent", "mail.test.failed"]);
  });

  it("envoie l'essai à une autre adresse saisie, la trace dans l'audit et refuse une adresse invalide sans rien envoyer", async () => {
    const before = transport.sent.length;
    const sent = await call("POST", "/operations/test-email", admin, { to: "  Test-AbC@Srv1.Mail-Tester.com " });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual({ status: "SENT", to: "test-abc@srv1.mail-tester.com" });
    expect(transport.sent).toHaveLength(before + 1);
    const mail = transport.sent.at(-1)!;
    expect(mail.to).toBe("test-abc@srv1.mail-tester.com");
    expect(String(mail.text)).toMatch(/^Bonjour,/);
    expect(String(mail.text)).not.toContain("#token=");
    const event = await prisma.auditEvent.findFirst({ where: { action: "mail.test.sent" }, orderBy: { seq: "desc" } });
    expect(event!.details).toEqual({ to: "test-abc@srv1.mail-tester.com" });

    const invalid = await call("POST", "/operations/test-email", admin, { to: "pas-une-adresse" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().message).toContain("n’est pas valide");
    expect(transport.sent).toHaveLength(before + 1);

    const own = await call("POST", "/operations/test-email", admin, { to: "admin@asso.test" });
    expect(own.json()).toEqual({ status: "SENT", to: "admin@asso.test" });
    expect(String(transport.sent.at(-1)!.text)).toMatch(/^Bonjour [^,]+,/);
  });

  it("intègre le logo PNG de l'association, mais pas un SVG (le nom est alors montré en texte)", async () => {
    const logos = app.get(BrandLogoService);
    await logos.set(png(64, 64), adminId);
    await invite("logo@exemple.test", "Mel Noir");
    const withLogo = transport.sent.at(-1)!;
    expect(String(withLogo.html)).toContain("cid:association-logo");
    expect((withLogo.attachments as { cid: string }[]).map((a) => a.cid).sort()).toEqual(["association-logo", "cotiasso-mark"]);

    await logos.set(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>'), adminId);
    await invite("svg@exemple.test", "Lee Vert");
    const withSvg = transport.sent.at(-1)!;
    expect(String(withSvg.html)).not.toContain("cid:association-logo");
    expect((withSvg.attachments as { cid: string }[]).map((a) => a.cid)).toEqual(["cotiasso-mark"]);
    await logos.remove(adminId);
  });

  it("garde le parcours sans email quand SMTP n'est pas configuré", async () => {
    const env: AppEnv = { ...readEnv(), databaseUrl: db.url, cookieSecure: true, smtp: null };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(null)
      .compile();
    const bare = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await bare.init();
    await bare.getHttpAdapter().getInstance().ready();
    try {
      const login = await bare.inject({ method: "POST", url: "/auth/login", remoteAddress: "198.51.100.200", payload: { email: "admin@asso.test", password: PASSWORD } });
      const session = { cookie: String(login.headers["set-cookie"]).split(";")[0]!, csrf: login.json().csrfToken as string };
      const response = await bare.inject({
        method: "POST",
        url: "/users",
        remoteAddress: "198.51.100.201",
        headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
        payload: { email: "sans-smtp@exemple.test", displayName: "Sans Smtp", roleIds: [] },
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().mail).toEqual({ status: "NOT_CONFIGURED" });
      expect(response.json().invitation.token).toBeTruthy();
    } finally {
      await bare.close();
    }
  });
});
