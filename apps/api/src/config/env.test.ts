import { describe, expect, it } from "vitest";
import { readEnv } from "./env.js";

const KEY = Buffer.alloc(32, 5).toString("base64");
const base = { DATABASE_URL: "postgresql://x", MFA_ENCRYPTION_KEY: KEY };

describe("readEnv", () => {
  it("lit la configuration avec des valeurs par défaut sûres", () => {
    expect(readEnv(base)).toEqual({
      databaseUrl: "postgresql://x",
      host: "127.0.0.1",
      port: 3000,
      session: { idleMinutes: 120, maxHours: 12 },
      cookieSecure: true,
      trustProxy: false,
      mfaKey: Buffer.alloc(32, 5),
      documentsDir: "./storage/documents",
      documentsMaxBytes: 25 * 1024 * 1024,
      backupsDir: null,
      appVersion: "développement",
    });
  });

  it("refuse l'absence de DATABASE_URL", () => {
    expect(() => readEnv({ MFA_ENCRYPTION_KEY: KEY })).toThrow(/DATABASE_URL/);
  });

  it("refuse un port invalide", () => {
    expect(() => readEnv({ ...base, API_PORT: "abc" })).toThrow(/API_PORT/);
    expect(() => readEnv({ ...base, API_PORT: "70000" })).toThrow(/API_PORT/);
  });

  it("exige une clé MFA de 32 octets en base64", () => {
    expect(() => readEnv({ DATABASE_URL: "x" })).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => readEnv({ DATABASE_URL: "x", MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 octets/);
  });

  it("lit les durées de session et les options de cookie", () => {
    const env = readEnv({
      ...base,
      SESSION_IDLE_MINUTES: "30",
      SESSION_MAX_HOURS: "8",
      COOKIE_SECURE: "false",
      TRUST_PROXY: "true",
    });
    expect(env.session).toEqual({ idleMinutes: 30, maxHours: 8 });
    expect(env.cookieSecure).toBe(false);
    expect(env.trustProxy).toBe(true);
  });

  it("lit le dossier et la taille maximale des documents", () => {
    const env = readEnv({ ...base, DOCUMENTS_DIR: "/data/documents", DOCUMENTS_MAX_MB: "5" });
    expect(env.documentsDir).toBe("/data/documents");
    expect(env.documentsMaxBytes).toBe(5 * 1024 * 1024);
    expect(() => readEnv({ ...base, DOCUMENTS_MAX_MB: "0" })).toThrow(/DOCUMENTS_MAX_MB/);
  });

  it("refuse des durées ou des booléens invalides", () => {
    expect(() => readEnv({ ...base, SESSION_IDLE_MINUTES: "0" })).toThrow(/SESSION_IDLE_MINUTES/);
    expect(() => readEnv({ ...base, SESSION_MAX_HOURS: "abc" })).toThrow(/SESSION_MAX_HOURS/);
    expect(() => readEnv({ ...base, COOKIE_SECURE: "oui" })).toThrow(/COOKIE_SECURE/);
  });
});
