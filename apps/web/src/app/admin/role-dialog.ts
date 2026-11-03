import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { AdminApiService, type PermissionInfo, type RoleSummary } from './admin-api.service';

export interface RoleDialogData {
  /** Rôle à modifier, ou `null` pour en créer un. */
  role: RoleSummary | null;
  catalog: PermissionInfo[];
}

interface PermissionGroup {
  resource: string;
  permissions: PermissionInfo[];
}

/** Noms courants des familles de droits (les clés techniques restent le repli). */
const RESOURCE_LABELS: Record<string, string> = {
  'settings.association': "Association",
  'settings.accounting': 'Réglages de la comptabilité',
  users: 'Comptes et droits',
  members: 'Membres et cotisations',
  'financial-accounts': 'Comptes bancaires',
  transactions: 'Mouvements d’argent',
  imports: 'Relevé de la banque',
  entries: 'Comptabilité (écritures)',
  'fiscal-years': 'Périodes (exercices)',
  projects: 'Projets',
  budgets: 'Budgets',
  grants: 'Subventions',
  expenses: 'Dépenses',
  documents: 'Documents',
  'documents.restricted': 'Documents restreints',
  workflows: 'Circuits de validation',
  reports: 'Rapports',
  data: 'Export des données',
  backups: 'Sauvegardes',
  audit: "Journal d'audit",
};

/** Grandes familles affichées dans l'écran : l'argent, les personnes, les projets, les documents… (les ressources inconnues vont dans « Autres »). */
const THEMES: { title: string; resources: string[] }[] = [
  { title: 'L’argent et la comptabilité', resources: ['financial-accounts', 'transactions', 'imports', 'entries', 'fiscal-years'] },
  { title: 'Les membres', resources: ['members'] },
  { title: 'Les projets et les subventions', resources: ['projects', 'budgets', 'grants', 'expenses'] },
  { title: 'Les documents', resources: ['documents', 'documents.restricted'] },
  { title: 'Les rapports et les données', resources: ['reports', 'data', 'audit'] },
  { title: 'L’administration', resources: ['settings.association', 'settings.accounting', 'users', 'workflows', 'backups'] },
];

export interface PermissionTheme {
  title: string;
  groups: PermissionGroup[];
}

/** Range les familles de droits par grand thème, dans un ordre stable ; rien n'est perdu si une famille est inconnue. */
export function themePermissions(groups: PermissionGroup[]): PermissionTheme[] {
  const used = new Set<string>();
  const themes: PermissionTheme[] = THEMES.map((theme) => {
    const inTheme = theme.resources.flatMap((resource) => groups.filter((g) => g.resource === resource));
    inTheme.forEach((g) => used.add(g.resource));
    return { title: theme.title, groups: inTheme };
  }).filter((theme) => theme.groups.length > 0);
  const others = groups.filter((g) => !used.has(g.resource));
  return others.length > 0 ? [...themes, { title: 'Autres', groups: others }] : themes;
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

/** Identifiant interne d'un rôle, déduit de son nom : l'utilisateur n'a pas à le connaître. */
export function roleKeyFrom(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `role-${slug || 'personnalise'}`;
}

/** Création et modification d'un rôle (un ensemble de droits), en boîte de dialogue. Renvoie le rôle enregistré. */
@Component({
  selector: 'app-role-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  styles: `
    .permissions {
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      margin: 8px 0 0;
      padding: 8px 16px 12px;
    }
    .permissions legend {
      font: var(--mat-sys-label-large);
      padding: 0 4px;
    }
    .group {
      display: flex;
      flex-direction: column;
      margin: 0 0 8px;
    }
    h4 {
      font: var(--mat-sys-label-large);
      margin: 8px 0 0;
    }
    h3.theme {
      border-top: 1px solid var(--app-border);
      font: var(--mat-sys-title-small);
      margin: 16px 0 0;
      padding-top: 12px;
    }
    .sensitive {
      margin-left: 8px;
    }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="role ? 'Modifier le rôle ' + role.name : 'Nouveau rôle'"
        description="Un rôle regroupe des droits (par exemple « Trésorier ») : vous le donnez à une personne au lieu de choisir ses droits un par un. Cochez ce que ce rôle a le droit de faire."
        [dirty]="form.dirty || permissionsChanged()"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom du rôle</mat-label>
          <input matInput formControlName="name" autocomplete="off" placeholder="Secrétaire" required />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Donnez un nom au rôle, par exemple « Secrétaire ».</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>À quoi sert ce rôle ? (facultatif)</mat-label>
          <input matInput formControlName="description" autocomplete="off" placeholder="Gère les adhésions et les documents" />
        </mat-form-field>

        <mat-checkbox [checked]="requiresMfa()" (change)="setMfa($event.checked)">
          Exiger la double vérification (code sur le téléphone) pour ce rôle
        </mat-checkbox>
        <p class="muted">Recommandé pour tout rôle qui touche aux comptes ou aux accès.</p>

        <fieldset class="permissions">
          <legend>Ce que ce rôle peut faire</legend>
          <p class="muted">Les droits marqués « À confier avec soin » donnent accès à la sécurité, rendent des comptes définitifs ou sortent toutes les données.</p>
          @for (theme of themes(); track theme.title) {
            <h3 class="theme">{{ theme.title }}</h3>
            @for (group of theme.groups; track group.resource) {
              <div class="group">
                <h4>{{ resourceLabel(group.resource) }}</h4>
                @for (permission of group.permissions; track permission.key) {
                  <mat-checkbox [checked]="selected().has(permission.key)" (change)="toggle(permission.key, $event.checked)">
                    {{ permission.label }}
                    @if (permission.sensitive) { <span class="chip sensitive">À confier avec soin</span> }
                  </mat-checkbox>
                }
              </div>
            }
          }
        </fieldset>
      </app-form-dialog>
    </form>
  `,
})
export class RoleDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<RoleDialog, RoleSummary>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<RoleDialogData>(MAT_DIALOG_DATA);
  protected readonly role = this.data.role;

  protected readonly groups = computed(() => groupPermissions(this.data.catalog));
  protected readonly themes = computed(() => themePermissions(this.groups()));
  protected readonly selected = signal<ReadonlySet<string>>(new Set(this.role?.permissions ?? []));
  protected readonly requiresMfa = signal(this.role?.requiresMfa ?? false);
  protected readonly permissionsChanged = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    name: [this.role?.name ?? '', [Validators.required]],
    description: [this.role?.description ?? ''],
  });

  protected resourceLabel(resource: string): string {
    return RESOURCE_LABELS[resource] ?? resource;
  }

  protected toggle(permission: string, checked: boolean): void {
    this.permissionsChanged.set(true);
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  protected setMfa(checked: boolean): void {
    this.permissionsChanged.set(true);
    this.requiresMfa.set(checked);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const { name, description } = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const draft = { name: name.trim(), description, permissions: [...this.selected()], requiresMfa: this.requiresMfa() };
      this.reference.close(
        this.role ? await this.api.updateRole(this.role.id, draft) : await this.api.createRole({ ...draft, key: roleKeyFrom(name) }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "Le rôle n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
