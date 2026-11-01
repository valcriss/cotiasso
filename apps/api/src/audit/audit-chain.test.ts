import { describe, expect, it } from "vitest";
import { canonicalJson, computeEventHash, type ChainedFields } from "./audit-chain.js";

const base: ChainedFields = {
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: new Date("2026-11-01T10:00:00.000Z"),
  actorId: "22222222-2222-4222-8222-222222222222",
  action: "auth.login.success",
  objectType: "User",
  objectId: "u1",
  justification: null,
  details: { ip: "203.0.113.7", sessionId: "s1" },
};

describe("canonicalJson", () => {
  it("trie les clés récursivement pour être indépendant de l'ordre (jsonb ne le conserve pas)", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("distingue null, absent et chaîne vide, et garde l'ordre des tableaux", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson("")).toBe('""');
  });
});

describe("computeEventHash", () => {
  it("est déterministe, en hexadécimal sur 64 caractères", () => {
    const hash = computeEventHash(null, base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEventHash(null, base)).toBe(hash);
  });

  it("ne dépend pas de l'ordre des clés des détails", () => {
    const reordered = { ...base, details: { sessionId: "s1", ip: "203.0.113.7" } };
    expect(computeEventHash(null, reordered)).toBe(computeEventHash(null, base));
  });

  it("change dès qu'un champ ou l'empreinte précédente change", () => {
    const reference = computeEventHash("a".repeat(64), base);
    const variants: Partial<ChainedFields>[] = [
      { id: "33333333-3333-4333-8333-333333333333" },
      { occurredAt: new Date("2026-11-01T10:00:00.001Z") },
      { actorId: null },
      { action: "auth.login.failure" },
      { objectType: "Role" },
      { objectId: "u2" },
      { justification: "motif" },
      { details: { ip: "203.0.113.8", sessionId: "s1" } },
      { details: null },
    ];
    for (const variant of variants) expect(computeEventHash("a".repeat(64), { ...base, ...variant })).not.toBe(reference);
    expect(computeEventHash("b".repeat(64), base)).not.toBe(reference);
    expect(computeEventHash(null, base)).not.toBe(reference);
  });

  it("traite l'absence de détails comme null", () => {
    expect(computeEventHash(null, { ...base, details: undefined })).toBe(computeEventHash(null, { ...base, details: null }));
  });
});
