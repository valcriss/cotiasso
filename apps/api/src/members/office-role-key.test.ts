import { describe, expect, it } from "vitest";
import { officeRoleKey } from "./office-role-key.js";

describe("officeRoleKey", () => {
  it("ignore la casse, les accents et les espaces superflus", () => {
    expect(officeRoleKey("Présidente")).toBe("presidente");
    expect(officeRoleKey("  PRÉSIDENTE ")).toBe("presidente");
    expect(officeRoleKey("Secrétaire   adjoint")).toBe("secretaire adjoint");
  });

  it("traite les ligatures", () => {
    expect(officeRoleKey("Œuvres")).toBe("oeuvres");
  });

  it("distingue des fonctions différentes", () => {
    expect(officeRoleKey("Trésorier")).not.toBe(officeRoleKey("Trésorier adjoint"));
  });
});
