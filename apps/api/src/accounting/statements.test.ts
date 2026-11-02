import { Money } from "@cotiasso/accounting-domain";
import { describe, expect, it } from "vitest";
import { balanceRubricFor, computeBalance, computeIncome, incomeRubricFor, type AccountNet } from "./statements.js";

const net = (number: string, value: string, reportLine: string | null = null): AccountNet => ({ number, label: `Compte ${number}`, reportLine, net: Money.parse(value) });

describe("rubriques du compte de résultat", () => {
  it("range un compte par son préfixe le plus long, et les classes 6 et 7 inconnues dans « autres »", () => {
    expect(incomeRubricFor("756", null)?.rubric.code).toBe("PRO_COTIS");
    expect(incomeRubricFor("7561", null)?.rubric.code).toBe("PRO_COTIS");
    expect(incomeRubricFor("754", null)?.rubric.code).toBe("PRO_AUTRES");
    expect(incomeRubricFor("606", null)?.rubric.code).toBe("CHG_ACHATS");
    expect(incomeRubricFor("689", null)?.rubric.code).toBe("CHG_FONDS");
    expect(incomeRubricFor("686", null)?.rubric.code).toBe("CHG_DOT");
    expect(incomeRubricFor("655", null)?.rubric.code).toBe("CHG_AUTRES");
    expect(incomeRubricFor("512", null)).toBeNull();
  });

  it("applique le code de rubrique imposé par le compte, s'il est du bon côté, et l'ignore sinon", () => {
    expect(incomeRubricFor("706", "PRO_COTIS")).toMatchObject({ rubric: { code: "PRO_COTIS" }, byDefault: false });
    expect(incomeRubricFor("706", "CHG_ACHATS")).toMatchObject({ rubric: { code: "PRO_VENTES" }, byDefault: true });
    expect(incomeRubricFor("706", "Produits")).toMatchObject({ rubric: { code: "PRO_VENTES" }, byDefault: true });
  });
});

describe("compte de résultat", () => {
  it("calcule produits, charges, résultats intermédiaires et excédent à partir des soldes nets", () => {
    const result = computeIncome([
      net("706", "-500.00"),
      net("756", "-200.00"),
      net("606", "300.00"),
      net("626", "50.00"),
      net("661", "10.00"),
      net("761", "-4.00"),
      net("512", "100.00"),
    ]);
    expect(result.products).toBe("704.00");
    expect(result.charges).toBe("360.00");
    expect(result.result).toBe("344.00");
    expect(result.intermediate).toEqual([
      { code: "OPERATING", label: "Résultat d'exploitation", amount: "350.00" },
      { code: "FINANCIAL", label: "Résultat financier", amount: "-6.00" },
      { code: "EXCEPTIONAL", label: "Résultat exceptionnel", amount: "0.00" },
    ]);
    const operating = result.sections.find((s) => s.code === "OPERATING_PRODUCTS")!;
    expect(operating.rows.find((r) => r.code === "PRO_COTIS")!.amount).toBe("200.00");
    expect(operating.total).toBe("700.00");
  });

  it("signale les comptes rangés par défaut, et les comptes de classe 8 qu'aucune rubrique n'accueille", () => {
    const result = computeIncome([net("706", "-10.00", "PRO_VENTES"), net("756", "-5.00"), net("864", "20.00")]);
    expect(result.defaulted).toEqual([{ number: "756", label: "Compte 756" }]);
    expect(result.unclassified).toEqual([{ number: "864", label: "Compte 864", amount: "20.00" }]);
  });

  it("un déficit est un résultat négatif", () => {
    expect(computeIncome([net("606", "80.00"), net("706", "-30.00")]).result).toBe("-50.00");
  });
});

describe("rubriques du bilan", () => {
  it("le sens du solde décide pour les tiers et la trésorerie", () => {
    expect(balanceRubricFor("411", Money.parse("10"))?.code).toBe("ACT_CREANCES");
    expect(balanceRubricFor("401", Money.parse("-10"))?.code).toBe("PAS_DETTES");
    expect(balanceRubricFor("512", Money.parse("10"))?.code).toBe("ACT_DISPO");
    expect(balanceRubricFor("512", Money.parse("-10"))?.code).toBe("PAS_DETTES");
    expect(balanceRubricFor("487", Money.parse("-10"))?.code).toBe("PAS_REGUL");
    expect(balanceRubricFor("486", Money.parse("10"))?.code).toBe("ACT_REGUL");
    expect(balanceRubricFor("281", Money.parse("-10"))?.code).toBe("ACT_AMORT");
    expect(balanceRubricFor("19", Money.parse("-10"))?.code).toBe("PAS_FONDS_DEDIES");
    expect(balanceRubricFor("102", Money.parse("-10"))?.code).toBe("PAS_FONDS");
    expect(balanceRubricFor("164", Money.parse("-10"))?.code).toBe("PAS_EMPRUNTS");
  });
});

describe("bilan", () => {
  it("met le résultat de l'exercice aux fonds propres et équilibre l'actif et le passif", () => {
    const balance = computeBalance([
      net("512", "1220.00"),
      net("102", "-1000.00"),
      net("706", "-500.00"),
      net("606", "280.00"),
    ]);
    expect(balance.result).toBe("220.00");
    expect(balance.totalAssets).toBe("1220.00");
    expect(balance.totalLiabilities).toBe("1220.00");
    expect(balance.balanced).toBe(true);
    const equity = balance.groups.find((g) => g.code === "EQUITY")!;
    expect(equity.rows.find((r) => r.code === "PAS_RESULTAT")!.amount).toBe("220.00");
    expect(equity.total).toBe("1220.00");
  });

  it("un amortissement vient en déduction de l'actif immobilisé, un déficit des fonds propres", () => {
    const balance = computeBalance([net("215", "900.00"), net("2815", "-300.00"), net("512", "100.00"), net("102", "-1000.00"), net("606", "300.00")]);
    expect(balance.groups.find((g) => g.code === "FIXED_ASSETS")!.total).toBe("600.00");
    expect(balance.result).toBe("-300.00");
    expect(balance.balanced).toBe(true);
  });

  it("un découvert passe au passif, une dette tiers aussi ; la classe 8 rend le bilan déséquilibré et listé", () => {
    const balance = computeBalance([net("512", "-50.00"), net("401", "-20.00"), net("102", "70.00")]);
    expect(balance.groups.find((g) => g.code === "DEBTS")!.total).toBe("70.00");
    const withEight = computeBalance([net("512", "100.00"), net("864", "-100.00")]);
    expect(withEight.unclassified).toEqual([{ number: "864", label: "Compte 864", amount: "-100.00" }]);
    expect(withEight.balanced).toBe(false);
  });
});
