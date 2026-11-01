import { Routes } from '@angular/router';
import { authGuard, loginGuard, mfaEnrollGuard, mfaVerifyGuard, permissionGuard, setupGuard } from './auth/guards';
import { NAVIGATION, SETTINGS_ITEM } from './navigation';

const [overview, ...others] = NAVIGATION;

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
      ...others.map((item) => ({
        path: item.path,
        title: item.label,
        canActivate: [permissionGuard],
        data: { title: item.label, permission: item.permission },
        loadComponent: () => import('./pages/placeholder.page').then((m) => m.PlaceholderPage),
      })),
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
          { path: '', pathMatch: 'full', redirectTo: 'utilisateurs' },
          {
            path: 'utilisateurs',
            title: 'Utilisateurs',
            canActivate: [permissionGuard],
            data: { permission: 'users:view' },
            loadComponent: () => import('./admin/users.page').then((m) => m.UsersPage),
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
