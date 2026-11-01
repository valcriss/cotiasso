import { describe, expect, it } from "vitest";
import { MIN_TEXT_CONTRAST, contrastRatio } from "./contrast.js";
import { DEFAULT_MODULES } from "./modules-catalog.js";
import { SETTINGS_SECTIONS, brandingSchema, identitySchema, isSettingsSection } from "./schemas.js";

describe("contrastRatio (WCAG)", () => {
  it("reproduit les valeurs de référence", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Gris #767676 sur blanc : 4,54, valeur limite connue du seuil AA.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.6);
  });

  it("est symétrique", () => {
    expect(contrastRatio("#0b2a55", "#eaf2fd")).toBeCloseTo(contrastRatio("#eaf2fd", "#0b2a55"), 10);
  });

  it("accepte les couleurs par défaut du menu", () => {
    const { sidebarBackground, sidebarText } = SETTINGS_SECTIONS.branding.defaults;
    expect(contrastRatio(sidebarText, sidebarBackground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

describe("identitySchema", () => {
  it("accepte une identité minimale et complète les champs facultatifs", () => {
    expect(identitySchema.parse({ name: "  Club des amis  " })).toEqual({
      name: "Club des amis",
      address: "",
      postalCode: "",
      city: "",
      email: "",
      phone: "",
      rna: "",
      siren: "",
    });
  });

  it("valide le RNA, le SIREN et l'email quand ils sont renseignés", () => {
    const base = { name: "Asso" };
    expect(identitySchema.safeParse({ ...base, rna: "W123456789", siren: "123456789", email: "bureau@asso.fr" }).success).toBe(true);
    expect(identitySchema.safeParse({ ...base, rna: "123" }).success).toBe(false);
    expect(identitySchema.safeParse({ ...base, siren: "12345" }).success).toBe(false);
    expect(identitySchema.safeParse({ ...base, email: "pas-un-email" }).success).toBe(false);
  });

  it("refuse un nom vide et les champs inconnus", () => {
    expect(identitySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(identitySchema.safeParse({ name: "Asso", surprise: "x" }).success).toBe(false);
  });
});

describe("brandingSchema", () => {
  const valid = { appName: "Mon asso", sidebarBackground: "#EAF2FD", sidebarText: "#0B2A55" };

  it("normalise les couleurs en minuscules", () => {
    expect(brandingSchema.parse(valid)).toEqual({ appName: "Mon asso", sidebarBackground: "#eaf2fd", sidebarText: "#0b2a55" });
  });

  it("refuse un format de couleur invalide", () => {
    for (const bad of ["red", "#fff", "#12345g", "0b2a55", "#0b2a5500"]) {
      expect(brandingSchema.safeParse({ ...valid, sidebarText: bad }).success).toBe(false);
    }
  });

  it("refuse un contraste illisible et désigne le champ concerné", () => {
    const result = brandingSchema.safeParse({ ...valid, sidebarBackground: "#ffffff", sidebarText: "#f0f0f0" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["sidebarText"]);
    expect(result.error?.issues[0]?.message).toContain("contraste");
  });
});

describe("sections et catalogue de modules", () => {
  it("reconnaît uniquement les rubriques connues", () => {
    expect(isSettingsSection("identity")).toBe(true);
    expect(isSettingsSection("branding")).toBe(true);
    expect(isSettingsSection("constructor")).toBe(false);
    expect(isSettingsSection("__proto__")).toBe(false);
  });

  it("valide les valeurs par défaut de chaque rubrique avec son propre schéma", () => {
    for (const { schema, defaults } of Object.values(SETTINGS_SECTIONS)) {
      expect(schema.safeParse(defaults).success).toBe(true);
    }
  });

  it("n'annonce aucun module disponible tant qu'il n'est pas livré, avec un motif", () => {
    for (const module of DEFAULT_MODULES) {
      expect(module.available).toBe(false);
      expect(module.unavailableReason).toBeTruthy();
    }
    expect(new Set(DEFAULT_MODULES.map((m) => m.key)).size).toBe(DEFAULT_MODULES.length);
    const keys = new Set(DEFAULT_MODULES.map((m) => m.key));
    for (const module of DEFAULT_MODULES) for (const required of module.requires ?? []) expect(keys.has(required)).toBe(true);
  });
});
