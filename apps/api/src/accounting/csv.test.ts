import { describe, expect, it } from "vitest";
import { amountCell, csvText, safeFilename, toCsv } from "./csv.js";

describe("CSV sûr", () => {
  it("neutralise les cellules texte que le tableur lirait comme une formule", () => {
    for (const dangerous of ["=1+1", "+33 6 00", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(csvText(dangerous).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvText("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvText("Cotisation")).toBe("Cotisation");
  });

  it("met entre guillemets les textes avec séparateur, guillemet ou saut de ligne", () => {
    expect(csvText("a;b")).toBe('"a;b"');
    expect(csvText('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvText("ligne1\nligne2")).toBe('"ligne1\nligne2"');
  });

  it("écrit les montants avec la virgule décimale, sans guillemets, y compris négatifs, et ne les neutralise pas", () => {
    const csv = toCsv([["Compte", "Montant"], ["Achats", amountCell("-30.50")], ["Dons", amountCell("1200.00")]]);
    expect(csv).toBe("﻿Compte;Montant\r\nAchats;-30,50\r\nDons;1200,00\r\n");
  });

  it("refuse un montant qui n'est pas un décimal exact (jamais de notation scientifique ni de formule déguisée)", () => {
    expect(() => toCsv([[amountCell("=1+1")]])).toThrow();
    expect(() => toCsv([[amountCell("1e5")]])).toThrow();
  });

  it("laisse vides les valeurs absentes", () => {
    expect(toCsv([["a", null, undefined, 3]])).toBe("﻿a;;;3\r\n");
  });

  it("fabrique un nom de fichier sans accent ni séparateur de chemin", () => {
    expect(safeFilename("Compte de résultat 2026")).toBe("compte-de-resultat-2026.csv");
    expect(safeFilename("../../etc/passwd", "csv")).toBe("etc-passwd.csv");
    expect(safeFilename("???")).toBe("export.csv");
  });
});
