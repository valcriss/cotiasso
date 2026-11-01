import type { Permission } from "./permissions.js";

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

/**
 * Rôles modèles installés au démarrage de l'association (matrice des droits v0.2). Ils sont modifiables ensuite :
 * le président ne reçoit pas de droits comptables par défaut, l'administrateur technique n'a aucun droit métier,
 * et l'export complet des données n'est attribué à personne.
 */
export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    key: "technical-admin",
    name: "Administrateur technique",
    description: "Configuration, accès et exploitation ; aucun droit métier par défaut.",
    permissions: [
      "settings.association:view",
      "settings.association:admin",
      "users:view",
      "users:admin",
      "backups:admin",
      "audit:view",
    ],
  },
  {
    key: "president",
    name: "Président",
    description: "Consultation générale, documents du bureau, administration des workflows.",
    permissions: [
      "settings.association:view",
      "users:view",
      "members:view",
      "financial-accounts:view",
      "entries:view",
      "projects:view",
      "grants:view",
      "documents:view",
      "documents.restricted:view",
      "workflows:admin",
      "reports:view",
      "audit:view",
    ],
  },
  {
    key: "treasurer",
    name: "Trésorier",
    description: "Comptes, cotisations, comptabilité, rapports et clôture.",
    permissions: [
      "settings.association:view",
      "settings.accounting:admin",
      "users:view",
      "members:view",
      "members:manage",
      "financial-accounts:view",
      "transactions:manage",
      "imports:post",
      "entries:view",
      "entries:create",
      "entries:post",
      "fiscal-years:close",
      "projects:view",
      "projects:update",
      "budgets:update",
      "grants:view",
      "grants:manage",
      "expenses:submit",
      "documents:view",
      "documents:create",
      "documents.restricted:view",
      "workflows:admin",
      "reports:view",
      "reports:export",
      "audit:view",
    ],
  },
  {
    key: "board-member",
    name: "Membre du bureau",
    description: "Tableaux de bord et documents autorisés, approbation des budgets.",
    permissions: [
      "settings.association:view",
      "members:view",
      "financial-accounts:view",
      "entries:view",
      "projects:view",
      "budgets:approve",
      "grants:view",
      "expenses:submit",
      "documents:view",
      "documents:create",
      "reports:view",
    ],
  },
  {
    key: "project-manager",
    name: "Responsable de projet",
    description: "Gestion opérationnelle de ses projets, budgets et documents.",
    permissions: [
      "financial-accounts:view",
      "entries:view",
      "projects:view",
      "projects:update",
      "budgets:update",
      "grants:view",
      "expenses:submit",
      "expenses:approve",
      "documents:view",
      "documents:create",
      "reports:view",
    ],
  },
  {
    key: "contributor",
    name: "Contributeur",
    description: "Dépôt de pièces et demandes sur les projets autorisés.",
    permissions: ["projects:view", "expenses:submit", "documents:view", "documents:create"],
  },
  {
    key: "reader",
    name: "Lecteur",
    description: "Consultation des synthèses et documents autorisés.",
    permissions: ["projects:view", "documents:view"],
  },
];

export const ADMIN_ROLE_KEY = "technical-admin";

/** Permission dont la perte totale verrouillerait l'installation : au moins un compte actif doit la détenir. */
export const LOCKOUT_PERMISSION: Permission = "users:admin";
