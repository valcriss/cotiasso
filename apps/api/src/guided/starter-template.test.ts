import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATE_ACCOUNTS, TEMPLATE_CATEGORIES } from "./starter-template.js";

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(join(here, "../../../../docs/revue-modele-demarrage.md"), "utf8");

describe("modèle de démarrage", () => {
  it("n'a que des comptes de classes 1 à 7 sans doublon, et des catégories qui renvoient à un compte du modèle", () => {
    const numbers = TEMPLATE_ACCOUNTS.map((a) => a.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const number of numbers) expect(number).toMatch(/^[1-7]\d{2,}$/);
    for (const category of TEMPLATE_CATEGORIES) expect(numbers).toContain(category.accountNumber);
  });

  it("range l'argent reçu sous des produits (7) et l'argent dépensé sous des charges (6), avec un nom unique par sens", () => {
    for (const category of TEMPLATE_CATEGORIES) expect(category.accountNumber.startsWith(category.direction === "IN" ? "7" : "6")).toBe(true);
    const keys = TEMPLATE_CATEGORIES.map((c) => `${c.direction}:${c.label.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ne donne un rôle particulier (cotisations, subventions) qu'à une catégorie d'argent reçu, une seule par rôle", () => {
    const withUsage = TEMPLATE_CATEGORIES.filter((c) => c.usage);
    expect(withUsage.every((c) => c.direction === "IN")).toBe(true);
    expect(new Set(withUsage.map((c) => c.usage)).size).toBe(withUsage.length);
    expect(withUsage.map((c) => c.usage).sort()).toEqual(["GRANT", "MEMBERSHIP"]);
  });

  it("figure en entier dans la fiche de relecture de l'expert-comptable (la fiche ne dérive pas du code)", () => {
    for (const account of TEMPLATE_ACCOUNTS) expect(sheet, `compte ${account.number}`).toContain(`| ${account.number} | ${account.label} |`);
    for (const category of TEMPLATE_CATEGORIES) expect(sheet, `catégorie ${category.label}`).toContain(`| ${category.label} |`);
  });

  it("dit que le modèle est une proposition sans affirmation de conformité", () => {
    expect(sheet).toContain("n'affirme aucune conformité comptable");
  });
});
