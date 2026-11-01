import { describe, expect, it } from "vitest";
import { readEnv } from "./env.js";

describe("readEnv", () => {
  it("lit la configuration avec des valeurs par défaut sûres", () => {
    expect(readEnv({ DATABASE_URL: "postgresql://x" })).toEqual({
      databaseUrl: "postgresql://x",
      host: "127.0.0.1",
      port: 3000,
      session: { idleMinutes: 120, maxHours: 12 },
      cookieSecure: true,
      trustProxy: false,
    });
  });

  it("refuse l'absence de DATABASE_URL", () => {
    expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  });

  it("refuse un port invalide", () => {
    expect(() => readEnv({ DATABASE_URL: "x", API_PORT: "abc" })).toThrow(/API_PORT/);
    expect(() => readEnv({ DATABASE_URL: "x", API_PORT: "70000" })).toThrow(/API_PORT/);
  });

  it("lit les durées de session et les options de cookie", () => {
    const env = readEnv({
      DATABASE_URL: "x",
      SESSION_IDLE_MINUTES: "30",
      SESSION_MAX_HOURS: "8",
      COOKIE_SECURE: "false",
      TRUST_PROXY: "true",
    });
    expect(env.session).toEqual({ idleMinutes: 30, maxHours: 8 });
    expect(env.cookieSecure).toBe(false);
    expect(env.trustProxy).toBe(true);
  });

  it("refuse des durées ou des booléens invalides", () => {
    expect(() => readEnv({ DATABASE_URL: "x", SESSION_IDLE_MINUTES: "0" })).toThrow(/SESSION_IDLE_MINUTES/);
    expect(() => readEnv({ DATABASE_URL: "x", SESSION_MAX_HOURS: "abc" })).toThrow(/SESSION_MAX_HOURS/);
    expect(() => readEnv({ DATABASE_URL: "x", COOKIE_SECURE: "oui" })).toThrow(/COOKIE_SECURE/);
  });
});
