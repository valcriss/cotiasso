import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PageHeader } from '../ui/page-header';
import { TabsMenu } from '../ui/tabs-menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';

interface SettingsSection {
  path: string;
  icon: string;
  label: string;
  permission: string;
}

/** Sections des paramètres ; chacune exige sa permission (le serveur vérifie de toute façon). */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { path: 'association', icon: 'business', label: 'Association', permission: 'settings.association:view' },
  { path: 'comptabilite', icon: 'menu_book', label: 'Comptabilité', permission: 'entries:view' },
  { path: 'modules', icon: 'extension', label: 'Modules', permission: 'settings.association:view' },
  { path: 'utilisateurs', icon: 'group', label: 'Utilisateurs', permission: 'users:view' },
  { path: 'roles', icon: 'admin_panel_settings', label: 'Rôles', permission: 'users:view' },
  { path: 'circuits', icon: 'account_tree', label: 'Circuits de validation', permission: 'workflows:view' },
  { path: 'journal', icon: 'history', label: "Journal d'audit", permission: 'audit:view' },
  { path: 'exploitation', icon: 'dns', label: 'Exploitation', permission: 'backups:admin' },
];

@Component({
  selector: 'app-settings-page',
  imports: [MatIconModule, PageHeader, TabsMenu, RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: './admin-pages.scss',
  template: `
    <app-page-header
      title="Paramètres"
      icon="settings"
      description="Réglez l'association, sa comptabilité et les accès : chaque rubrique ci-dessous a son rôle, expliqué en tête de page."
    />
    @if (sections().length === 0) {
      <p class="muted">Aucune rubrique de paramètres n'est disponible pour votre profil.</p>
    } @else {
      <nav class="tabs" appTabsMenu aria-label="Rubriques des paramètres">
        @for (section of sections(); track section.path) {
          <a [routerLink]="section.path" routerLinkActive="active">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ section.icon }}</mat-icon><span>{{ section.label }}</span>
          </a>
        }
      </nav>
      <router-outlet />
    }
  `,
})
export class SettingsPage {
  private readonly auth = inject(AuthService);

  protected readonly sections = computed(() => {
    this.auth.permissions();
    return SETTINGS_SECTIONS.filter((section) => this.auth.can(section.permission));
  });
}
