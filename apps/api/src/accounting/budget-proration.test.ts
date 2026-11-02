import { describe, expect, it } from "vitest";
import { inclusiveDays, prorate } from "./budget-proration.js";

describe("inclusiveDays", () => {
  it("compte les deux bornes", () => {
    expect(inclusiveDays("2026-06-01", "2026-06-01")).toBe(1);
    expect(inclusiveDays("2026-01-01", "2026-12-31")).toBe(365);
    expect(inclusiveDays("2028-01-01", "2028-12-31")).toBe(366);
  });
});

describe("prorate", () => {
  it("rend le montant exact quand la ligne est entièrement dans la période", () => {
    expect(prorate("500.00", "2026-06-01", "2026-06-30", "2026-01-01", "2026-12-31")).toBe("500.00");
    expect(prorate("0.01", "2026-06-01", "2026-06-30", "2026-01-01", "2026-12-31")).toBe("0.01");
  });

  it("vaut zéro hors période", () => {
    expect(prorate("500.00", "2025-06-01", "2025-06-30", "2026-01-01", "2026-12-31")).toBe("0.00");
    expect(prorate("500.00", "2027-01-01", "2027-01-31", "2026-01-01", "2026-12-31")).toBe("0.00");
  });

  it("répartit une ligne à cheval sur deux exercices au prorata des jours", () => {
    // 365 jours du 1er juillet 2026 au 30 juin 2027 : 184 jours en 2026, 181 en 2027.
    expect(prorate("3650.00", "2026-07-01", "2027-06-30", "2026-01-01", "2026-12-31")).toBe("1840.00");
    expect(prorate("3650.00", "2026-07-01", "2027-06-30", "2027-01-01", "2027-12-31")).toBe("1810.00");
  });

  it("arrondit au centime le plus proche, sans flottant", () => {
    // 1 jour sur 3 de 100,00 € = 33,333… → 33,33 ; 2 jours sur 3 = 66,666… → 66,67.
    expect(prorate("100.00", "2026-01-01", "2026-01-03", "2026-01-01", "2026-01-01")).toBe("33.33");
    expect(prorate("100.00", "2026-01-01", "2026-01-03", "2026-01-02", "2026-01-03")).toBe("66.67");
    // 0,5 centime arrondi vers le haut.
    expect(prorate("0.01", "2026-01-01", "2026-01-02", "2026-01-01", "2026-01-01")).toBe("0.01");
  });

  it("gère les très grands montants exactement", () => {
    expect(prorate("999999999999.99", "2026-01-01", "2026-12-31", "2026-01-01", "2026-12-31")).toBe("999999999999.99");
  });
});
