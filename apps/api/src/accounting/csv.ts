/**
 * Génération de CSV sûre (ADR 0021) : séparateur `;`, décimale `,`, BOM UTF-8, `\r\n`. Les cellules texte sont neutralisées
 * contre l'injection de formules ; les montants sont des chaînes décimales de l'application, jamais interprétées.
 */

/** Montant décimal exact (chaîne), distinct d'un texte pour ne pas être neutralisé ni mis entre guillemets. */
export interface AmountCell {
  amount: string;
}

export type CsvCell = string | number | AmountCell | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

export const amountCell = (amount: string): AmountCell => ({ amount });

/** Texte neutralisé : apostrophe devant tout ce qu'un tableur lirait comme une formule, puis guillemets si besoin. */
export function csvText(value: string): string {
  const neutralized = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}

function csvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "object") {
    if (!DECIMAL.test(cell.amount)) throw new Error("Montant invalide dans un export CSV.");
    return cell.amount.replace(".", ",");
  }
  return csvText(cell);
}

export function toCsv(rows: CsvCell[][]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

/** Nom de fichier sûr : lettres, chiffres, tirets, sans accent ni séparateur de chemin. */
export function safeFilename(base: string, extension = "csv"): string {
  const slug = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "export"}.${extension}`;
}
