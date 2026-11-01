import { Routes } from '@angular/router';
import { authGuard, loginGuard, permissionGuard, setupGuard } from './auth/guards';
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
      ...[...others, SETTINGS_ITEM].map((item) => ({
        path: item.path,
        title: item.label,
        canActivate: [permissionGuard],
        data: { title: item.label, permission: item.permission },
        loadComponent: () => import('./pages/placeholder.page').then((m) => m.PlaceholderPage),
      })),
    ],
  },
  { path: '**', redirectTo: '' },
];
