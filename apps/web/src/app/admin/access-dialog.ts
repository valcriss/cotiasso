import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { describeHttpError } from '../auth/error-messages';
import { AdminApiService, type ManagedUser, type UserAccess } from './admin-api.service';

export interface AccessDialogData {
  user: ManagedUser;
}

/**
 * « Accès effectifs » : ce qu'une personne peut faire, et d'où lui vient chaque droit (quel rôle, sur toute l'association ou
 * sur quel projet). Sert à comprendre un droit avant de le modifier.
 */
@Component({
  selector: 'app-access-dialog',
  imports: [MatDialogModule, MatButtonModule],
  styles: `
    ul {
      margin: 4px 0 16px;
      padding-left: 20px;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 12px 0 0;
    }
  `,
  template: `
    <h2 mat-dialog-title>Accès de {{ data.user.displayName }}</h2>
    <mat-dialog-content>
      <p class="muted">Ce que cette personne peut faire dans l'application, et le rôle qui le lui permet.</p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (access(); as current) {
        <h3>Sur toute l'association</h3>
        @if (current.permissions.length === 0) {
          <p class="muted">Aucun droit sur toute l'association.</p>
        } @else {
          <ul>
            @for (item of current.permissions; track item.permission) {
              <li>
                {{ item.label }}
                <span class="muted"> — {{ roleNames(item.grantedBy) }}</span>
              </li>
            }
          </ul>
        }
        <h3>Sur un projet précis</h3>
        @if (current.projectPermissions.length === 0) {
          <p class="muted">Aucun droit limité à un projet.</p>
        } @else {
          <ul>
            @for (item of current.projectPermissions; track item.permission + item.projectId) {
              <li>
                {{ item.label }} : <strong>{{ item.projectCode }}</strong> ({{ item.projectName }})
                <span class="muted"> — {{ item.grantedBy.roleName }}</span>
              </li>
            }
          </ul>
        }
      } @else if (!error()) {
        <p class="muted">Chargement…</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" mat-dialog-close>Fermer</button>
    </mat-dialog-actions>
  `,
})
export class AccessDialog {
  private readonly api = inject(AdminApiService);
  protected readonly data = inject<AccessDialogData>(MAT_DIALOG_DATA);
  protected readonly access = signal<UserAccess | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected roleNames(grantedBy: { roleName: string }[]): string {
    return [...new Set(grantedBy.map((g) => g.roleName))].join(', ');
  }

  private async load(): Promise<void> {
    try {
      this.access.set(await this.api.userAccess(this.data.user.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les accès.').message);
    }
  }
}
