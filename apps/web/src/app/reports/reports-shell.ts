import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeService } from '../theme/theme.service';
import { PageHeader } from '../ui/page-header';
import { TabsMenu } from '../ui/tabs-menu';

/** Rubriques des rapports : états de synthèse à présenter à l'assemblée générale. */
export const REPORT_TABS = [
  { path: 'compte-de-resultat', label: 'Compte de résultat', simple: 'Reçu et dépensé', icon: 'trending_up' },
  { path: 'bilan', label: 'Bilan', simple: 'Possédé et dû', icon: 'balance' },
  { path: 'tresorerie', label: 'Trésorerie', simple: 'Mouvements d’argent', icon: 'account_balance' },
  { path: 'figes', label: 'Rapports figés', simple: 'Comptes arrêtés', icon: 'lock' },
  { path: 'assemblee', label: 'Dossier de l’assemblée', simple: 'Assemblée générale', icon: 'groups' },
] as const;

@Component({
  selector: 'app-reports-shell',
  imports: [MatIconModule, PageHeader, TabsMenu, RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      title="Rapports"
      icon="assessment"
      [description]="simple()
        ? 'Les états de synthèse de l’association, calculés à partir des opérations enregistrées dans les comptes : ce sont ceux qu’on présente à l’assemblée générale.'
        : 'Les états de synthèse de l’association, calculés à partir des écritures comptabilisées : ce sont ceux qu’on présente à l’assemblée générale.'"
    />
    <nav class="tabs" appTabsMenu aria-label="Rapports">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="active">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ tab.icon }}</mat-icon>
          @if (simple()) {
            <span>{{ tab.simple }} <small class="muted">({{ tab.label.toLowerCase() }})</small></span>
          } @else {
            <span>{{ tab.label }}</span>
          }
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
