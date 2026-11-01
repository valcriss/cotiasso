import { describe, expect, it } from "vitest";
import { checkPasswordPolicy } from "./password-policy.js";

describe("checkPasswordPolicy", () => {
  it("accepte une phrase de passe longue sans règle de composition", () => {
    expect(checkPasswordPolicy("une phrase longue mais simple")).toEqual([]);
    expect(checkPasswordPolicy("tous les jeudis au club")).toEqual([]);
  });

  it("refuse moins de 12 caractères", () => {
    expect(checkPasswordPolicy("Court1!")).toContain("TOO_SHORT");
    expect(checkPasswordPolicy("12345678901")).toContain("TOO_SHORT");
  });

  it("compte les caractères Unicode, pas les octets", () => {
    expect(checkPasswordPolicy("éééééééééééé")).not.toContain("TOO_SHORT");
  });

  it("refuse les mots de passe courants, sans tenir compte de la casse", () => {
    expect(checkPasswordPolicy("Password1234")).toContain("TOO_COMMON");
    expect(checkPasswordPolicy("AZERTYUIOP12")).toContain("TOO_COMMON");
  });

  it("refuse les répétitions", () => {
    expect(checkPasswordPolicy("abababababababab")).toContain("REPETITIVE");
    expect(checkPasswordPolicy("zzzzzzzzzzzzzz")).toContain("REPETITIVE");
  });

  it("refuse un mot de passe contenant la partie locale de l'email", () => {
    expect(checkPasswordPolicy("marie.dupont-2026-ok", { email: "marie.dupont@asso.fr" })).toContain("CONTAINS_EMAIL");
    expect(checkPasswordPolicy("une autre phrase", { email: "marie.dupont@asso.fr" })).toEqual([]);
  });

  it("refuse un mot de passe démesuré", () => {
    expect(checkPasswordPolicy("a b ".repeat(100))).toContain("TOO_LONG");
  });
});
