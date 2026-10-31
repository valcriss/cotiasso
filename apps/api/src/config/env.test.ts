import { describe, expect, it } from "vitest";
import { readEnv } from "./env.js";

describe("readEnv", () => {
  it("lit la configuration avec des valeurs par défaut", () => {
    expect(readEnv({ DATABASE_URL: "postgresql://x" })).toEqual({
      databaseUrl: "postgresql://x",
      host: "127.0.0.1",
      port: 3000,
    });
  });

  it("refuse l'absence de DATABASE_URL", () => {
    expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  });

  it("refuse un port invalide", () => {
    expect(() => readEnv({ DATABASE_URL: "x", API_PORT: "abc" })).toThrow(/API_PORT/);
    expect(() => readEnv({ DATABASE_URL: "x", API_PORT: "70000" })).toThrow(/API_PORT/);
  });
});
