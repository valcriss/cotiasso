import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { AccessDialog, type AccessDialogData } from './access-dialog';
import { AdminApiService, type MailOutcome, type ManagedUser, type PasswordLink, type ProjectInfo, type RoleSummary } from './admin-api.service';
import { InviteDialog, type InviteDialogData, type InviteResult } from './invite-dialog';
import { LinkDialog, type LinkDialogData } from './link-dialog';
import { fullLink } from './password-link';

@Component({
  selector: 'app-users-page',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, ActionBar],
  styleUrl: './admin-pages.scss',
  template: `
    <app-action-bar label="Actions des utilisateurs" description="Les personnes qui peuvent se connecter à l'application et ce qu'elles ont le droit de faire.">
      @if (canAdmin()) {
        <button mat-flat-button type="button" (click)="invite()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">person_add</mat-icon> Inviter un utilisateur
        </button>
      }
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
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
                    {{ assignment.role.name }}@if (assignment.project) { · {{ assignment.project.code }} }
                    @if (canAdmin()) {
                      <button
                        type="button"
                        class="chip-remove"
                        [attr.aria-label]="'Retirer le rôle ' + assignment.role.name + ' à ' + user.displayName"
                        [disabled]="busy()"
                        (click)="removeRole(user, assignment.id, assignment.role.name)"
                      >
                        <mat-icon fontSet="material-icons-outlined">close</mat-icon>
                      </button>
                    }
                  </span>
                } @empty {
                  <span class="muted">Aucun rôle : cette personne ne peut rien faire pour l'instant.</span>
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
                  <button mat-button type="button" [attr.aria-expanded]="expanded() === user.id" (click)="toggleRow(user.id)">Gérer</button>
                }
              </td>
            </tr>
            @if (canAdmin() && expanded() === user.id) {
              <tr class="detail">
                <td colspan="4">
                  <div class="detail-actions">
                    @if (projects().length > 0 && user.status === 'ACTIVE') {
                      <mat-form-field appearance="outline" class="inline">
                        <mat-label>Portée du rôle ajouté</mat-label>
                        <mat-select [value]="scope()" (selectionChange)="scope.set($event.value)">
                          <mat-option value="">Toute l'association</mat-option>
                          @for (project of projects(); track project.id) {
                            <mat-option [value]="project.id">Projet {{ project.code }}</mat-option>
                          }
                        </mat-select>
                        <mat-hint>Un rôle limité à un projet ne donne que les droits sur ce projet.</mat-hint>
                      </mat-form-field>
                    }
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
                    <button mat-stroked-button type="button" (click)="showAccess(user)">Voir les accès</button>
                    @if (user.status === 'ACTIVE') {
                      <button mat-stroked-button type="button" [disabled]="busy()" (click)="issueReset(user)">Lien de réinitialisation</button>
                      <button mat-stroked-button type="button" [disabled]="busy()" (click)="revokeSessions(user)">Déconnecter partout</button>
                      <button mat-stroked-button type="button" [disabled]="busy()" (click)="resetMfa(user)">Réinitialiser la double vérification</button>
                      @if (user.id !== currentUserId()) {
                        <button mat-stroked-button type="button" class="danger-text" [disabled]="busy()" (click)="disable(user)">Désactiver</button>
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
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly canAdmin = computed(() => {
    this.auth.permissions();
    return this.auth.can('users:admin');
  });
  protected readonly currentUserId = computed(() => this.auth.user()?.id);
  protected readonly users = signal<ManagedUser[]>([]);
  protected readonly roles = signal<RoleSummary[]>([]);
  /** Projets proposés comme portée d'un rôle ; vide sans droit de les consulter. */
  protected readonly projects = signal<ProjectInfo[]>([]);
  /** Portée du prochain rôle ajouté : vide = toute l'association, sinon un projet. */
  protected readonly scope = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  /** Rôles qu'on peut encore ajouter : ceux que la personne n'a pas déjà avec la portée choisie. */
  protected availableRoles(user: ManagedUser): RoleSummary[] {
    const scope = this.scope() || null;
    const held = new Set(user.roleAssignments.filter((a) => (a.project?.id ?? null) === scope).map((a) => a.role.id));
    return this.roles().filter((role) => !held.has(role.id));
  }

  protected async showAccess(user: ManagedUser): Promise<void> {
    await this.dialogs.open<boolean, AccessDialogData>(AccessDialog, { size: 'md', dismissible: true, data: { user } });
  }

  protected toggleRow(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  protected async invite(): Promise<void> {
    const result = await this.dialogs.open<InviteResult, InviteDialogData>(InviteDialog, { size: 'md', data: { roles: this.roles() } });
    if (!result) return;
    await this.load();
    await this.showLink(`Lien d'invitation pour ${result.user.displayName}`, result.invitation, result.mail);
  }

  protected issueReset(user: ManagedUser): Promise<void> {
    return this.run(async () => {
      await this.showLink(`Lien de réinitialisation pour ${user.displayName}`, await this.api.issueReset(user.id));
    });
  }

  protected async disable(user: ManagedUser): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Désactiver ${user.displayName} ?`,
      message: `${user.displayName} ne pourra plus se connecter et sera déconnecté(e) partout. Son historique est conservé et vous pourrez le/la réactiver.`,
      confirmLabel: 'Désactiver',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.disable(user.id);
      this.notifier.success(`${user.displayName} est désactivé(e).`);
    });
  }

  protected enable(user: ManagedUser): Promise<void> {
    return this.run(async () => {
      await this.api.enable(user.id);
      this.notifier.success(`${user.displayName} est réactivé(e).`);
    });
  }

  protected async resetMfa(user: ManagedUser): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Réinitialiser la double vérification de ${user.displayName} ?`,
      message: `${user.displayName} devra la configurer de nouveau à sa prochaine connexion. À faire si cette personne a perdu son téléphone et ses codes de secours.`,
      confirmLabel: 'Réinitialiser',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.resetMfa(user.id);
      this.notifier.success(`Double vérification de ${user.displayName} réinitialisée.`);
    });
  }

  protected revokeSessions(user: ManagedUser): Promise<void> {
    return this.run(async () => {
      await this.api.revokeSessions(user.id);
      this.notifier.success(`${user.displayName} est déconnecté(e) de tous ses appareils.`);
    });
  }

  protected addRole(user: ManagedUser, roleId: string): Promise<void> {
    return this.run(async () => {
      await this.api.assignRole(user.id, roleId, this.scope() || undefined);
      this.notifier.success(`Rôle ajouté à ${user.displayName}.`);
    });
  }

  protected removeRole(user: ManagedUser, assignmentId: string, roleName: string): Promise<void> {
    return this.run(async () => {
      await this.api.revokeAssignment(assignmentId);
      this.notifier.success(`Rôle « ${roleName} » retiré à ${user.displayName}.`);
    });
  }

  private async showLink(title: string, link: PasswordLink, mail: MailOutcome | undefined = link.mail): Promise<void> {
    await this.dialogs.open<boolean, LinkDialogData>(LinkDialog, {
      size: 'md',
      dismissible: true,
      data: { title, url: fullLink(link), expiresAt: new Date(link.expiresAt).toLocaleString('fr-FR'), mail },
    });
  }

  private async load(): Promise<void> {
    try {
      const [users, roles] = await Promise.all([this.api.listUsers(), this.api.listRoles()]);
      this.users.set(users);
      this.roles.set(roles);
      // Les projets ne sont proposés que si l'utilisateur peut les consulter : sinon, attribution globale seulement.
      this.projects.set(await this.api.listProjects().catch(() => []));
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
      this.error.set(describeHttpError(error, "L'action n'a pas pu aboutir. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
