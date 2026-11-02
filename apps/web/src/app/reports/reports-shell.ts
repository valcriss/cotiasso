import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeService } from '../theme/theme.service';
import { PageHeader } from '../ui/page-header';

/** Rubriques des rapports : états de synthèse à présenter à l'assemblée générale. */
export const REPORT_TABS = [
  { path: 'compte-de-resultat', label: 'Compte de résultat', icon: 'trending_up' },
  { path: 'bilan', label: 'Bilan', icon: 'balance' },
  { path: 'tresorerie', label: 'Trésorerie', icon: 'account_balance' },
] as const;

@Component({
  selector: 'app-reports-shell',
  imports: [MatIconModule, PageHeader, RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      title="Rapports"
      icon="assessment"
      [description]="simple()
        ? 'Les états de synthèse de l’association, calculés à partir des opérations enregistrées dans les comptes : ce sont ceux qu’on présente à l’assemblée générale.'
        : 'Les états de synthèse de l’association, calculés à partir des écritures comptabilisées : ce sont ceux qu’on présente à l’assemblée générale.'"
    />
    <nav class="tabs" aria-label="Rapports">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="active">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ tab.icon }}</mat-icon><span>{{ tab.label }}</span>
        </a>
      }
    </nav>
    <router-outlet />
  `,
})
export class ReportsShell {
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');

  protected readonly tabs = REPORT_TABS;
}
