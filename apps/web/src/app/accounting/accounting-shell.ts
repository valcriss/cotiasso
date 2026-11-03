import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PageHeader } from '../ui/page-header';
import { TabsMenu } from '../ui/tabs-menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Rubriques de la comptabilité : saisie des écritures et états de lecture du grand livre. */
export const ACCOUNTING_TABS = [
  { path: '.', label: 'Écritures', icon: 'edit_note', exact: true },
  { path: 'grand-livre', label: 'Grand livre', icon: 'menu_book', exact: false },
  { path: 'balance', label: 'Balance', icon: 'balance', exact: false },
  { path: 'journaux', label: 'Livre-journal', icon: 'auto_stories', exact: false },
  { path: 'reprise', label: 'Reprise', icon: 'inventory_2', exact: false },
  { path: 'progression', label: 'Progression', icon: 'checklist', exact: false },
  { path: 'tiers', label: 'Tiers', icon: 'groups', exact: false },
] as const;

@Component({
  selector: 'app-accounting-shell',
  imports: [PageHeader, TabsMenu, MatIconModule, RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      title="Comptabilité"
      icon="menu_book"
      description="Le cahier des comptes de l’association : saisissez des écritures puis consultez le grand livre, la balance et le livre-journal."
    />
    <nav class="tabs" appTabsMenu aria-label="Rubriques de la comptabilité">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: tab.exact }">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ tab.icon }}</mat-icon><span>{{ tab.label }}</span>
        </a>
      }
    </nav>
    <router-outlet />
  `,
})
export class AccountingShell {
  protected readonly tabs = ACCOUNTING_TABS;
}
