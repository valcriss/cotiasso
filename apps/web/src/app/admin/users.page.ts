import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { AdminApiService, type ManagedUser, type PasswordLink, type RoleSummary } from './admin-api.service';
import { fullLink } from './password-link';

interface ShownLink {
  title: string;
  url: string;
  expiresAt: string;
}

@Component({
  selector: 'app-users-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styleUrl: './admin-pages.scss',
  template: `
    <header class="head">
      <h2><mat-icon fontSet="material-icons-outlined" aria-hidden="true">group</mat-icon><span>Utilisateurs</span></h2>
      @if (canAdmin()) {
        <button mat-flat-button type="button" (click)="toggleInvite()">
          <mat-icon fontSet="material-icons-outlined">person_add</mat-icon>
          Inviter un utilisateur
        </button>
      }
    </header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (link(); as shown) {
      <section class="link-card" aria-live="polite">
        <h3>{{ shown.title }}</h3>
        <p>
          Transmettez ce lien à l'utilisateur. Il ne sera plus affiché et expire le
          {{ shown.expiresAt }}.
        </p>
        <div class="link-row">
          <input readonly [value]="shown.url" aria-label="Lien à transmettre" />
          <button mat-stroked-button type="button" (click)="copy(shown.url)">Copier</button>
          <button mat-button type="button" (click)="link.set(null)">Fermer</button>
        </div>
      </section>
    }

    @if (inviteOpen() && canAdmin()) {
      <form class="panel" [formGroup]="inviteForm" (ngSubmit)="invite()" novalidate>
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">person_add</mat-icon><span>Inviter un utilisateur</span></h3>
        <mat-form-field appearance="outline">
          <mat-label>Nom affiché</mat-label>
          <input matInput formControlName="displayName" autocomplete="off" required />
          @if (inviteForm.controls.displayName.hasError('required')) {
            <mat-error>Saisissez un nom.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Adresse email</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="off" required />
          @if (inviteForm.controls.email.hasError('required')) {
            <mat-error>Saisissez une adresse email.</mat-error>
          } @else if (inviteForm.controls.email.hasError('email')) {
            <mat-error>Cette adresse email n'est pas valide.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Rôles</mat-label>
          <mat-select formControlName="roleIds" multiple>
            @for (role of roles(); track role.id) {
              <mat-option [value]="role.id">{{ role.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="busy()">Créer et générer le lien</button>
          <button mat-button type="button" (click)="inviteOpen.set(false)">Annuler</button>
        </div>
      </form>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else {
      <table class="table">
        <caption class="sr-only">Utilisateurs et leurs rôles</caption>
        <thead>
          <tr>
            <th scope="col">Nom</th>
            <th scope="col">Rôles</th>
            <th scope="col">État</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (user of users(); track user.id) {
            <tr [class.disabled]="user.status === 'DISABLED'">
              <td>
                <strong>{{ user.displayName }}</strong>
                <div class="muted">{{ user.email }}</div>
              </td>
              <td>
                @for (assignment of user.roleAssignments; track assignment.id) {
                  <span class="chip">
                    {{ assignment.role.name }}
                    @if (canAdmin()) {
                      <button
                        type="button"
                        class="chip-remove"
                        [attr.aria-label]="'Retirer le rôle ' + assignment.role.name + ' à ' + user.displayName"
                        [disabled]="busy()"
                        (click)="removeRole(assignment.id)"
                      >
                        <mat-icon fontSet="material-icons-outlined">close</mat-icon>
                      </button>
                    }
                  </span>
                } @empty {
                  <span class="muted">Aucun rôle</span>
                }
              </td>
              <td>
                @if (user.status === 'ACTIVE') {
                  <span class="status ok"><mat-icon fontSet="material-icons-outlined">check_circle</mat-icon> Actif</span>
                } @else {
                  <span class="status off"><mat-icon fontSet="material-icons-outlined">block</mat-icon> Désactivé</span>
                }
              </td>
              <td class="row-actions">
                @if (canAdmin()) {
                  <button
                    mat-button
                    type="button"
                    [attr.aria-expanded]="expanded() === user.id"
                    (click)="toggleRow(user.id)"
                  >
                    Gérer
                  </button>
                }
              </td>
            </tr>
            @if (canAdmin() && expanded() === user.id) {
              <tr class="detail">
                <td colspan="4">
                  <div class="detail-actions">
                    @if (availableRoles(user).length > 0 && user.status === 'ACTIVE') {
                      <mat-form-field appearance="outline" class="inline">
                        <mat-label>Ajouter un rôle</mat-label>
                        <mat-select (selectionChange)="addRole(user, $event.value)">
                          @for (role of availableRoles(user); track role.id) {
                            <mat-option [value]="role.id">{{ role.name }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    }
                    @if (user.status === 'ACTIVE') {
                      <button mat-stroked-button type="button" [disabled]="busy()" (click)="issueReset(user)">
                        Lien de réinitialisation
                      </button>
                      <button mat-stroked-button type="button" [disabled]="busy()" (click)="revokeSessions(user)">
                        Déconnecter partout
                      </button>
                      @if (confirming() === 'mfa:' + user.id) {
                        <button mat-flat-button type="button" class="danger" [disabled]="busy()" (click)="resetMfa(user)">
                          Confirmer la réinitialisation
                        </button>
                        <button mat-button type="button" (click)="confirming.set(null)">Annuler</button>
                      } @else {
                        <button mat-stroked-button type="button" (click)="confirming.set('mfa:' + user.id)">
                          Réinitialiser le MFA
                        </button>
                      }
                      @if (confirming() === 'disable:' + user.id) {
                        <button mat-flat-button type="button" class="danger" [disabled]="busy()" (click)="disable(user)">
                          Confirmer la désactivation
                        </button>
                        <button mat-button type="button" (click)="confirming.set(null)">Annuler</button>
                      } @else if (user.id !== currentUserId()) {
                        <button mat-stroked-button type="button" class="danger-text" (click)="confirming.set('disable:' + user.id)">
                          Désactiver
                        </button>
                      }
                    } @else {
                      <button mat-stroked-button type="button" [disabled]="busy()" (click)="enable(user)">Réactiver</button>
                    }
                  </div>
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    }
  `,
})
export class UsersPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);

  protected readonly canAdmin = computed(() => {
    this.auth.permissions();
    return this.auth.can('users:admin');
  });
  protected readonly currentUserId = computed(() => this.auth.user()?.id);
  protected readonly users = signal<ManagedUser[]>([]);
  protected readonly roles = signal<RoleSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly link = signal<ShownLink | null>(null);
  protected readonly expanded = signal<string | null>(null);
  protected readonly confirming = signal<string | null>(null);
  protected readonly inviteOpen = signal(false);

  protected readonly inviteForm = inject(FormBuilder).nonNullable.group({
    displayName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    roleIds: [[] as string[]],
  });

  constructor() {
    void this.load();
  }

  protected availableRoles(user: ManagedUser): RoleSummary[] {
    const held = new Set(user.roleAssignments.map((a) => a.role.id));
    return this.roles().filter((role) => !held.has(role.id));
  }

  protected toggleInvite(): void {
    this.inviteOpen.update((open) => !open);
  }

  protected toggleRow(id: string): void {
    this.confirming.set(null);
    this.expanded.update((current) => (current === id ? null : id));
  }

  protected async invite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    await this.run(async () => {
      const { invitation, user } = await this.api.createUser(this.inviteForm.getRawValue());
      this.showLink(`Lien d'invitation pour ${user.displayName}`, invitation);
      this.inviteForm.reset({ displayName: '', email: '', roleIds: [] });
      this.inviteOpen.set(false);
    });
  }

  protected issueReset(user: ManagedUser): Promise<void> {
    return this.run(async () => {
      this.showLink(`Lien de réinitialisation pour ${user.displayName}`, await this.api.issueReset(user.id));
    });
  }

  protected disable(user: ManagedUser): Promise<void> {
    this.confirming.set(null);
    return this.run(() => this.api.disable(user.id));
  }

  protected enable(user: ManagedUser): Promise<void> {
    return this.run(() => this.api.enable(user.id));
  }

  protected resetMfa(user: ManagedUser): Promise<void> {
    this.confirming.set(null);
    return this.run(() => this.api.resetMfa(user.id));
  }

  protected revokeSessions(user: ManagedUser): Promise<void> {
    return this.run(async () => {
      await this.api.revokeSessions(user.id);
    });
  }

  protected addRole(user: ManagedUser, roleId: string): Promise<void> {
    return this.run(async () => {
      await this.api.assignRole(user.id, roleId);
    });
  }

  protected removeRole(assignmentId: string): Promise<void> {
    return this.run(() => this.api.revokeAssignment(assignmentId));
  }

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Le champ reste sélectionnable : la copie manuelle reste possible.
    }
  }

  private showLink(title: string, link: PasswordLink): void {
    this.link.set({ title, url: fullLink(link), expiresAt: new Date(link.expiresAt).toLocaleString('fr-FR') });
  }

  private async load(): Promise<void> {
    try {
      const [users, roles] = await Promise.all([this.api.listUsers(), this.api.listRoles()]);
      this.users.set(users);
      this.roles.set(roles);
    } catch (error) {
      this.error.set(describeHttpError(error, 'Impossible de charger les utilisateurs.').message);
    } finally {
      this.loading.set(false);
    }
  }

  /** Exécute une action d'administration puis recharge la liste ; affiche le motif de refus du serveur. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      await this.load();
    } catch (error) {
      this.error.set(describeHttpError(error, 'Action impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
  }
}
