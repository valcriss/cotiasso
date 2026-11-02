import { Money } from "@cotiasso/accounting-domain";

/**
 * Catalogue des rubriques du compte de résultat et du bilan (ADR 0020). Les préfixes sont indicatifs : le plan comptable
 * associatif et ses rubriques restent à faire valider par le trésorier du pilote.
 */

export interface IncomeRubric {
  code: string;
  label: string;
  /** Sens du compte de résultat : un produit se lit au crédit, une charge au débit. */
  side: "PRODUCT" | "CHARGE";
  section: IncomeSectionCode;
  prefixes: string[];
}

export type IncomeSectionCode = "OPERATING_PRODUCTS" | "OPERATING_CHARGES" | "FINANCIAL_PRODUCTS" | "FINANCIAL_CHARGES" | "EXCEPTIONAL_PRODUCTS" | "EXCEPTIONAL_CHARGES" | "RESTRICTED_PRODUCTS" | "RESTRICTED_CHARGES" | "TAXES";

export const INCOME_SECTIONS: { code: IncomeSectionCode; label: string; side: "PRODUCT" | "CHARGE"; help: string }[] = [
  { code: "OPERATING_PRODUCTS", label: "Produits d'exploitation", side: "PRODUCT", help: "L'argent gagné par l'activité courante : cotisations, ventes, subventions." },
  { code: "OPERATING_CHARGES", label: "Charges d'exploitation", side: "CHARGE", help: "Ce que coûte l'activité courante : achats, services, salaires, amortissements." },
  { code: "FINANCIAL_PRODUCTS", label: "Produits financiers", side: "PRODUCT", help: "Intérêts reçus des placements." },
  { code: "FINANCIAL_CHARGES", label: "Charges financières", side: "CHARGE", help: "Intérêts et frais financiers payés." },
  { code: "EXCEPTIONAL_PRODUCTS", label: "Produits exceptionnels", side: "PRODUCT", help: "Gains qui ne reviendront pas chaque année (vente d'un bien, régularisation)." },
  { code: "EXCEPTIONAL_CHARGES", label: "Charges exceptionnelles", side: "CHARGE", help: "Dépenses qui ne reviendront pas chaque année." },
  { code: "RESTRICTED_PRODUCTS", label: "Report de ressources affectées", side: "PRODUCT", help: "Ressources reçues les années passées et utilisées cette année (fonds dédiés)." },
  { code: "RESTRICTED_CHARGES", label: "Engagements sur ressources affectées", side: "CHARGE", help: "Ressources reçues cette année mais pas encore utilisées (fonds dédiés)." },
  { code: "TAXES", label: "Impôts sur les bénéfices", side: "CHARGE", help: "Impôts sur les activités lucratives, le cas échéant." },
];

export const INCOME_RUBRICS: IncomeRubric[] = [
  { code: "PRO_VENTES", label: "Ventes et prestations de services", side: "PRODUCT", section: "OPERATING_PRODUCTS", prefixes: ["70"] },
  { code: "PRO_SUBV", label: "Subventions d'exploitation", side: "PRODUCT", section: "OPERATING_PRODUCTS", prefixes: ["74"] },
  { code: "PRO_COTIS", label: "Cotisations", side: "PRODUCT", section: "OPERATING_PRODUCTS", prefixes: ["756"] },
  { code: "PRO_AUTRES", label: "Autres produits (dons, autres produits de gestion)", side: "PRODUCT", section: "OPERATING_PRODUCTS", prefixes: ["71", "72", "73", "75", "79"] },
  { code: "PRO_REPRISES", label: "Reprises sur amortissements et provisions", side: "PRODUCT", section: "OPERATING_PRODUCTS", prefixes: ["78"] },
  { code: "CHG_ACHATS", label: "Achats", side: "CHARGE", section: "OPERATING_CHARGES", prefixes: ["60"] },
  { code: "CHG_EXT", label: "Services extérieurs", side: "CHARGE", section: "OPERATING_CHARGES", prefixes: ["61", "62"] },
  { code: "CHG_IMPOTS", label: "Impôts et taxes", side: "CHARGE", section: "OPERATING_CHARGES", prefixes: ["63"] },
  { code: "CHG_PERSO", label: "Charges de personnel", side: "CHARGE", section: "OPERATING_CHARGES", prefixes: ["64"] },
  { code: "CHG_AUTRES", label: "Autres charges de gestion", side: "CHARGE", section: "OPERATING_CHARGES", prefixes: ["65"] },
  { code: "CHG_DOT", label: "Dotations aux amortissements et provisions", side: "CHARGE", section: "OPERATING_CHARGES", prefixes: ["68"] },
  { code: "PRO_FIN", label: "Produits financiers", side: "PRODUCT", section: "FINANCIAL_PRODUCTS", prefixes: ["76"] },
  { code: "CHG_FIN", label: "Charges financières", side: "CHARGE", section: "FINANCIAL_CHARGES", prefixes: ["66"] },
  { code: "PRO_EXC", label: "Produits exceptionnels", side: "PRODUCT", section: "EXCEPTIONAL_PRODUCTS", prefixes: ["77"] },
  { code: "CHG_EXC", label: "Charges exceptionnelles", side: "CHARGE", section: "EXCEPTIONAL_CHARGES", prefixes: ["67"] },
  { code: "PRO_FONDS", label: "Report des ressources non utilisées des exercices antérieurs", side: "PRODUCT", section: "RESTRICTED_PRODUCTS", prefixes: ["789"] },
  { code: "CHG_FONDS", label: "Engagements à réaliser sur ressources affectées", side: "CHARGE", section: "RESTRICTED_CHARGES", prefixes: ["689"] },
  { code: "CHG_IS", label: "Impôts sur les bénéfices", side: "CHARGE", section: "TAXES", prefixes: ["69"] },
];

