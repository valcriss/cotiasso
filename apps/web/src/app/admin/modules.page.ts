import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { AdminApiService, type ModuleInfo } from './admin-api.service';

@Component({
  selector: 'app-modules-page',
  imports: [MatButtonModule, MatIconModule],
  styleUrl: './admin-pages.scss',
  template: `
    <h2><mat-icon fontSet="material-icons-outlined" aria-hidden="true">extension</mat-icon><span>Modules</span></h2>
    <p class="muted">
      Les modules ajoutent des fonctions optionnelles. Un module n'est activable qu'une fois livré et validé : un module
      indisponible ne peut pas être activé.
    </p>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else {
      <ul class="cards">
        @for (module of modules(); track module.key) {
          <li class="card-item" [class.unavailable]="module.status === 'UNAVAILABLE'">
            <div>
              <strong>{{ module.label }}</strong>
              <div class="muted">{{ module.description }}</div>
              @if (module.reason) {
                <div class="muted">{{ module.reason }}</div>
              }
            </div>
            <div class="module-side">
              @switch (module.status) {
                @case ('ACTIVE') {
                  <span class="status ok"><mat-icon fontSet="material-icons-outlined">check_circle</mat-icon> Actif</span>
                }
                @case ('INACTIVE') {
                  <span class="status"><mat-icon fontSet="material-icons-outlined">radio_button_unchecked</mat-icon> Inactif</span>
                }
                @default {
                  <span class="status off"><mat-icon fontSet="material-icons-outlined">lock</mat-icon> Indisponible</span>
                }
              }
              @if (canAdmin() && module.status === 'INACTIVE') {
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="activate(module)">Activer</button>
              }
              @if (canAdmin() && module.status === 'ACTIVE') {
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="deactivate(module)">Désactiver</button>
              }
            </div>
          </li>
        }
      </ul>
    }
  `,
})
export class ModulesPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);

  protected readonly canAdmin = computed(() => {
    this.auth.permissions();
    return this.auth.can('settings.accounting:admin');
  });
  protected readonly modules = signal<ModuleInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected activate(module: ModuleInfo): Promise<void> {
    return this.run(() => this.api.activateModule(module.key));
  }

  protected deactivate(module: ModuleInfo): Promise<void> {
    return this.run(() => this.api.deactivateModule(module.key));
  }

  private async load(): Promise<void> {
    try {
      this.modules.set(await this.api.listModules());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les modules.').message);
    } finally {
      this.loading.set(false);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      await this.load();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Action impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
  }
}
