import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSIONS, SENSITIVE_PERMISSIONS, isSensitive } from "./permissions.js";

describe("catalogue des droits : libellés en langage courant (#31)", () => {
  it("chaque droit a une phrase lisible par un non-spécialiste, sans code ni jargon", () => {
    for (const permission of ALL_PERMISSIONS) {
      const label = PERMISSIONS[permission];
      expect(label.length, permission).toBeGreaterThan(15);
      expect(label[0], permission).toBe(label[0]!.toUpperCase());
      expect(label, permission).not.toMatch(/[:_]|workflow|attribution/i);
    }
  });

  it("les droits sensibles existent dans le catalogue et se reconnaissent", () => {
    expect(SENSITIVE_PERMISSIONS.length).toBeGreaterThanOrEqual(5);
    for (const permission of SENSITIVE_PERMISSIONS) expect(ALL_PERMISSIONS).toContain(permission);
    expect(isSensitive("entries:post")).toBe(true);
    expect(isSensitive("members:view")).toBe(false);
  });
});
