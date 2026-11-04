import { Route, Routes } from '@angular/router';
import { authGuard, loginGuard, mfaEnrollGuard, mfaVerifyGuard, permissionGuard, setupGuard } from './auth/guards';
import { NAVIGATION, SETTINGS_ITEM } from './navigation';

const [overview, ...others] = NAVIGATION;

/** Page de liste et page de détail d'un même écran : `/<path>` et `/<path>/:id`, mêmes droits, même composant. */
function detailRoutes(options: { path: string; title: string; permission: string; global?: boolean; load: Route['loadComponent'] }): Routes {
  const common = {
    title: options.title,
    canActivate: [permissionGuard],
    data: options.global ? { permission: options.permission, global: true } : { permission: options.permission },
    loadComponent: options.load,
  };
  return [
    { path: options.path, ...common },
    { path: `${options.path}/:id`, ...common },
  ];
}

export const routes: Routes = [
  {
    path: 'connexion',
    title: 'Connexion',
    canActivate: [loginGuard],
    loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'reinitialisation',
    title: 'Nouveau mot de passe',
    loadComponent: () => import('./pages/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'mfa/verification',
    title: 'Vérification en deux étapes',
    canActivate: [mfaVerifyGuard],
    loadComponent: () => import('./pages/mfa-verify.page').then((m) => m.MfaVerifyPage),
  },
  {
    path: 'mfa/activation',
    title: 'Activer la vérification en deux étapes',
    canActivate: [mfaEnrollGuard],
    loadComponent: () => import('./pages/mfa-enroll.page').then((m) => m.MfaEnrollPage),
  },
  {
    path: 'installation',
    title: 'Installation',
    canActivate: [setupGuard],
    loadComponent: () => import('./pages/setup.page').then((m) => m.SetupPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: overview!.path },
      {
        path: overview!.path,
        title: overview!.label,
        loadComponent: () => import('./pages/overview.page').then((m) => m.OverviewPage),
      },
      {
        path: 'aide',
        title: 'Aide et lexique',
        loadComponent: () => import('./pages/help.page').then((m) => m.HelpPage),
      },
      ...others.filter((item) => item.path !== 'documents' && item.path !== 'comptabilite' && item.path !== 'projets' && item.path !== 'comptes' && item.path !== 'rapports' && item.path !== 'membres' && item.path !== 'subventions' && item.path !== 'remboursements').map((item) => ({
        path: item.path,
        title: item.label,
        canActivate: [permissionGuard],
        data: { title: item.label, permission: item.permission, additionalPermission: item.additionalPermission },
        loadComponent: item.path === 'budget'
          ? () => import('./reports/budget.page').then((m) => m.BudgetPage)
          : () => import('./pages/placeholder.page').then((m) => m.PlaceholderPage),
      })),
      {
        path: 'comptabilite/ecritures/:id',
        title: 'Écriture',
        canActivate: [permissionGuard],
        data: { permission: 'entries:view' },
        loadComponent: () => import('./accounting/entry.page').then((m) => m.EntryPage),
      },
      {
        path: 'comptabilite',
        title: 'Comptabilité',
        canActivate: [permissionGuard],
        data: { permission: 'entries:view' },
        loadComponent: () => import('./accounting/accounting-shell').then((m) => m.AccountingShell),
        children: [
          {
            path: '',
            pathMatch: 'full',
            title: 'Comptabilité',
            loadComponent: () => import('./accounting/entries.page').then((m) => m.EntriesPage),
          },
          {
            path: 'grand-livre',
            title: 'Grand livre',
            loadComponent: () => import('./accounting/ledger.page').then((m) => m.LedgerPage),
          },
          {
            path: 'balance',
            title: 'Balance',
            loadComponent: () => import('./accounting/trial-balance.page').then((m) => m.TrialBalancePage),
          },
          {
            path: 'reprise',
            title: 'Reprise',
            loadComponent: () => import('./accounting/recovery.page').then((m) => m.RecoveryPage),
          },
          {
            path: 'progression',
            title: 'Progression de la reprise',
            loadComponent: () => import('./accounting/progress.page').then((m) => m.ProgressPage),
          },
          {
            path: 'tiers',
            title: 'Tiers',
            loadComponent: () => import('./accounting/third-parties.page').then((m) => m.ThirdPartiesPage),
          },
          {
            path: 'journaux',
            title: 'Livre-journal',
            loadComponent: () => import('./accounting/journal-book.page').then((m) => m.JournalBookPage),
          },
        ],
      },
      {
        path: 'membres/recu/:id',
        title: 'Reçu de cotisation',
        canActivate: [permissionGuard],
        data: { permission: 'members:view' },
        loadComponent: () => import('./members/receipt.page').then((m) => m.ReceiptPage),
      },
      {
        path: 'membres',
        title: 'Membres',
        canActivate: [permissionGuard],
        data: { permission: 'members:view' },
        loadComponent: () => import('./members/members-shell').then((m) => m.MembersShell),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'liste' },
          { path: 'liste', title: 'Membres', loadComponent: () => import('./members/members.page').then((m) => m.MembersPage) },
          { path: 'campagnes', title: 'Saisons', loadComponent: () => import('./members/campaigns.page').then((m) => m.CampaignsPage) },
        ],
      },
      {
        path: 'rapports',
        title: 'Rapports',
        canActivate: [permissionGuard],
        data: { permission: 'reports:view' },
        loadComponent: () => import('./reports/reports-shell').then((m) => m.ReportsShell),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'compte-de-resultat' },
          { path: 'compte-de-resultat', title: 'Compte de résultat', loadComponent: () => import('./reports/income-statement.page').then((m) => m.IncomeStatementPage) },
          { path: 'bilan', title: 'Bilan', loadComponent: () => import('./reports/balance-sheet.page').then((m) => m.BalanceSheetPage) },
          { path: 'tresorerie', title: 'Trésorerie', loadComponent: () => import('./reports/treasury.page').then((m) => m.TreasuryStatementPage) },
          { path: 'assemblee', title: 'Dossier de l’assemblée générale', loadComponent: () => import('./reports/assembly.page').then((m) => m.AssemblyPage) },
          { path: 'figes', title: 'Rapports figés', loadComponent: () => import('./reports/frozen-reports.page').then((m) => m.FrozenReportsPage) },
        ],
      },
      {
        path: 'comptes/:id/rapprochement',
        title: 'Rapprochement bancaire',
        canActivate: [permissionGuard],
        data: { permission: 'financial-accounts:view' },
        loadComponent: () => import('./treasury/reconciliation.page').then((m) => m.ReconciliationPage),
      },
      {
        path: 'comptes/:id/import',
        title: 'Importer un relevé',
        canActivate: [permissionGuard],
        data: { permission: 'imports:post' },
        loadComponent: () => import('./treasury/import.page').then((m) => m.ImportPage),
      },
      ...detailRoutes({
        path: 'comptes',
        title: 'Comptes',
        permission: 'financial-accounts:view',
        load: () => import('./treasury/accounts.page').then((m) => m.AccountsPage),
      }),
      {
        // Pas de permission exigée : une personne désignée pour donner son accord n'a pas forcément le droit de faire des demandes.
        // Le serveur décide de ce que chacun voit.
        path: 'remboursements',
        title: 'Remboursements de frais',
        loadComponent: () => import('./reimbursements/reimbursements.page').then((m) => m.ReimbursementsPage),
      },
      // Liste et détail : même page, deux adresses (`/projets` et `/projets/:id`). Le détail a sa propre adresse pour
      // s'ouvrir en haut de l'écran, se partager et se quitter avec le bouton Retour du navigateur.
      ...detailRoutes({
        path: 'projets',
        title: 'Projets',
        permission: 'projects:view',
        load: () => import('./accounting/projects.page').then((m) => m.ProjectsPage),
      }),
      ...detailRoutes({
        path: 'subventions',
        title: 'Subventions',
        permission: 'grants:view',
        load: () => import('./grants/grants.page').then((m) => m.GrantsPage),
      }),
      ...detailRoutes({
        path: 'documents',
        title: 'Documents',
        permission: 'documents:view',
        global: true,
        load: () => import('./documents/documents.page').then((m) => m.DocumentsPage),
      }),
      {
        path: 'demarrage',
        title: 'Démarrer',
        canActivate: [permissionGuard],
        data: { permission: 'settings.accounting:admin' },
        loadComponent: () => import('./pages/start.page').then((m) => m.StartPage),
      },
      {
        path: 'compte',
        title: 'Mon compte',
        loadComponent: () => import('./admin/account.page').then((m) => m.AccountPage),
      },
      {
        path: SETTINGS_ITEM.path,
        title: SETTINGS_ITEM.label,
        canActivate: [permissionGuard],
        data: { permission: SETTINGS_ITEM.permission },
        loadComponent: () => import('./admin/settings.page').then((m) => m.SettingsPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'association' },
          {
            path: 'association',
            title: 'Association',
            canActivate: [permissionGuard],
            data: { permission: 'settings.association:view' },
            loadComponent: () => import('./admin/association.page').then((m) => m.AssociationPage),
          },
          {
            path: 'modules',
            title: 'Modules',
            canActivate: [permissionGuard],
            data: { permission: 'settings.association:view' },
            loadComponent: () => import('./admin/modules.page').then((m) => m.ModulesPage),
          },
          {
            path: 'utilisateurs',
            title: 'Utilisateurs',
            canActivate: [permissionGuard],
            data: { permission: 'users:view' },
            loadComponent: () => import('./admin/users.page').then((m) => m.UsersPage),
          },
          {
            path: 'circuits',
            title: 'Circuits de validation',
            canActivate: [permissionGuard],
            data: { permission: 'workflows:view' },
            loadComponent: () => import('./workflows/circuits.page').then((m) => m.CircuitsPage),
          },
          {
            path: 'journal',
            title: "Journal d'audit",
            canActivate: [permissionGuard],
            data: { permission: 'audit:view' },
            loadComponent: () => import('./admin/audit.page').then((m) => m.AuditPage),
          },
          {
            path: 'comptabilite',
            title: 'Comptabilité',
            canActivate: [permissionGuard],
            data: { permission: 'entries:view' },
            loadComponent: () => import('./admin/accounting.page').then((m) => m.AccountingPage),
          },
          {
            path: 'exploitation',
            title: 'Exploitation',
            canActivate: [permissionGuard],
            data: { permission: 'backups:admin' },
            loadComponent: () => import('./admin/exploitation.page').then((m) => m.ExploitationPage),
          },
          {
            path: 'roles',
            title: 'Rôles',
            canActivate: [permissionGuard],
            data: { permission: 'users:view' },
            loadComponent: () => import('./admin/roles.page').then((m) => m.RolesPage),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
