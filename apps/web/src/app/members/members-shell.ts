import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PageHeader } from '../ui/page-header';

/** Rubriques de « Membres et cotisations » : les personnes, puis les saisons d'adhésion et les cotisations. */
export const MEMBER_TABS = [
  { path: 'liste', label: 'Membres', icon: 'groups' },
  { path: 'campagnes', label: 'Saisons et cotisations', icon: 'event_repeat' },
] as const;

@Component({
  selector: 'app-members-shell',
  imports: [MatIconModule, PageHeader, RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      title="Membres et cotisations"
      icon="groups"
      description="Les personnes de l'association, et ce qu'elles doivent et ont payé pour chaque saison d'adhésion."
    />
    <nav class="tabs" aria-label="Membres et cotisations">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="active">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ tab.icon }}</mat-icon><span>{{ tab.label }}</span>
        </a>
      }
    </nav>
    <router-outlet />
  `,
})
export class MembersShell {
  protected readonly tabs = MEMBER_TABS;
}
