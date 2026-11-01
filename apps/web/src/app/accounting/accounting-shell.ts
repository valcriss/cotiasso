import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Rubriques de la comptabilité : saisie des écritures et états de lecture du grand livre. */
export const ACCOUNTING_TABS = [
  { path: '.', label: 'Écritures', icon: 'edit_note', exact: true },
  { path: 'grand-livre', label: 'Grand livre', icon: 'menu_book', exact: false },
  { path: 'balance', label: 'Balance', icon: 'balance', exact: false },
  { path: 'journaux', label: 'Livre-journal', icon: 'auto_stories', exact: false },
] as const;

@Component({
  selector: 'app-accounting-shell',
  imports: [MatIconModule, RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <h1 class="title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">menu_book</mat-icon><span>Comptabilité</span></h1>
    <nav class="tabs" aria-label="Rubriques de la comptabilité">
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
