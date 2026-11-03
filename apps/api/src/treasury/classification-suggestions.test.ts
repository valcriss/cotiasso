import { describe, expect, it } from "vitest";
import { buildSuggester, normalizeLabel, type ClassifiedSample } from "./classification-suggestions.js";

const sample = (over: Partial<ClassifiedSample>): ClassifiedSample => ({
  label: "PRLV SEPA MAIF",
  sign: -1,
  counterpartAccountId: "a616",
  projectId: null,
  operationDate: "2026-09-12",
  ...over,
});

describe("normalizeLabel", () => {
  it("ignore la casse, les accents, la ponctuation et les mots qui contiennent un chiffre", () => {
    expect(normalizeLabel("Prélèvement MAIF n° 4521 du 05/11")).toBe("prelevement maif n du");
    expect(normalizeLabel("PRELEVEMENT  maif   4598")).toBe("prelevement maif");
    expect(normalizeLabel("CB*1234 Boulangerie L'Épi  12/10")).toBe("cb boulangerie l epi");
  });

  it("rend vide un libellé fait seulement de chiffres", () => {
    expect(normalizeLabel("123456 2026-11-03")).toBe("");
  });
});

describe("buildSuggester", () => {
  it("reprend le classement du même libellé, avec le mouvement le plus récent comme source", () => {
    const suggest = buildSuggester([
      sample({ label: "PRLV SEPA MAIF 0910", operationDate: "2026-09-12" }),
      sample({ label: "prlv sepa maif 1010", operationDate: "2026-10-12" }),
    ]);
    expect(suggest("Prlv Sepa MAIF 1110", -1)).toEqual({
      counterpartAccountId: "a616",
      projectId: null,
      basedOn: { label: "prlv sepa maif 1010", operationDate: "2026-10-12" },
      matches: 2,
    });
  });

  it("ne suggère rien sans précédent", () => {
    expect(buildSuggester([sample({})])("Achat chez un fournisseur inconnu", -1)).toBeNull();
    expect(buildSuggester([])("PRLV SEPA MAIF", -1)).toBeNull();
  });

  it("ne mélange pas les sens : un remboursement n'est pas classé comme la dépense du même nom", () => {
    const suggest = buildSuggester([sample({})]);
    expect(suggest("PRLV SEPA MAIF", 1)).toBeNull();
  });

  it("ne devine pas quand les précédents se contredisent (autre compte ou autre projet)", () => {
    expect(buildSuggester([sample({}), sample({ counterpartAccountId: "a606", operationDate: "2026-10-01" })])("PRLV SEPA MAIF", -1)).toBeNull();
    expect(buildSuggester([sample({ projectId: "p1" }), sample({ projectId: null, operationDate: "2026-10-01" })])("PRLV SEPA MAIF", -1)).toBeNull();
  });

  it("garde le projet du classement d'origine", () => {
    const suggest = buildSuggester([sample({ projectId: "p1" })]);
    expect(suggest("PRLV SEPA MAIF", -1)?.projectId).toBe("p1");
  });

  it("n'utilise pas un libellé sans substance (trop court ou sans lettre)", () => {
    const suggest = buildSuggester([sample({ label: "CB 1234" }), sample({ label: "12 34" })]);
    expect(suggest("CB 9999", -1)).toBeNull();
    expect(suggest("56 78", -1)).toBeNull();
  });
});
