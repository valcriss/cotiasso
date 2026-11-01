export interface ModuleDefinition {
  key: string;
  label: string;
  description: string;
  /** Faux tant que le module n'est pas implémenté ET validé sur le jeu de référence (ADR 0003). */
  available: boolean;
  /** Motif affiché quand le module est indisponible. */
  unavailableReason?: string;
  /** Modules qui doivent être actifs avant celui-ci. */
  requires?: string[];
}

export const MODULE_CATALOG = Symbol("MODULE_CATALOG");

const NOT_DELIVERED = "Non livré : le module sera activable une fois implémenté et validé sur le jeu de référence.";

/**
 * Modules fonctionnels optionnels (ADR 0002 et 0003), dans l'ordre de livraison validé. Aucun n'est disponible
 * pour l'instant : l'activer avec un traitement incomplet est interdit (cadrage §3).
 */
export const DEFAULT_MODULES: readonly ModuleDefinition[] = [
  {
    key: "accrued-invoices",
    label: "Factures non parvenues et dettes",
    description: "Charges à payer constatées en fin d'exercice, contrepassées à l'ouverture.",
    available: false,
    unavailableReason: NOT_DELIVERED,
  },
  {
    key: "deferred-items",
    label: "Charges et produits constatés d'avance",
    description: "Rattachement des charges et produits à l'exercice concerné.",
    available: false,
    unavailableReason: NOT_DELIVERED,
  },
  {
    key: "fixed-assets",
    label: "Immobilisations et amortissements",
    description: "Registre des immobilisations, plans d'amortissement et dotations à la clôture.",
    available: false,
    unavailableReason: NOT_DELIVERED,
  },
  {
    key: "vat-subject",
    label: "TVA : assujettie",
    description: "Comptabilisation HT, TVA et TTC avec taux historisés.",
    available: false,
    unavailableReason: NOT_DELIVERED,
  },
  {
    key: "earmarked-funds",
    label: "Fonds dédiés",
    description: "Suivi des ressources affectées par les conventions de financement.",
    available: false,
    unavailableReason: `${NOT_DELIVERED} Suppose le module Subventions.`,
  },
  {
    key: "vat-mixed",
    label: "TVA : activité mixte",
    description: "Déductibilité partielle de la TVA.",
    available: false,
    unavailableReason: `${NOT_DELIVERED} Exige la validation d'un expert.`,
    requires: ["vat-subject"],
  },
];
