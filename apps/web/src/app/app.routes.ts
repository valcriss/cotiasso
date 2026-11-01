import { Routes } from '@angular/router';
import { NAVIGATION, SETTINGS_ITEM } from './navigation';

const [overview, ...others] = NAVIGATION;

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: overview!.path },
  {
    path: overview!.path,
    title: overview!.label,
    loadComponent: () => import('./pages/overview.page').then((m) => m.OverviewPage),
  },
  ...[...others, SETTINGS_ITEM].map((item) => ({
    path: item.path,
    title: item.label,
    data: { title: item.label },
    loadComponent: () => import('./pages/placeholder.page').then((m) => m.PlaceholderPage),
  })),
  { path: '**', redirectTo: overview!.path },
];
