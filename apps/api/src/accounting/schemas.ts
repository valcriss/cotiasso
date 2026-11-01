import { z } from "zod";
import { AccountingValidationError } from "./errors.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");

const label = z.string().trim().min(1, "Libellé obligatoire.").max(120, "Libellé trop long (120 caractères).");

export const fiscalYearInput = z
  .object({ label, start: isoDate, end: isoDate })
  .strict()
  .refine((year) => year.start <= year.end, { message: "La fin précède le début.", path: ["end"] });

export const fiscalYearPatch = z
  .object({ label: label.optional(), start: isoDate.optional(), end: isoDate.optional() })
  .strict();

export const journalInput = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{1,10}$/, "Code en majuscules, chiffres et tirets (10 caractères au plus)."),
    label,
    type: z.enum(["BANK", "CASH", "PURCHASES", "REVENUE", "MISC", "OPENING"]),
  })
  .strict();

export const journalPatch = z.object({ label: label.optional(), active: z.boolean().optional() }).strict();

const accountNumber = z.string().regex(/^[1-8][0-9]{2,7}$/, "Numéro de 3 à 8 chiffres, classes 1 à 8.");
const reportLine = z.string().trim().min(1).max(80).nullable();

export const accountInput = z
  .object({ number: accountNumber, label, reportLine: reportLine.optional() })
  .strict();

export const accountPatch = z
  .object({ label: label.optional(), active: z.boolean().optional(), reportLine: reportLine.optional() })
  .strict();

export const MAX_IMPORTED_ACCOUNTS = 2000;

export const accountImport = z
  .object({
    accounts: z
      .array(z.object({ number: accountNumber, label }).strict())
      .min(1, "Aucun compte à importer.")
      .max(MAX_IMPORTED_ACCOUNTS, `Au plus ${MAX_IMPORTED_ACCOUNTS} comptes par import.`),
  })
  .strict();

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AccountingValidationError(
    result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  );
}
