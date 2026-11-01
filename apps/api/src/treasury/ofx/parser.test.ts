import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OfxError, parseOfx, parseOfxAmount, parseOfxDate } from "./parser.js";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../test/fixtures/ofx/${name}`, import.meta.url)));

describe("parseOfxDate", () => {
  it("lit les formats OFX usuels", () => {
    expect(parseOfxDate("20260305")).toBe("2026-03-05");
    expect(parseOfxDate("20260305120000")).toBe("2026-03-05");
    expect(parseOfxDate("20260305120000.000")).toBe("2026-03-05");
    expect(parseOfxDate("20260305120000.000[+1:CET]")).toBe("2026-03-05");
  });

  it("refuse une date inexistante ou mal formée", () => {
    for (const bad of ["20260230", "2026-03-05", "05/03/2026", "2026", "", null]) {
      expect(parseOfxDate(bad as string | null), String(bad)).toBeNull();
    }
  });
});

describe("parseOfxAmount", () => {
  it("normalise en chaîne décimale à deux décimales, sans flottant", () => {
    expect(parseOfxAmount("150,00")).toBe("150.00");
    expect(parseOfxAmount("-42.3")).toBe("-42.30");
    expect(parseOfxAmount("+7")).toBe("7.00");
    expect(parseOfxAmount("-0.00")).toBe("0.00");
    expect(parseOfxAmount("0.1")).toBe("0.10");
    expect(parseOfxAmount("999999999999.99")).toBe("999999999999.99");
  });

  it("refuse plus de deux décimales, les séparateurs de milliers et le texte", () => {
    for (const bad of ["1.234", "1 234,50", "1,234.50", "12 €", "abc", "", "--5"]) {
      expect(parseOfxAmount(bad), bad).toBeNull();
    }
  });
});

describe("parseOfx — OFX 1.x SGML en Windows-1252", () => {
  const statement = parseOfx(fixture("releve-sgml-1252.ofx"));

  it("lit le compte, la devise, la période et le solde", () => {
    expect(statement.format).toBe("SGML");
    expect(statement.account).toEqual({ bankId: "12345", accountId: "00012345678", type: "CHECKING" });
    expect(statement.currency).toBe("EUR");
    expect(statement.periodStart).toBe("2026-03-01");
    expect(statement.periodEnd).toBe("2026-03-31");
    expect(statement.ledgerBalance).toEqual({ amount: "1089.40", date: "2026-03-31" });
  });

  it("décode les accents Windows-1252, la virgule décimale et assemble NAME et MEMO", () => {
    expect(statement.lines).toHaveLength(4);
    expect(statement.lines[0]).toMatchObject({
      index: 1,
      fitId: "2026030501",
      date: "2026-03-05",
      amount: "150.00",
      label: "VIREMENT M. DUPONT — Cotisation annuelle",
      errors: [],
    });
    expect(statement.lines[1]!.label).toBe("CARTE 10/03 BOULANGERIE — Réunion bénévoles");
  });

  it("conserve les champs bruts tels que lus", () => {
    expect(statement.lines[0]!.raw).toMatchObject({ TRNTYPE: "CREDIT", DTPOSTED: "20260305120000", TRNAMT: "150,00", FITID: "2026030501" });
  });

  it("garde deux paiements identiques du même jour comme deux lignes distinctes", () => {
    expect(statement.lines[1]).toMatchObject({ date: "2026-03-10", amount: "-42.30", fitId: "2026031001" });
    expect(statement.lines[2]).toMatchObject({ date: "2026-03-10", amount: "-42.30", fitId: "2026031002" });
  });

  it("signale une ligne sans identifiant bancaire sans bloquer les autres", () => {
    const line = statement.lines[3]!;
    expect(line.fitId).toBeNull();
    expect(line.errors.join(" ")).toContain("FITID");
    expect(statement.lines.filter((l) => l.errors.length === 0)).toHaveLength(3);
  });
});

describe("parseOfx — OFX 2.x XML en UTF-8", () => {
  const statement = parseOfx(fixture("releve-xml-utf8.ofx"));

  it("lit le relevé, les accents UTF-8 et les champs facultatifs", () => {
    expect(statement.format).toBe("XML");
    expect(statement.lines.map((l) => [l.fitId, l.amount, l.label, l.reference])).toEqual([
      ["2026040201", "75.00", "Adhésion Léa Martin", null],
      ["2026041501", "-120.50", "Location de salle — Avril", "0042"],
    ]);
    expect(statement.ledgerBalance).toEqual({ amount: "1043.90", date: "2026-04-30" });
  });
});

describe("parseOfx — variantes refusées explicitement", () => {
  const sgml = (body: string, header = "OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n\n") => Buffer.from(`${header}<OFX>${body}</OFX>`, "latin1");
  const ok = (statement = "<STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>1</BANKACCTFROM><BANKTRANLIST></BANKTRANLIST></STMTRS>") =>
    `<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</STATUS></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STATUS><CODE>0</STATUS>${statement}</STMTTRNRS></BANKMSGSRSV1>`;

  it("accepte un relevé minimal sans opération", () => {
    expect(parseOfx(sgml(ok())).lines).toEqual([]);
  });

  it("refuse un fichier vide, non OFX ou tronqué", () => {
    expect(() => parseOfx(Buffer.alloc(0))).toThrow(OfxError);
    expect(() => parseOfx(Buffer.from("date;libellé;montant\n2026-01-01;x;1"))).toThrow(/pas un fichier OFX/);
    expect(() => parseOfx(Buffer.from("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1>"))).toThrow(/tronqué/);
  });

  it("refuse les cartes, les placements et les comptes multiples", () => {
    expect(() => parseOfx(sgml("<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>"))).toThrow(/carte bancaire/);
    expect(() => parseOfx(sgml("<INVSTMTMSGSRSV1><INVSTMTTRNRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>"))).toThrow(/placement/);
    const two = `<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</STMTRS></STMTTRNRS><STMTTRNRS><STMTRS><CURDEF>EUR</STMTRS></STMTTRNRS></BANKMSGSRSV1>`;
    expect(() => parseOfx(sgml(two))).toThrow(/plusieurs comptes/);
  });

  it("refuse une autre devise ou une devise absente", () => {
    expect(() => parseOfx(sgml(ok("<STMTRS><CURDEF>USD<BANKTRANLIST></BANKTRANLIST></STMTRS>")))).toThrow(/USD/);
    expect(() => parseOfx(sgml(ok("<STMTRS><BANKTRANLIST></BANKTRANLIST></STMTRS>")))).toThrow(/devise/);
  });

  it("refuse une erreur signalée par la banque", () => {
    const failing = `<SIGNONMSGSRSV1><SONRS><STATUS><CODE>15500<MESSAGE>Identifiants refusés</STATUS></SONRS></SIGNONMSGSRSV1>`;
    expect(() => parseOfx(sgml(failing))).toThrow(/15500/);
  });

  it("refuse un encodage inconnu", () => {
    expect(() => parseOfx(sgml(ok(), "OFXHEADER:100\nCHARSET:EBCDIC\n\n"))).toThrow(/Encodage/);
  });

  it("refuse toute entité, DTD ou CDATA : aucune ressource externe n'est jamais lue", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE OFX [<!ENTITY secret SYSTEM "file:///etc/passwd">]><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</CURDEF><BANKTRANLIST><STMTTRN><NAME>&secret;</NAME></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(() => parseOfx(Buffer.from(xxe))).toThrow(/DOCTYPE|ENTITY/);
    expect(() => parseOfx(Buffer.from(`<OFX><![CDATA[x]]></OFX>`))).toThrow(/CDATA/);
  });

  it("signale les montants et dates illisibles par ligne", () => {
    const body = ok(
      "<STMTRS><CURDEF>EUR<BANKTRANLIST>" +
        "<STMTTRN><DTPOSTED>20260230<TRNAMT>1.234<FITID>A<NAME>Mauvais</STMTTRN>" +
        "<STMTTRN><DTPOSTED>20260301<TRNAMT>0.00<FITID>B<NAME>Nul</STMTTRN>" +
        "<STMTTRN><DTPOSTED>20260301<TRNAMT>5.00<FITID>C</STMTTRN>" +
        "</BANKTRANLIST></STMTRS>",
    );
    const [bad, zero, noLabel] = parseOfx(sgml(body)).lines;
    expect(bad!.errors.join(" ")).toMatch(/Date.*Montant|Montant.*Date/s);
    expect(zero!.errors.join(" ")).toContain("Montant nul");
    expect(noLabel!.errors.join(" ")).toContain("Libellé absent");
  });
});
