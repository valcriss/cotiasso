import { describe, expect, it } from "vitest";
import { isComplete, percent, stageAnomalies, type Anomaly } from "./recovery-progress.js";

const account = { id: "a1", name: "Compte courant" };

describe("percent", () => {
  it("arrondit vers le bas et reste sous 100 tant que tout n'est pas fait", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(199, 200)).toBe(99);
    expect(percent(200, 200)).toBe(100);
  });
  it("n'affiche rien quand il n'y a rien à faire", () => {
    expect(percent(0, 0)).toBeNull();
  });
});

describe("stageAnomalies", () => {
  it("ne signale rien quand tout est comptabilisé", () => {
    expect(stageAnomalies(account, { total: 5, qualified: 5, drafted: 5, posted: 5, reconciled: 5 }, 0)).toEqual([]);
  });

  it("distingue non qualifiés, sans brouillon et brouillons prêts", () => {
    const anomalies = stageAnomalies(account, { total: 10, qualified: 7, drafted: 4, posted: 1, reconciled: 0 }, 0);
    expect(anomalies.map((a) => [a.code, a.count])).toEqual([
      ["NOT_QUALIFIED", 3],
      ["TO_DRAFT", 3],
      ["DRAFTS_PENDING", 3],
    ]);
    expect(anomalies[0]!.fix).toBe("TRANSACTIONS");
    expect(anomalies[1]!.fix).toBe("RECOVERY");
  });

  it("ne compte pas deux fois un brouillon bloqué parmi les brouillons prêts", () => {
    const anomalies = stageAnomalies(account, { total: 4, qualified: 4, drafted: 4, posted: 1, reconciled: 0 }, 2);
    expect(anomalies.map((a) => [a.code, a.count])).toEqual([["DRAFTS_PENDING", 1]]);
  });

  it("accorde les phrases au singulier", () => {
    const [one] = stageAnomalies(account, { total: 1, qualified: 0, drafted: 0, posted: 0, reconciled: 0 }, 0);
    expect(one!.message).toContain("1 mouvement n'a pas");
  });
});

describe("isComplete", () => {
  const info: Anomaly = { code: "MISSING_DOCUMENTS", level: "INFO", financialAccountId: null, financialAccountName: null, count: 2, message: "", fix: "DOCUMENTS" };
  it("ignore les informations mais pas les points à vérifier", () => {
    expect(isComplete([info])).toBe(true);
    expect(isComplete([info, { ...info, level: "WARNING" }])).toBe(false);
    expect(isComplete([])).toBe(true);
  });
});
