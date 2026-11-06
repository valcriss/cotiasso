import { describe, expect, it } from "vitest";
import { allowsPasswordlessLogin, allowsSecondFactor, availabilityMessage, decoyCredentialId, passkeyAvailability } from "./policy.js";

describe("passkeyAvailability", () => {
  it("retient le nom d'hôte comme domaine et l'origine exacte", () => {
    expect(passkeyAvailability("https://compta.asso.fr")).toEqual({ ok: true, rpId: "compta.asso.fr", origin: "https://compta.asso.fr" });
    expect(passkeyAvailability("https://compta.asso.fr:8443/app")).toEqual({ ok: true, rpId: "compta.asso.fr", origin: "https://compta.asso.fr:8443" });
  });

  it("accepte http seulement pour la machine locale", () => {
    expect(passkeyAvailability("http://localhost:4200")).toEqual({ ok: true, rpId: "localhost", origin: "http://localhost:4200" });
    expect(passkeyAvailability("http://compta.asso.fr")).toEqual({ ok: false, reason: "NOT_HTTPS" });
  });

  it("refuse une adresse absente ou invalide", () => {
    expect(passkeyAvailability(null)).toEqual({ ok: false, reason: "MISSING" });
    expect(passkeyAvailability("compta.asso.fr")).toEqual({ ok: false, reason: "INVALID" });
    expect(passkeyAvailability("ftp://compta.asso.fr")).toEqual({ ok: false, reason: "INVALID" });
  });

  it("explique chaque refus en trois temps, sans code technique", () => {
    for (const reason of ["MISSING", "INVALID", "NOT_HTTPS"] as const) {
      const message = availabilityMessage(reason);
      expect(message).toContain("ne peuvent pas être activées");
      expect(message).toContain("PUBLIC_URL");
    }
  });
});

describe("modes", () => {
  it("n'autorise le second facteur et la connexion complète qu'aux bons modes", () => {
    expect([allowsSecondFactor("DISABLED"), allowsSecondFactor("SECOND_FACTOR"), allowsSecondFactor("FULL")]).toEqual([false, true, true]);
    expect([allowsPasswordlessLogin("DISABLED"), allowsPasswordlessLogin("SECOND_FACTOR"), allowsPasswordlessLogin("FULL")]).toEqual([false, false, true]);
  });
});

describe("decoyCredentialId", () => {
  const secret = Buffer.alloc(32, 7);
  it("est stable pour une adresse, différent d'une adresse à l'autre et d'un secret à l'autre", () => {
    expect(decoyCredentialId(secret, "a@asso.fr")).toBe(decoyCredentialId(secret, "a@asso.fr"));
    expect(decoyCredentialId(secret, "a@asso.fr")).not.toBe(decoyCredentialId(secret, "b@asso.fr"));
    expect(decoyCredentialId(secret, "a@asso.fr")).not.toBe(decoyCredentialId(Buffer.alloc(32, 8), "a@asso.fr"));
    expect(decoyCredentialId(secret, "a@asso.fr")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
