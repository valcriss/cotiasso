import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");

/** Montant décimal positif en chaîne, deux décimales au plus, jamais de `number` (colonne NUMERIC(14,2)). */
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (12 chiffres et 2 décimales au plus).");

const line = z
  .object({
    accountId: z.uuid("Compte invalide."),
    debit: amount.default("0"),
    credit: amount.default("0"),
    label: z.string().trim().max(200).nullish(),
  })
  .strict()
  .superRefine((value, context) => {
    const debit = Number(value.debit);
    const credit = Number(value.credit);
    if (debit > 0 && credit > 0) {
      context.addIssue({ code: "custom", message: "Une ligne ne porte pas un débit et un crédit à la fois." });
    } else if (debit === 0 && credit === 0) {
      context.addIssue({ code: "custom", message: "Une ligne doit porter un montant." });
    }
  });

const label = z.string().trim().min(1, "Libellé obligatoire.").max(200, "Libellé trop long (200 caractères).");
const reference = z.string().trim().max(100).nullish();

export const MAX_LINES = 200;

const entryBody = {
  journalId: z.uuid("Journal invalide."),
  date: isoDate,
  label,
  reference,
  lines: z.array(line).max(MAX_LINES, `Au plus ${MAX_LINES} lignes.`),
};

export const entryDraftInput = z.object(entryBody).strict();

/** Remplacement complet du brouillon, avec la version lue (contrôle de version optimiste). */
export const entryDraftUpdate = z.object({ ...entryBody, version: z.number().int().min(1) }).strict();

export const entryReverseInput = z.object({ date: isoDate.optional(), label: label.optional() }).strict();

export const entryListQuery = z
  .object({
    fiscalYearId: z.uuid().optional(),
    journalId: z.uuid().optional(),
    status: z.enum(["DRAFT", "POSTED", "REVERSED"]).optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type EntryDraftInput = z.infer<typeof entryDraftInput>;
export type EntryDraftUpdate = z.infer<typeof entryDraftUpdate>;
