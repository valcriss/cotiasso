import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email.js";

describe("normalizeEmail", () => {
  it("retire les espaces et passe en minuscules", () => {
    expect(normalizeEmail("  Marie.Dupont@Asso.FR ")).toBe("marie.dupont@asso.fr");
  });

  it("refuse les adresses invalides", () => {
    for (const bad of ["", "sans-arobase", "a@b", "a b@c.fr", "@c.fr", "a@@c.fr", `${"x".repeat(250)}@c.fr`]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});