export interface BalanceRubric {
  code: string;
  label: string;
  side: "ASSET" | "LIABILITY";
  group: string;
}

export const BALANCE_GROUPS: { code: string; label: string; side: "ASSET" | "LIABILITY"; help: string }[] = [
  { code: "FIXED_ASSETS", label: "Actif immobilisé", side: "ASSET", help: "Ce que l'association possède durablement (matériel, locaux), après amortissement." },
  { code: "CURRENT_ASSETS", label: "Actif circulant", side: "ASSET", help: "Ce qu'on vous doit (créances) et les stocks." },
  { code: "CASH", label: "Disponibilités", side: "ASSET", help: "L'argent en banque et en caisse." },
  { code: "ASSET_ADJUSTMENTS", label: "Comptes de régularisation (actif)", side: "ASSET", help: "Charges payées d'avance." },
  { code: "EQUITY", label: "Fonds propres", side: "LIABILITY", help: "La richesse de l'association : fonds apportés, résultats cumulés, résultat de l'année." },
  { code: "RESTRICTED", label: "Fonds dédiés", side: "LIABILITY", help: "Ressources reçues pour un usage précis, pas encore utilisées." },
  { code: "PROVISIONS", label: "Provisions", side: "LIABILITY", help: "Sommes mises de côté pour un risque ou une charge à venir." },
  { code: "DEBTS", label: "Dettes", side: "LIABILITY", help: "Ce que l'association doit : fournisseurs, emprunts, découvert." },
  { code: "LIABILITY_ADJUSTMENTS", label: "Comptes de régularisation (passif)", side: "LIABILITY", help: "Produits encaissés d'avance." },
];

export const BALANCE_RUBRICS: BalanceRubric[] = [
  { code: "ACT_IMMO", label: "Immobilisations (valeur brute)", side: "ASSET", group: "FIXED_ASSETS" },
  { code: "ACT_AMORT", label: "Amortissements et dépréciations", side: "ASSET", group: "FIXED_ASSETS" },
  { code: "ACT_STOCKS", label: "Stocks", side: "ASSET", group: "CURRENT_ASSETS" },
  { code: "ACT_CREANCES", label: "Créances (ce qu'on vous doit)", side: "ASSET", group: "CURRENT_ASSETS" },
  { code: "ACT_DISPO", label: "Banque et caisse", side: "ASSET", group: "CASH" },
  { code: "ACT_REGUL", label: "Charges constatées d'avance", side: "ASSET", group: "ASSET_ADJUSTMENTS" },
  { code: "PAS_FONDS", label: "Fonds associatifs et report à nouveau", side: "LIABILITY", group: "EQUITY" },
  { code: "PAS_RESULTAT", label: "Résultat de l'exercice", side: "LIABILITY", group: "EQUITY" },
  { code: "PAS_SUBV_INV", label: "Subventions d'investissement", side: "LIABILITY", group: "EQUITY" },
  { code: "PAS_FONDS_DEDIES", label: "Fonds dédiés", side: "LIABILITY", group: "RESTRICTED" },
  { code: "PAS_PROV", label: "Provisions", side: "LIABILITY", group: "PROVISIONS" },
  { code: "PAS_EMPRUNTS", label: "Emprunts", side: "LIABILITY", group: "DEBTS" },
  { code: "PAS_DETTES", label: "Dettes (fournisseurs, tiers, découvert)", side: "LIABILITY", group: "DEBTS" },
  { code: "PAS_REGUL", label: "Produits constatés d'avance", side: "LIABILITY", group: "LIABILITY_ADJUSTMENTS" },
];

