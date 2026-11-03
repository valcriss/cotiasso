import { describe, expect, it } from "vitest";
import { checkEntryForPosting, projectRequiredMessage, type JournalEntryDraft, type PostingRules } from "../src/index.js";

const rules: PostingRules = {
  fiscalYear: { start: "2026-01-01", end: "2026-12-31", status: "open" },
  projectRequiredOnIncomeAndExpense: true,
};

const don: JournalEntryDraft = {
  date: "2026-05-10",
  lines: [
    { accountNumber: "5121", debit: "50.00", credit: "0.00" },
    { accountNumber: "754", debit: "0.00", credit: "50.00", projectId: "fonctionnement" },
  ],
};

function codes(entry: JournalEntryDraft, r: PostingRules = rules): string[] {
  const check = checkEntryForPosting(entry, r);
  return check.ok ? [] : check.errors.map((e) => e.code);
}

describe("checkEntryForPosting", () => {
  it("accepte une écriture équilibrée avec projet (jeu de référence, opération 17)", () => {
    expect(checkEntryForPosting(don, rules)).toEqual({ ok: true });
  });

  it("refuse une écriture déséquilibrée (CA-03)", () => {
    const entry: JournalEntryDraft = {
      date: "2026-03-10",
      lines: [
        { accountNumber: "6064", debit: "400.00", credit: "0.00", projectId: "atelier" },
        { accountNumber: "401", debit: "0.00", credit: "390.00" },
      ],
    };
    expect(codes(entry)).toEqual(["UNBALANCED"]);
  });

  it("bloque une charge ou un produit sans projet quand c'est obligatoire (CA-06)", () => {
    const entry: JournalEntryDraft = {
      date: "2026-04-02",
      lines: [
        { accountNumber: "625", debit: "80.00", credit: "0.00" },
        { accountNumber: "467", debit: "0.00", credit: "80.00" },
      ],
    };
    expect(codes(entry)).toEqual(["PROJECT_REQUIRED"]);
    expect(codes(entry, { ...rules, projectRequiredOnIncomeAndExpense: false })).toEqual([]);
  });

  it("explique le projet obligatoire en trois temps : ce qui s'est passé, pourquoi, que faire", () => {
    const result = checkEntryForPosting(
      { date: "2026-04-02", lines: [{ accountNumber: "625", debit: "80.00", credit: "0.00" }, { accountNumber: "467", debit: "0.00", credit: "80.00" }] },
      { fiscalYear: { start: "2026-01-01", end: "2026-12-31", status: "open" }, projectRequiredOnIncomeAndExpense: true },
    );
    expect(result.ok).toBe(false);
    const message = !result.ok ? result.errors[0]!.message : "";
    expect(message).toContain("Ligne 1 (compte 625)");
    expect(message).toContain("n'est rattachée à aucun projet");
    expect(message).toContain("pour savoir ce que chaque projet coûte et rapporte");
    expect(message).toContain("À faire");
    expect(message).toContain("« Fonctionnement »");
    expect(message).toBe(projectRequiredMessage(1, "625"));
  });

  it("n'impose pas de projet à un virement interne (CA-05)", () => {
    const entry: JournalEntryDraft = {
      date: "2026-03-20",
      lines: [
        { accountNumber: "5122", debit: "300.00", credit: "0.00" },
        { accountNumber: "5121", debit: "0.00", credit: "300.00" },
      ],
    };
    expect(checkEntryForPosting(entry, rules)).toEqual({ ok: true });
  });

  it("refuse un exercice non ouvert ou une date hors exercice", () => {
    expect(codes(don, { ...rules, fiscalYear: { ...rules.fiscalYear, status: "closing" } })).toEqual([
      "FISCAL_YEAR_NOT_OPEN",
    ]);
    expect(codes({ ...don, date: "2027-01-01" })).toEqual(["DATE_OUTSIDE_FISCAL_YEAR"]);
  });

  it("refuse une ligne avec débit et crédit, un montant nul ou négatif", () => {
    expect(
      codes({
        date: "2026-05-10",
        lines: [
          { accountNumber: "5121", debit: "10.00", credit: "10.00" },
          { accountNumber: "754", debit: "0.00", credit: "0.00", projectId: "p" },
        ],
      }),
    ).toEqual(["LINE_HAS_BOTH_SIDES", "LINE_HAS_NO_AMOUNT"]);
    expect(
      codes({
        date: "2026-05-10",
        lines: [
          { accountNumber: "5121", debit: "-5.00", credit: "0.00" },
          { accountNumber: "754", debit: "0.00", credit: "5.00", projectId: "p" },
        ],
      }),
    ).toEqual(["NEGATIVE_AMOUNT"]);
  });

  it("refuse une écriture à une seule ligne", () => {
    expect(codes({ date: "2026-05-10", lines: [don.lines[0]!] })).toContain("TOO_FEW_LINES");
  });
});
