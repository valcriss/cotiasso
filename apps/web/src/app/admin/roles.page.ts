import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { AdminApiService, type PermissionInfo, type RoleSummary } from './admin-api.service';
import { RoleDialog, type RoleDialogData } from './role-dialog';

@Component({
  selector: 'app-roles-page',
  imports: [MatIconModule, MatButtonModule, ActionBar],
  styleUrl: './admin-pages.scss',
  template: `
    <app-action-bar
      label="Actions des rôles"
      description="Un rôle regroupe des droits (par exemple « Trésorier »). Donnez des rôles aux personnes plutôt que des droits un par un. Les rôles proposés par défaut sont des modèles que vous pouvez modifier."
    >
      @if (canAdmin()) {
        <button mat-flat-button type="button" (click)="open(null)">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau rôle
        </button>
      }
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else {
      <ul class="cards">
        @for (role of roles(); track role.id) {
          <li class="card-item">
            <div>
              <strong>{{ role.name }}</strong>
              <div class="muted">{{ role.description }}</div>
              <div class="muted">
                {{ role.permissions.length }} droit(s)
                @if (role.requiresMfa) {
                  · double vérification obligatoire
                }
              </div>
            </div>
            @if (canAdmin()) {
              <button mat-stroked-button type="button" [attr.aria-label]="'Modifier le rôle ' + role.name" (click)="open(role)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit</mat-icon> Modifier
              </button>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class RolesPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly canAdmin = computed(() => {
    this.auth.permissions();
    return this.auth.can('users:admin');
  });
  protected readonly roles = signal<RoleSummary[]>([]);
  private readonly catalog = signal<PermissionInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async open(role: RoleSummary | null): Promise<void> {
    const saved = await this.dialogs.open<RoleSummary, RoleDialogData>(RoleDialog, {
      size: 'lg',
      data: { role, catalog: this.catalog() },
    });
    if (!saved) return;
    this.notifier.success(role ? `Rôle « ${saved.name} » enregistré.` : `Rôle « ${saved.name} » créé.`);
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [roles, catalog] = await Promise.all([this.api.listRoles(), this.api.listPermissions()]);
      this.roles.set(roles);
      this.catalog.set(catalog);
    } catch (error) {
      this.error.set(describeHttpError(error, 'Impossible de charger les rôles.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