const longestPrefix = <T extends { prefixes: string[] }>(items: T[], number: string): T | null => {
  let best: { item: T; length: number } | null = null;
  for (const item of items) {
    for (const prefix of item.prefixes) {
      if (number.startsWith(prefix) && (!best || prefix.length > best.length)) best = { item, length: prefix.length };
    }
  }
  return best?.item ?? null;
};

/**
 * Rubrique du compte de résultat d'un compte de classe 6 ou 7 : le code imposé par `reportLine` s'il existe, sinon le
 * rattachement par numéro ; une classe 6 ou 7 inconnue tombe dans « autres charges » ou « autres produits ».
 */
export function incomeRubricFor(number: string, reportLine: string | null): { rubric: IncomeRubric; byDefault: boolean } | null {
  if (!/^[67]/.test(number)) return null;
  const side = number.startsWith("6") ? "CHARGE" : "PRODUCT";
  const forced = reportLine ? INCOME_RUBRICS.find((r) => r.code === reportLine && r.side === side) : undefined;
  if (forced) return { rubric: forced, byDefault: false };
  const found = longestPrefix(INCOME_RUBRICS.filter((r) => r.side === side), number) ?? INCOME_RUBRICS.find((r) => r.code === (side === "CHARGE" ? "CHG_AUTRES" : "PRO_AUTRES"))!;
  return { rubric: found, byDefault: true };
}

/** Rubrique du bilan d'un compte des classes 1 à 5 ; le sens du solde décide pour les tiers (4) et la trésorerie (5). */
export function balanceRubricFor(number: string, net: Money): BalanceRubric | null {
  const rubric = (code: string) => BALANCE_RUBRICS.find((r) => r.code === code)!;
  const debit = !net.isNegative();
  if (number.startsWith("28") || number.startsWith("29")) return rubric("ACT_AMORT");
  if (number.startsWith("2")) return rubric("ACT_IMMO");
  if (number.startsWith("3")) return rubric("ACT_STOCKS");
  if (number.startsWith("48")) return rubric(debit ? "ACT_REGUL" : "PAS_REGUL");
  if (number.startsWith("4")) return rubric(debit ? "ACT_CREANCES" : "PAS_DETTES");
  if (number.startsWith("5")) return rubric(debit ? "ACT_DISPO" : "PAS_DETTES");
  if (number.startsWith("19")) return rubric("PAS_FONDS_DEDIES");
  if (number.startsWith("13")) return rubric("PAS_SUBV_INV");
  if (number.startsWith("14") || number.startsWith("15")) return rubric("PAS_PROV");
  if (/^1[678]/.test(number)) return rubric("PAS_EMPRUNTS");
  if (number.startsWith("1")) return rubric("PAS_FONDS");
  return null;
}

export interface AccountNet {
  number: string;
  label: string;
  reportLine: string | null;
  /** Débit moins crédit sur l'exercice. */
  net: Money;
}

export interface StatementRow {
  code: string;
  label: string;
  amount: string;
}

export interface StatementGroup {
  code: string;
  label: string;
  help: string;
  rows: StatementRow[];
  total: string;
}

export interface IncomeComputation {
  sections: StatementGroup[];
  intermediate: { code: "OPERATING" | "FINANCIAL" | "EXCEPTIONAL"; label: string; amount: string }[];
  products: string;
  charges: string;
  result: string;
  defaulted: { number: string; label: string }[];
  unclassified: { number: string; label: string; amount: string }[];
}

const sum = (values: Money[]) => values.reduce((total, value) => total.add(value), Money.zero());

