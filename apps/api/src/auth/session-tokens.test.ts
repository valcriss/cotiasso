import { describe, expect, it } from "vitest";
import { csrfTokensMatch, deriveCsrfToken, generateSessionToken, hashSessionToken } from "./session-tokens.js";

describe("session-tokens", () => {
  it("génère des jetons longs et distincts", () => {
    const a = generateSessionToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(generateSessionToken()).not.toBe(a);
  });

  it("stocke une empreinte et non le jeton", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hash);
  });

  it("dérive un jeton CSRF stable, différent du jeton de session", () => {
    const token = generateSessionToken();
    expect(deriveCsrfToken(token)).toBe(deriveCsrfToken(token));
    expect(deriveCsrfToken(token)).not.toBe(token);
    expect(deriveCsrfToken(token)).not.toBe(deriveCsrfToken(generateSessionToken()));
  });

  it("compare les jetons CSRF sans accepter l'absence ou une longueur différente", () => {
    const csrf = deriveCsrfToken(generateSessionToken());
    expect(csrfTokensMatch(csrf, csrf)).toBe(true);
    expect(csrfTokensMatch(csrf, undefined)).toBe(false);
    expect(csrfTokensMatch(csrf, "")).toBe(false);
    expect(csrfTokensMatch(csrf, csrf.slice(1))).toBe(false);
  });
});
