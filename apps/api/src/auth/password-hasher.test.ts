import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password-hasher.js";

// Paramètres réduits pour des tests rapides ; la production utilise DEFAULT_ARGON2_PARAMS.
const FAST = { memory: 64, passes: 1, parallelism: 1 };

describe("password-hasher", () => {
  it("produit un hash argon2id au format PHC, différent à chaque appel", async () => {
    const a = await hashPassword("correct horse battery", FAST);
    const b = await hashPassword("correct horse battery", FAST);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("correct horse");
  });

  it("vérifie un bon mot de passe et refuse un mauvais", async () => {
    const hash = await hashPassword("correct horse battery", FAST);
    await expect(verifyPassword("correct horse battery", hash, FAST)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(verifyPassword("correct horse batterz", hash, FAST)).resolves.toMatchObject({ valid: false });
  });

  it("traite de la même façon deux écritures Unicode équivalentes (NFKC)", async () => {
    const hash = await hashPassword("café-très-long-123", FAST);
    const decomposed = "café-très-long-123";
    await expect(verifyPassword(decomposed, hash, FAST)).resolves.toMatchObject({ valid: true });
  });

  it("signale un hash produit avec des paramètres plus faibles", async () => {
    const hash = await hashPassword("correct horse battery", FAST);
    const result = await verifyPassword("correct horse battery", hash, { memory: 128, passes: 2, parallelism: 1 });
    expect(result).toEqual({ valid: true, needsRehash: true });
  });

  it("refuse sans erreur un hash mal formé ou d'un autre algorithme", async () => {
    for (const bad of ["", "texte", "$argon2i$v=19$m=64,t=1,p=1$AAAA$AAAA", "$2b$10$abcdefghijklmnopqrstuv"]) {
      await expect(verifyPassword("x", bad, FAST)).resolves.toEqual({ valid: false, needsRehash: false });
    }
  });
});
