import { describe, expect, it } from "vitest";
import { dayDistance, rankCandidates, similarity, words } from "./matching.js";

describe("rapprochement des saisies manuelles", () => {
  it("compte les jours entre deux dates", () => {
    expect(dayDistance("2026-03-10", "2026-03-10")).toBe(0);
    expect(dayDistance("2026-03-10", "2026-03-13")).toBe(3);
    expect(dayDistance("2026-03-13", "2026-03-10")).toBe(3);
    expect(dayDistance("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("extrait les mots significatifs sans accents ni ponctuation", () => {
    expect([...words("CARTE 10/03 Boulangerie — Réunion bénévoles")].sort()).toEqual(["benevoles", "boulangerie", "carte", "reunion"]);
  });

  it("mesure la ressemblance des libellés de 0 à 1", () => {
    expect(similarity("Courses boulangerie", "CARTE BOULANGERIE")).toBeCloseTo(1 / 3, 5);
    expect(similarity("Loyer", "Cotisation")).toBe(0);
    expect(similarity("", "x y z")).toBe(0);
  });

  const line = { date: "2026-03-10", amount: "-42.30", label: "CARTE BOULANGERIE" };

  it("ne retient que le montant exact dans la fenêtre de dates", () => {
    const manual = [
      { id: "a", operationDate: "2026-03-10", amount: "-42.30", label: "Boulangerie" },
      { id: "b", operationDate: "2026-03-14", amount: "-42.30", label: "Autre" },
      { id: "c", operationDate: "2026-03-20", amount: "-42.30", label: "Trop loin" },
      { id: "d", operationDate: "2026-03-10", amount: "-42.31", label: "Montant différent" },
      { id: "e", operationDate: "2026-03-10", amount: "42.30", label: "Signe opposé" },
    ];
    expect(rankCandidates(line, manual).map((c) => c.transactionId)).toEqual(["a", "b"]);
  });

  it("classe par date proche puis par libellé voisin, et garde les ex æquo sans les fusionner", () => {
    const manual = [
      { id: "far", operationDate: "2026-03-13", amount: "-42.30", label: "Boulangerie" },
      { id: "near", operationDate: "2026-03-10", amount: "-42.30", label: "Divers" },
      { id: "same-1", operationDate: "2026-03-10", amount: "-42.30", label: "Divers" },
    ];
    const ranked = rankCandidates(line, manual);
    expect(ranked.map((c) => c.transactionId)).toEqual(["near", "same-1", "far"]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[2]!.score);
  });

  it("limite le nombre de propositions", () => {
    const manual = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, operationDate: "2026-03-10", amount: "-42.30", label: "x" }));
    expect(rankCandidates(line, manual)).toHaveLength(3);
    expect(rankCandidates(line, manual, 1)).toHaveLength(1);
  });
});
