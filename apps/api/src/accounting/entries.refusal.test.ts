import { describe, expect, it } from "vitest";
import { databaseRefusal } from "./entries.service.js";

describe("traduction des refus de la base", () => {
  it("donne au refus SQL du projet obligatoire le même message à trois temps que le contrôle du service", () => {
    const refusal = databaseRefusal(new Error("ERROR: Projet obligatoire sur la ligne 2 (compte 625)"));
    expect(refusal).toContain("Ligne 2 (compte 625)");
    expect(refusal).toContain("n'est rattachée à aucun projet");
    expect(refusal).toContain("À faire");
  });

  it("laisse les autres refus lisibles tels quels, et ignore les erreurs étrangères", () => {
    expect(databaseRefusal(new Error("ERROR: Écriture déséquilibrée : débit 10, crédit 5."))).toBe("Écriture déséquilibrée : débit 10, crédit 5.");
    expect(databaseRefusal(new Error("connexion perdue"))).toBeNull();
  });
});
