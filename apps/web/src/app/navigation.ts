export interface NavigationItem {
  path: string;
  label: string;
  icon: string;
  /** Permission exigée pour voir et ouvrir la rubrique ; absente = tout utilisateur connecté. */
  permission?: string;
}

/**
 * Arborescence cible du cadrage (§7.2). Le menu est filtré selon les permissions, mais seul le serveur fait foi :
 * chaque route de l'API vérifie elle-même les droits.
 */
export const NAVIGATION: readonly NavigationItem[] = [
  { path: 'vue-d-ensemble', label: "Vue d'ensemble", icon: 'dashboard' },
  { path: 'comptes', label: 'Comptes', icon: 'account_balance', permission: 'financial-accounts:view' },
  { path: 'comptabilite', label: 'Comptabilité', icon: 'menu_book', permission: 'entries:view' },
  { path: 'membres', label: 'Membres et cotisations', icon: 'groups', permission: 'members:view' },
  { path: 'projets', label: 'Projets', icon: 'folder_open', permission: 'projects:view' },
  { path: 'subventions', label: 'Subventions', icon: 'payments', permission: 'grants:view' },
  { path: 'rapports', label: 'Rapports', icon: 'bar_chart', permission: 'reports:view' },
  { path: 'documents', label: 'Documents', icon: 'description', permission: 'documents:view' },
];

export const SETTINGS_ITEM: NavigationItem = {
  path: 'parametres',
  label: 'Paramètres',
  icon: 'settings',
  permission: 'settings.association:view',
};
