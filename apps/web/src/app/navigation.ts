export interface NavigationItem {
  path: string;
  label: string;
  icon: string;
  /** Permission exigée pour voir et ouvrir la rubrique ; absente = tout utilisateur connecté. */
  permission?: string;
  /**
   * La rubrique exige le droit **global** : un droit limité à un projet ne suffit pas. Les documents d'un projet se lisent depuis
   * sa fiche (ADR 0024, tranche 4.5), pas depuis la page Documents générale.
   */
  global?: boolean;
  /** Rubrique réservée à l'affichage « Comptable » (ADR 0028) : masquée du menu en affichage simple, l'adresse reste ouverte. */
  expert?: boolean;
}

/**
 * Arborescence cible du cadrage (§7.2). Le menu est filtré selon les permissions, mais seul le serveur fait foi :
 * chaque route de l'API vérifie elle-même les droits.
 */
export const NAVIGATION: readonly NavigationItem[] = [
  { path: 'vue-d-ensemble', label: "Vue d'ensemble", icon: 'dashboard' },
  { path: 'comptes', label: 'Comptes', icon: 'account_balance', permission: 'financial-accounts:view' },
  { path: 'comptabilite', label: 'Comptabilité', icon: 'menu_book', permission: 'entries:view', expert: true },
  { path: 'membres', label: 'Membres et cotisations', icon: 'groups', permission: 'members:view' },
  { path: 'projets', label: 'Projets', icon: 'folder_open', permission: 'projects:view' },
  { path: 'subventions', label: 'Subventions', icon: 'payments', permission: 'grants:view' },
  { path: 'rapports', label: 'Rapports', icon: 'bar_chart', permission: 'reports:view' },
  { path: 'documents', label: 'Documents', icon: 'description', permission: 'documents:view', global: true },
];

/** Assistant de démarrage : ajouté au menu par le shell tant qu'une étape de préparation manque (voir `SetupStatus`). */
export const START_ITEM: NavigationItem = {
  path: 'demarrage',
  label: 'Démarrer',
  icon: 'rocket_launch',
  permission: 'settings.accounting:admin',
  global: true,
};

export const SETTINGS_ITEM: NavigationItem = {
  path: 'parametres',
  label: 'Paramètres',
  icon: 'settings',
  permission: 'settings.association:view',
};
