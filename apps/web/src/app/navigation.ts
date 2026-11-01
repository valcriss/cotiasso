export interface NavigationItem {
  path: string;
  label: string;
  icon: string;
}

/** Arborescence cible du cadrage (§7.2). Le filtrage par permissions viendra avec le lot 1.3. */
export const NAVIGATION: readonly NavigationItem[] = [
  { path: 'vue-d-ensemble', label: "Vue d'ensemble", icon: 'dashboard' },
  { path: 'comptes', label: 'Comptes', icon: 'account_balance' },
  { path: 'comptabilite', label: 'Comptabilité', icon: 'menu_book' },
  { path: 'membres', label: 'Membres et cotisations', icon: 'groups' },
  { path: 'projets', label: 'Projets', icon: 'folder_open' },
  { path: 'subventions', label: 'Subventions', icon: 'payments' },
  { path: 'rapports', label: 'Rapports', icon: 'bar_chart' },
  { path: 'documents', label: 'Documents', icon: 'description' },
];

export const SETTINGS_ITEM: NavigationItem = {
  path: 'parametres',
  label: 'Paramètres',
  icon: 'settings',
};
