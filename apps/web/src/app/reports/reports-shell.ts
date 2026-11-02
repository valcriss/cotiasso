import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PageHeader } from '../ui/page-header';

/** Rubriques des rapports : états de synthèse à présenter à l'assemblée générale. */
export const REPORT_TABS = [
  { path: 'compte-de-resultat', label: 'Compte de résultat', icon: 'trending_up' },
  { path: 'bilan', label: 'Bilan', icon: 'balance' },
] as const;

@Component({
  selector: 'app-reports-shell',
  imports: [MatIconModule, PageHeader, RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      title="Rapports"
      icon="assessment"
      description="Les états de synthèse de l'association, calculés à partir des écritures comptabilisées : ce sont ceux qu'on présente à l'assemblée générale."
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
  protected readonly tabs = REPORT_TABS;
}
