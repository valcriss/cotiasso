/**
 * Modèle de démarrage (ADR 0028) : un petit plan de comptes associatif et les catégories en langage courant qui s'y
 * rattachent. C'est une **proposition à faire relire par un expert-comptable** : l'application n'affirme aucune
 * conformité. Rien n'est écrasé : un numéro de compte ou une catégorie déjà présents sont laissés tels quels.
 */
export interface TemplateAccount {
  number: string;
  label: string;
}

export interface TemplateCategory {
  direction: "IN" | "OUT";
  label: string;
  hint: string;
  accountNumber: string;
  /** Rôle particulier : catégorie proposée d'office pour un règlement de cotisation ou un versement de subvention. */
  usage?: "MEMBERSHIP" | "GRANT";
}

export const TEMPLATE_ACCOUNTS: readonly TemplateAccount[] = [
  { number: "102", label: "Fonds associatifs sans droit de reprise" },
  { number: "110", label: "Report à nouveau" },
  { number: "120", label: "Résultat de l'exercice (excédent)" },
  { number: "129", label: "Résultat de l'exercice (déficit)" },
  { number: "512", label: "Banque" },
  { number: "530", label: "Caisse" },
  { number: "606", label: "Achats non stockés (fournitures, petit matériel)" },
  { number: "613", label: "Locations" },
  { number: "615", label: "Entretien et réparations" },
  { number: "616", label: "Primes d'assurance" },
  { number: "622", label: "Honoraires et intervenants extérieurs" },
  { number: "623", label: "Publicité et communication" },
  { number: "625", label: "Déplacements, missions et réceptions" },
  { number: "626", label: "Frais postaux et de télécommunications" },
  { number: "627", label: "Services bancaires" },
  { number: "658", label: "Charges diverses de gestion courante" },
  { number: "706", label: "Prestations de services" },
  { number: "707", label: "Ventes de marchandises" },
  { number: "740", label: "Subventions d'exploitation" },
  { number: "754", label: "Dons et libéralités" },
  { number: "756", label: "Cotisations" },
  { number: "758", label: "Produits divers de gestion courante" },
  { number: "768", label: "Autres produits financiers (intérêts)" },
];

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  { direction: "OUT", label: "Fournitures et petit matériel", hint: "Papeterie, consommables, petit équipement.", accountNumber: "606" },
  { direction: "OUT", label: "Location de salle ou de matériel", hint: "Salle prêtée contre loyer, matériel loué pour un évènement.", accountNumber: "613" },
  { direction: "OUT", label: "Entretien et réparations", hint: "Remise en état de matériel ou de locaux.", accountNumber: "615" },
  { direction: "OUT", label: "Assurance", hint: "Prime d'assurance de l'association.", accountNumber: "616" },
  { direction: "OUT", label: "Intervenant ou prestataire extérieur", hint: "Facture d'une personne ou d'une société qui a travaillé pour vous.", accountNumber: "622" },
  { direction: "OUT", label: "Communication et publicité", hint: "Affiches, impressions, site internet, publicité.", accountNumber: "623" },
  { direction: "OUT", label: "Déplacements, repas et réceptions", hint: "Transport, hébergement, repas lors d'un évènement.", accountNumber: "625" },
  { direction: "OUT", label: "Courrier et téléphone", hint: "Timbres, envois postaux, abonnements téléphone et internet.", accountNumber: "626" },
  { direction: "OUT", label: "Frais bancaires", hint: "Commissions et frais de tenue de compte.", accountNumber: "627" },
  { direction: "OUT", label: "Autre dépense", hint: "À utiliser si aucune autre catégorie ne convient.", accountNumber: "658" },
  { direction: "IN", label: "Cotisations des adhérents", hint: "Argent reçu pour une adhésion. L'affectation à un adhérent se fait ensuite dans « Membres ».", accountNumber: "756", usage: "MEMBERSHIP" },
  { direction: "IN", label: "Dons", hint: "Argent donné sans contrepartie.", accountNumber: "754" },
  { direction: "IN", label: "Subvention", hint: "Argent versé par une collectivité, un organisme ou une fondation.", accountNumber: "740", usage: "GRANT" },
  { direction: "IN", label: "Participation à une activité ou billetterie", hint: "Entrées, inscriptions, stages, prestations payés par le public.", accountNumber: "706" },
  { direction: "IN", label: "Vente (buvette, objets…)", hint: "Ventes de produits : buvette, vide-grenier, objets.", accountNumber: "707" },
  { direction: "IN", label: "Intérêts bancaires", hint: "Intérêts versés par la banque sur un livret.", accountNumber: "768" },
  { direction: "IN", label: "Autre recette", hint: "À utiliser si aucune autre catégorie ne convient.", accountNumber: "758" },
];
