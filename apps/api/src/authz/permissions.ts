/**
 * Catalogue des permissions (matrice des droits, docs/lot0/04-matrice-droits.md). Format `ressource:action`.
 * Les rôles sont des ensembles modifiables de ces permissions ; le code ne teste jamais un nom de rôle.
 */
export const PERMISSIONS = {
  "settings.association:view": "Consulter les paramètres de l'association",
  "settings.association:admin": "Administrer l'identité, l'apparence et les accès",
  "settings.accounting:admin": "Administrer les paramètres comptables (exercices, plan, TVA, modules)",
  "users:view": "Consulter les utilisateurs, rôles et accès",
  "users:admin": "Administrer les utilisateurs, rôles et attributions",
  "members:view": "Consulter les membres",
  "members:manage": "Gérer les membres et les cotisations",
  "financial-accounts:view": "Consulter les comptes financiers et les transactions",
  "transactions:manage": "Créer et modifier les transactions",
  "imports:post": "Importer des relevés et rapprocher",
  "entries:view": "Consulter les écritures",
  "entries:create": "Créer des écritures en brouillon",
  "entries:post": "Comptabiliser les écritures",
  "fiscal-years:close": "Clôturer un exercice",
  "projects:view": "Consulter les synthèses de projet",
  "projects:update": "Modifier les projets",
  "budgets:update": "Modifier les budgets",
  "budgets:approve": "Approuver les budgets",
  "grants:view": "Consulter les subventions",
  "grants:manage": "Gérer les subventions",
  "expenses:submit": "Soumettre des demandes de dépense",
  "expenses:approve": "Approuver des demandes de dépense",
  "documents:view": "Consulter les documents",
  "documents:create": "Déposer des documents",
  "documents.restricted:view": "Consulter les documents restreints",
  "workflows:admin": "Administrer les workflows",
  "reports:view": "Consulter les rapports",
  "reports:export": "Exporter les rapports",
  "data:export": "Exporter l'ensemble des données",
  "backups:admin": "Administrer les sauvegardes et restaurations",
  "audit:view": "Consulter le journal d'audit",
} as const;

export type Permission = keyof typeof PERMISSIONS;

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