/** Compte de résultat d'un exercice à partir des soldes nets de ses comptes (ADR 0020). */
export function computeIncome(accounts: AccountNet[]): IncomeComputation {
  const amounts = new Map<string, Money>();
  const defaulted: IncomeComputation["defaulted"] = [];
  for (const account of accounts) {
    const found = incomeRubricFor(account.number, account.reportLine);
    if (!found || account.net.isZero()) continue;
    // Un produit se lit au crédit (net négatif) ; une charge au débit.
    const amount = found.rubric.side === "PRODUCT" ? Money.zero().subtract(account.net) : account.net;
    amounts.set(found.rubric.code, (amounts.get(found.rubric.code) ?? Money.zero()).add(amount));
    if (found.byDefault) defaulted.push({ number: account.number, label: account.label });
  }
  const sections: StatementGroup[] = INCOME_SECTIONS.map((section) => {
    const rows = INCOME_RUBRICS.filter((r) => r.section === section.code).map((r) => ({ code: r.code, label: r.label, amount: (amounts.get(r.code) ?? Money.zero()).toString() }));
    return { code: section.code, label: section.label, help: section.help, rows, total: sum(rows.map((r) => Money.parse(r.amount))).toString() };
  });
  const total = (code: IncomeSectionCode) => Money.parse(sections.find((s) => s.code === code)!.total);
  const products = sum((["OPERATING_PRODUCTS", "FINANCIAL_PRODUCTS", "EXCEPTIONAL_PRODUCTS", "RESTRICTED_PRODUCTS"] as const).map(total));
  const charges = sum((["OPERATING_CHARGES", "FINANCIAL_CHARGES", "EXCEPTIONAL_CHARGES", "RESTRICTED_CHARGES", "TAXES"] as const).map(total));
  const unclassified = accounts
    .filter((a) => /^8/.test(a.number) && !a.net.isZero())
    .map((a) => ({ number: a.number, label: a.label, amount: a.net.toString() }));
  return {
    sections,
    intermediate: [
      { code: "OPERATING", label: "Résultat d'exploitation", amount: total("OPERATING_PRODUCTS").subtract(total("OPERATING_CHARGES")).toString() },
      { code: "FINANCIAL", label: "Résultat financier", amount: total("FINANCIAL_PRODUCTS").subtract(total("FINANCIAL_CHARGES")).toString() },
      { code: "EXCEPTIONAL", label: "Résultat exceptionnel", amount: total("EXCEPTIONAL_PRODUCTS").subtract(total("EXCEPTIONAL_CHARGES")).toString() },
    ],
    products: products.toString(),
    charges: charges.toString(),
    result: products.subtract(charges).toString(),
    defaulted,
    unclassified,
  };
}

export interface BalanceComputation {
  groups: StatementGroup[];
  totalAssets: string;
  totalLiabilities: string;
  /** Actif moins passif : doit être nul. */
  difference: string;
  balanced: boolean;
  result: string;
  unclassified: { number: string; label: string; amount: string }[];
}

/** Bilan d'un exercice : classes 1 à 5 par rubrique, plus le résultat de l'exercice (classes 6 et 7) aux fonds propres. */
export function computeBalance(accounts: AccountNet[]): BalanceComputation {
  const amounts = new Map<string, Money>();
  let result = Money.zero();
  const unclassified: BalanceComputation["unclassified"] = [];
  for (const account of accounts) {
    if (account.net.isZero()) continue;
    if (/^[67]/.test(account.number)) {
      result = result.subtract(account.net);
      continue;
    }
    const rubric = balanceRubricFor(account.number, account.net);
    if (!rubric) {
      unclassified.push({ number: account.number, label: account.label, amount: account.net.toString() });
      continue;
    }
    // Actif : débit moins crédit ; passif : crédit moins débit (un solde contraire donne un montant négatif, en déduction).
    const amount = rubric.side === "ASSET" ? account.net : Money.zero().subtract(account.net);
    amounts.set(rubric.code, (amounts.get(rubric.code) ?? Money.zero()).add(amount));
  }
  amounts.set("PAS_RESULTAT", (amounts.get("PAS_RESULTAT") ?? Money.zero()).add(result));
  const groups: StatementGroup[] = BALANCE_GROUPS.map((group) => {
    const rows = BALANCE_RUBRICS.filter((r) => r.group === group.code).map((r) => ({ code: r.code, label: r.label, amount: (amounts.get(r.code) ?? Money.zero()).toString() }));
    return { code: group.code, label: group.label, help: group.help, rows, total: sum(rows.map((r) => Money.parse(r.amount))).toString() };
  });
  const totalOf = (side: "ASSET" | "LIABILITY") =>
    sum(BALANCE_GROUPS.filter((g) => g.side === side).map((g) => Money.parse(groups.find((x) => x.code === g.code)!.total)));
  const assets = totalOf("ASSET");
  const liabilities = totalOf("LIABILITY");
  return {
    groups,
    totalAssets: assets.toString(),
    totalLiabilities: liabilities.toString(),
    difference: assets.subtract(liabilities).toString(),
    balanced: assets.equals(liabilities),
    result: result.toString(),
    unclassified,
  };
}
