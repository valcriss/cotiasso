/**
 * Catalogue des permissions (matrice des droits, docs/lot0/04-matrice-droits.md). Format `ressource:action`.
 * Les rôles sont des ensembles modifiables de ces permissions ; le code ne teste jamais un nom de rôle.
 */
export const PERMISSIONS = {
  "settings.association:view": "Voir les informations et l'apparence de l'association",
  "settings.association:admin": "Modifier les informations, l'apparence et les accès de l'association",
  "settings.accounting:admin": "Régler la comptabilité (périodes, catégories, comptes, modules)",
  "users:view": "Voir qui a un compte et quels droits il a",
  "users:admin": "Créer des comptes, donner ou retirer des droits",
  "members:view": "Voir la liste des membres",
  "members:manage": "Ajouter et modifier les membres, enregistrer les cotisations",
  "financial-accounts:view": "Voir les comptes bancaires et leurs mouvements",
  "transactions:manage": "Saisir et classer les mouvements d'argent",
  "imports:post": "Importer le relevé de la banque et le comparer à vos enregistrements",
  "entries:view": "Voir les écritures comptables",
  "entries:create": "Préparer des opérations en brouillon",
  "entries:post": "Enregistrer définitivement les opérations dans les comptes",
  "fiscal-years:close": "Clôturer la période (arrêter les comptes de l'année)",
  "projects:view": "Voir les projets et ce qu'ils coûtent et rapportent",
  "projects:update": "Créer et modifier les projets",
  "budgets:update": "Préparer les budgets des projets",
  "budgets:approve": "Approuver un budget de projet",
  "grants:view": "Voir les subventions",
  "grants:manage": "Suivre les subventions (demandes, versements, dépenses, clôture)",
  "expenses:submit": "Demander l'accord pour une dépense",
  "expenses:approve": "Accorder ou refuser une demande de dépense",
  "documents:view": "Voir les documents",
  "documents:create": "Ajouter des documents et des pièces jointes",
  "documents.restricted:view": "Voir les documents confidentiels",
  "workflows:admin": "Régler les circuits de validation",
  "reports:view": "Voir les rapports (compte de résultat, bilan…)",
  "reports:export": "Télécharger ou imprimer les rapports",
  "data:export": "Télécharger toutes les données de l'association",
  "backups:admin": "Gérer les sauvegardes et les mises à jour",
  "audit:view": "Voir l'historique de qui a fait quoi",
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Droits à confier avec soin : ils donnent accès à la sécurité de l'application, ou rendent définitifs des comptes, ou sortent toutes
 * les données. L'écran des rôles les signale, sans les interdire (un rôle reste un choix de l'association).
 */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  "users:admin",
  "settings.association:admin",
  "entries:post",
  "fiscal-years:close",
  "documents.restricted:view",
  "data:export",
  "backups:admin",
];

export const isSensitive = (permission: string): boolean => (SENSITIVE_PERMISSIONS as readonly string[]).includes(permission);

/**
 * Permissions qui s'exercent aussi sur UN projet (ADR 0022). Une attribution de rôle à portée projet n'accorde que
 * l'intersection entre les droits du rôle et cette liste ; le reste n'est jamais accordé globalement par ce biais.
 */
export const PROJECT_SCOPABLE_PERMISSIONS: readonly Permission[] = ["projects:view", "projects:update", "grants:view", "documents:view", "documents:create"];

export const isProjectScopable = (permission: string): boolean => (PROJECT_SCOPABLE_PERMISSIONS as readonly string[]).includes(permission);

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
