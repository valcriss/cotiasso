import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { AdminApiService, type PermissionInfo, type RoleSummary } from './admin-api.service';

interface PermissionGroup {
  resource: string;
  permissions: PermissionInfo[];
}

/** Regroupe les permissions `ressource:action` par ressource pour une lecture plus simple. */
export function groupPermissions(permissions: PermissionInfo[]): PermissionGroup[] {
  const groups = new Map<string, PermissionInfo[]>();
  for (const permission of permissions) {
    const resource = permission.key.split(':')[0] ?? permission.key;
    groups.set(resource, [...(groups.get(resource) ?? []), permission]);
  }
  return [...groups].map(([resource, items]) => ({ resource, permissions: items }));
}

@Component({
  selector: 'app-roles-page',
  imports: [MatIconModule, ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  styleUrl: './admin-pages.scss',
  template: `
    <header class="head">
      <h2><mat-icon fontSet="material-icons-outlined" aria-hidden="true">admin_panel_settings</mat-icon><span>Rôles</span></h2>
      @if (canAdmin()) {
        <button mat-flat-button type="button" (click)="startCreate()">Nouveau rôle</button>
      }
    </header>
    <p class="muted">
      Un rôle regroupe des permissions. Les rôles par défaut sont des modèles que l'association peut modifier.
    </p>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (editing(); as current) {
      <form class="panel" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h3>{{ current === 'new' ? 'Nouveau rôle' : 'Modifier le rôle' }}</h3>
        @if (current === 'new') {
          <mat-form-field appearance="outline">
            <mat-label>Clé technique</mat-label>
            <input matInput formControlName="key" autocomplete="off" />
            <mat-hint>Minuscules, chiffres et tirets, ex. « secretaire ».</mat-hint>
            @if (form.controls.key.hasError('required')) {
              <mat-error>Saisissez une clé.</mat-error>
            } @else if (form.controls.key.hasError('pattern')) {
              <mat-error>Minuscules, chiffres et tirets, en commençant par une lettre.</mat-error>
            }
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Nom</mat-label>
          <input matInput formControlName="name" autocomplete="off" required />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Saisissez un nom.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <input matInput formControlName="description" autocomplete="off" />
        </mat-form-field>

        <mat-checkbox [checked]="requiresMfa()" (change)="requiresMfa.set($event.checked)">
          Authentification à deux facteurs obligatoire pour ce rôle
        </mat-checkbox>

        <fieldset class="permissions">
          <legend>Permissions</legend>
          @for (group of groups(); track group.resource) {
            <div class="group">
              <h4>{{ group.resource }}</h4>
              @for (permission of group.permissions; track permission.key) {
                <mat-checkbox
                  [checked]="selected().has(permission.key)"
                  (change)="toggle(permission.key, $event.checked)"
                >
                  {{ permission.label }}
                </mat-checkbox>
              }
            </div>
          }
        </fieldset>

        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="busy()">Enregistrer</button>
          <button mat-button type="button" (click)="editing.set(null)">Annuler</button>
        </div>
      </form>
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
                {{ role.permissions.length }} permission(s)
                @if (role.requiresMfa) {
                  · vérification en deux étapes obligatoire
                }
              </div>
            </div>
            @if (canAdmin()) {
              <button mat-stroked-button type="button" (click)="startEdit(role)">Modifier</button>
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

  protected readonly canAdmin = computed(() => {
    this.auth.permissions();
    return this.auth.can('users:admin');
  });
  protected readonly roles = signal<RoleSummary[]>([]);
  protected readonly catalog = signal<PermissionInfo[]>([]);
  protected readonly groups = computed(() => groupPermissions(this.catalog()));
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** `'new'` pour une création, l'identifiant du rôle pour une modification, null sinon. */
  protected readonly editing = signal<string | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly requiresMfa = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    key: ['', [Validators.required, Validators.pattern(/^[a-z][a-z0-9-]*$/)]],
    name: ['', [Validators.required]],
    description: [''],
  });

  constructor() {
    void this.load();
  }

  protected startCreate(): void {
    this.form.reset({ key: '', name: '', description: '' });
    this.selected.set(new Set());
    this.requiresMfa.set(false);
    this.editing.set('new');
  }

  protected startEdit(role: RoleSummary): void {
    this.form.reset({ key: role.key, name: role.name, description: role.description });
    this.selected.set(new Set(role.permissions));
    this.requiresMfa.set(role.requiresMfa);
    this.editing.set(role.id);
  }

  protected toggle(permission: string, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  protected async save(): Promise<void> {
    const current = this.editing();
    if (!current) return;
    const creating = current === 'new';
    if (!creating) this.form.controls.key.disable();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.form.controls.key.enable();
      return;
    }
    const { key, name, description } = this.form.getRawValue();
    this.form.controls.key.enable();

    this.error.set(null);
    this.busy.set(true);
    try {
      const draft = { name, description, permissions: [...this.selected()], requiresMfa: this.requiresMfa() };
      if (creating) await this.api.createRole({ ...draft, key });
      else await this.api.updateRole(current, draft);
      this.editing.set(null);
      await this.load();
    } catch (error) {
      this.error.set(describeHttpError(error, 'Enregistrement impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
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
