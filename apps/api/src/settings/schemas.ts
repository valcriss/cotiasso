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

/** Accent par défaut : le bleu du thème, assez foncé pour porter du texte blanc. */
export const DEFAULT_ACCENT = "#005cbb";

/** Marque blanche : nom affiché, couleurs du menu et couleur d'accent. Les contrastes doivent rester lisibles (WCAG AA). */
export const brandingSchema = z
  .strictObject({
    appName: z.string().trim().min(1, "Le nom affiché est obligatoire.").max(60),
    sidebarBackground: hexColor,
    sidebarText: hexColor,
    // Couleur des boutons, liens et focus ; le texte des boutons est blanc, l'accent doit donc rester assez foncé.
    accentColor: hexColor.default(DEFAULT_ACCENT),
  })
  .refine((value) => contrastRatio(value.sidebarText, value.sidebarBackground) >= MIN_TEXT_CONTRAST, {
    message: `Le contraste entre le texte et le fond du menu doit être d'au moins ${MIN_TEXT_CONTRAST} pour rester lisible.`,
    path: ["sidebarText"],
  })
  .refine((value) => contrastRatio("#ffffff", value.accentColor) >= MIN_TEXT_CONTRAST, {
    message: `L'accent doit être assez foncé pour porter du texte blanc (contraste d'au moins ${MIN_TEXT_CONTRAST}).`,
    path: ["accentColor"],
  });

/**
 * Paramètres comptables. L'obligation de projet sur les charges et produits est active en configuration initiale
 * (cadrage §14.2, CA-06) ; elle est lue par la base à la comptabilisation (fonction accounting_project_required).
 */
export const accountingSchema = z.strictObject({ projectRequired: z.boolean() });

/** Mode de démarrage (ADR 0029) : reprendre l'historique ou partir d'une situation d'ouverture ; vide tant que non choisi. */
const startSchema = z.object({ mode: z.enum(["HISTORY", "OPENING"]).nullable() }).strict();

export type Identity = z.infer<typeof identitySchema>;
/** Adhésion effective (ADR 0004, 0023) : mode proposé aux nouvelles campagnes, figé sur chaque campagne à sa création. */
const membershipSchema = z.object({ effectiveMode: z.enum(["PAYMENT", "VALIDATION", "START_DATE"]) }).strict();

export type Branding = z.infer<typeof brandingSchema>;
export type MembershipSettings = z.infer<typeof membershipSchema>;
export type StartSettings = z.infer<typeof startSchema>;
export type AccountingSettings = z.infer<typeof accountingSchema>;

export const SETTINGS_SECTIONS = {
  identity: {
    schema: identitySchema,
    defaults: { name: "Mon association", address: "", postalCode: "", city: "", email: "", phone: "", rna: "", siren: "" } satisfies Identity,
  },
  accounting: {
    schema: accountingSchema,
    defaults: { projectRequired: true } satisfies AccountingSettings,
  },
  membership: {
    schema: membershipSchema,
    defaults: { effectiveMode: "PAYMENT" } satisfies MembershipSettings,
  },
  start: {
    schema: startSchema,
    defaults: { mode: null } satisfies StartSettings,
  },
  branding: {
    schema: brandingSchema,
    defaults: { appName: "cotiasso", sidebarBackground: "#eaf2fd", sidebarText: "#0b2a55", accentColor: DEFAULT_ACCENT } satisfies Branding,
  },
} as const;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

/** Rubriques qui ne passent pas par l'API générique des paramètres : leurs droits propres sont portés par leur module. */
export const MODULE_OWNED_SECTIONS: readonly SettingsSection[] = ["accounting", "start"];

export function isSettingsSection(value: string): value is SettingsSection {
  return Object.hasOwn(SETTINGS_SECTIONS, value) && !MODULE_OWNED_SECTIONS.includes(value as SettingsSection);
}
