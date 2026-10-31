import { describe, expect, it } from "vitest";
import { Money } from "../src/index.js";

describe("Money", () => {
  it("additionne sans erreur de virgule flottante", () => {
    expect(Money.parse("0.10").add(Money.parse("0.20")).toString()).toBe("0.30");
  });

  it("formate toujours avec deux décimales", () => {
    expect(Money.parse("12").toString()).toBe("12.00");
    expect(Money.parse("12.5").toString()).toBe("12.50");
  });

  it("refuse les formats ambigus", () => {
    for (const bad of ["", "1,50", "1.234", "abc", "1e3", " 1.00", "1."]) {
      expect(() => Money.parse(bad)).toThrow(RangeError);
    }
  });

  it("distingue zéro, positif et négatif", () => {
    expect(Money.parse("0.00").isZero()).toBe(true);
    expect(Money.parse("-0.00").isNegative()).toBe(false);
    expect(Money.parse("-1.00").isNegative()).toBe(true);
    expect(Money.parse("1.00").isPositive()).toBe(true);
  });

  it("compare des montants", () => {
    expect(Money.parse("1.00").compare(Money.parse("2.00"))).toBe(-1);
    expect(Money.parse("2.00").equals(Money.parse("2"))).toBe(true);
  });
});
