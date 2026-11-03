import { Money } from "./money.js";

export interface JournalLineDraft {
  accountNumber: string;
  debit: string;
  credit: string;
  thirdPartyId?: string;
  projectId?: string;
}

export interface FiscalYearView {
  start: string;
  end: string;
  status: "open" | "closing" | "closed";
}

export interface JournalEntryDraft {
  date: string;
  lines: JournalLineDraft[];
}

export interface PostingRules {
  fiscalYear: FiscalYearView;
  /** Comptes de charge/produit (classes 6 et 7) : projet obligatoire si actif (CA-06). */
  projectRequiredOnIncomeAndExpense: boolean;
}

export type PostingErrorCode =
  | "FISCAL_YEAR_NOT_OPEN"
  | "DATE_OUTSIDE_FISCAL_YEAR"
  | "TOO_FEW_LINES"
  | "INVALID_AMOUNT"
  | "NEGATIVE_AMOUNT"
  | "LINE_HAS_BOTH_SIDES"
  | "LINE_HAS_NO_AMOUNT"
  | "UNBALANCED"
  | "PROJECT_REQUIRED";

export interface PostingError {
  code: PostingErrorCode;
  message: string;
  lineIndex?: number;
}

export type PostingCheck = { ok: true } | { ok: false; errors: PostingError[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIncomeOrExpense(accountNumber: string): boolean {
  return accountNumber.startsWith("6") || accountNumber.startsWith("7");
}

/**
 * Contrôle pur de la validité d'une écriture avant comptabilisation.
 * Ne remplace pas les garanties en base (équilibre, numérotation, verrous) :
 * il sert à produire des erreurs explicites avant d'ouvrir la transaction.
 */
export function checkEntryForPosting(entry: JournalEntryDraft, rules: PostingRules): PostingCheck {
  const errors: PostingError[] = [];

  if (rules.fiscalYear.status !== "open") {
    errors.push({ code: "FISCAL_YEAR_NOT_OPEN", message: "L'exercice n'est pas ouvert." });
  }

  if (!ISO_DATE.test(entry.date)) {
    errors.push({ code: "DATE_OUTSIDE_FISCAL_YEAR", message: "La date de l'écriture est invalide." });
  } else if (entry.date < rules.fiscalYear.start || entry.date > rules.fiscalYear.end) {
    errors.push({
      code: "DATE_OUTSIDE_FISCAL_YEAR",
      message: "La date de l'écriture est hors de l'exercice.",
    });
  }

  if (entry.lines.length < 2) {
    errors.push({ code: "TOO_FEW_LINES", message: "Une écriture comporte au moins deux lignes." });
  }

  let totalDebit = Money.zero();
  let totalCredit = Money.zero();
  let amountsAreValid = true;

  entry.lines.forEach((line, lineIndex) => {
    let debit: Money;
    let credit: Money;
    try {
      debit = Money.parse(line.debit);
      credit = Money.parse(line.credit);
    } catch {
      amountsAreValid = false;
      errors.push({ code: "INVALID_AMOUNT", message: "Montant invalide.", lineIndex });
      return;
    }

    if (debit.isNegative() || credit.isNegative()) {
      amountsAreValid = false;
      errors.push({ code: "NEGATIVE_AMOUNT", message: "Un montant ne peut pas être négatif.", lineIndex });
      return;
    }
    if (debit.isPositive() && credit.isPositive()) {
      amountsAreValid = false;
      errors.push({
        code: "LINE_HAS_BOTH_SIDES",
        message: "Une ligne ne porte pas un débit et un crédit à la fois.",
        lineIndex,
      });
      return;
    }
    if (debit.isZero() && credit.isZero()) {
      amountsAreValid = false;
      errors.push({ code: "LINE_HAS_NO_AMOUNT", message: "Une ligne doit porter un montant.", lineIndex });
      return;
    }

    totalDebit = totalDebit.add(debit);
    totalCredit = totalCredit.add(credit);

    if (rules.projectRequiredOnIncomeAndExpense && isIncomeOrExpense(line.accountNumber) && !line.projectId) {
      errors.push({
        code: "PROJECT_REQUIRED",
        message: projectRequiredMessage(lineIndex + 1, line.accountNumber),
        lineIndex,
      });
    }
  });

  if (amountsAreValid && !totalDebit.equals(totalCredit)) {
    errors.push({
      code: "UNBALANCED",
      message: `Écriture déséquilibrée : débit ${totalDebit.toString()}, crédit ${totalCredit.toString()}.`,
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Message à trois temps du « projet obligatoire » (ce qui s'est passé, pourquoi, que faire), partagé par le contrôle du
 * domaine et par la traduction du refus de la base : une seule formulation, quel que soit le chemin qui la déclenche.
 */
export function projectRequiredMessage(lineNumber: number, accountNumber: string): string {
  return (
    `Ligne ${lineNumber} (compte ${accountNumber}) : cette dépense ou cette recette n'est rattachée à aucun projet, ` +
    "or votre comptabilité demande de rattacher chacune à un projet, pour savoir ce que chaque projet coûte et rapporte. " +
    "À faire : choisissez le projet de cette ligne ; pour les dépenses et recettes courantes de l'association, « Fonctionnement » convient."
  );
}
