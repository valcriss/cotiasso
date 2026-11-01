import { describe, expect, it } from "vitest";
import { ACCOUNT_BACKOFF, IP_BACKOFF, backoffSeconds } from "./backoff.js";

describe("backoffSeconds", () => {
  it("n'impose aucun délai dans la tolérance", () => {
    for (let failures = 0; failures <= ACCOUNT_BACKOFF.freeAttempts; failures += 1) {
      expect(backoffSeconds(failures, ACCOUNT_BACKOFF)).toBe(0);
    }
  });

  it("double le délai à chaque échec supplémentaire", () => {
    expect([6, 7, 8, 9].map((n) => backoffSeconds(n, ACCOUNT_BACKOFF))).toEqual([2, 4, 8, 16]);
  });

  it("plafonne le délai et ne verrouille jamais définitivement", () => {
    expect(backoffSeconds(40, ACCOUNT_BACKOFF)).toBe(ACCOUNT_BACKOFF.maxSeconds);
    expect(backoffSeconds(10_000, ACCOUNT_BACKOFF)).toBe(900);
  });

  it("tolère davantage d'essais par adresse IP que par compte", () => {
    expect(backoffSeconds(6, IP_BACKOFF)).toBe(0);
    expect(backoffSeconds(21, IP_BACKOFF)).toBe(2);
  });
});
