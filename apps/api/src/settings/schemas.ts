import { z } from "zod";
import { MIN_TEXT_CONTRAST, contrastRatio } from "./contrast.js";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB.").transform((value) => value.toLowerCase());
const optionalText = (max: number) => z.string().trim().max(max).default("");

/** Identité de l'association (cadrage §8.2). Le RNA et le SIREN sont facultatifs. */
export const identitySchema = z.strictObject({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(120),
  address: optionalText(300),
  postalCode: optionalText(10),
  city: optionalText(100),
  email: z.union([z.literal(""), z.email("Adresse email invalide.").max(254)]).default(""),
  phone: optionalText(30),
  rna: z.union([z.literal(""), z.string().regex(/^W\d{9}$/, "Le RNA a la forme W suivi de 9 chiffres.")]).default(""),
  siren: z.union([z.literal(""), z.string().regex(/^\d{9}$/, "Le SIREN comporte 9 chiffres.")]).default(""),
});

/** Marque blanche : nom affiché et couleurs du menu. Le contraste du texte doit rester lisible (WCAG AA). */
export const brandingSchema = z
  .strictObject({
    appName: z.string().trim().min(1, "Le nom affiché est obligatoire.").max(60),
    sidebarBackground: hexColor,
    sidebarText: hexColor,
  })
  .refine((value) => contrastRatio(value.sidebarText, value.sidebarBackground) >= MIN_TEXT_CONTRAST, {
    message: `Le contraste entre le texte et le fond du menu doit être d'au moins ${MIN_TEXT_CONTRAST} pour rester lisible.`,
    path: ["sidebarText"],
  });

export type Identity = z.infer<typeof identitySchema>;
export type Branding = z.infer<typeof brandingSchema>;

export const SETTINGS_SECTIONS = {
  identity: {
    schema: identitySchema,
    defaults: { name: "Mon association", address: "", postalCode: "", city: "", email: "", phone: "", rna: "", siren: "" } satisfies Identity,
  },
  branding: {
    schema: brandingSchema,
    defaults: { appName: "cotiasso", sidebarBackground: "#eaf2fd", sidebarText: "#0b2a55" } satisfies Branding,
  },
} as const;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

export function isSettingsSection(value: string): value is SettingsSection {
  return Object.hasOwn(SETTINGS_SECTIONS, value);
}
