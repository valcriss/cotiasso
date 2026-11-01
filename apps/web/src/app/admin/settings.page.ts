import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';

interface SettingsSection {
  path: string;
  label: string;
  permission: string;
}

/** Sections des paramètres ; chacune exige sa permission (le serveur vérifie de toute façon). */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { path: 'association', label: 'Association', permission: 'settings.association:view' },
  { path: 'comptabilite', label: 'Comptabilité', permission: 'entries:view' },
  { path: 'modules', label: 'Modules', permission: 'settings.association:view' },
  { path: 'utilisateurs', label: 'Utilisateurs', permission: 'users:view' },
  { path: 'roles', label: 'Rôles', permission: 'users:view' },
  { path: 'journal', label: "Journal d'audit", permission: 'audit:view' },
  { path: 'exploitation', label: 'Exploitation', permission: 'backups:admin' },
];

@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  styleUrl: './admin-pages.scss',
  template: `
    <h1 class="title">Paramètres</h1>
    @if (sections().length === 0) {
      <p class="muted">Aucune rubrique de paramètres n'est disponible pour votre profil.</p>
    } @else {
      <nav class="tabs" aria-label="Rubriques des paramètres">
        @for (section of sections(); track section.path) {
          <a [routerLink]="section.path" routerLinkActive="active">{{ section.label }}</a>
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
