import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminApiService, type ParticipantInfo, type ProjectInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { formatDate } from '../ui/dates';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { ParticipantDialog } from './participant-dialog';

/** Participants d'un projet : qui y contribue, avec quel rôle. Information seulement, sans droit d'accès attaché. */
@Component({
  selector: 'app-project-participants',
  imports: [MatButtonModule, MatIconModule],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <section class="panel" [attr.aria-label]="'Participants de ' + project().name">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">groups</mat-icon><span>Participants</span></h3>
        <div class="actions">
          @if (canEdit()) {
            <button mat-stroked-button type="button" (click)="add()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">person_add</mat-icon> Ajouter un participant
            </button>
          }
        </div>
      </div>
      <p class="muted">
        Les personnes qui participent à ce projet. Cette liste est une information : elle ne donne aucun droit d'accès.
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (participants().length === 0) {
        <p class="muted">
          @if (canEdit()) {
            Personne n'est encore indiqué. Cliquez sur « Ajouter un participant » pour commencer.
          } @else {
            Aucun participant n'est indiqué pour ce projet.
          }
        </p>
      } @else {
        <table class="table">
          <caption class="sr-only">Participants du projet</caption>
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Rôle</th>
              <th scope="col">Période</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (participant of participants(); track participant.id) {
              <tr>
                <td>{{ participant.name }}</td>
                <td>{{ participant.role }}</td>
                <td>{{ period(participant) }}</td>
                <td class="row-actions">
                  @if (canEdit()) {
                    <button mat-button type="button" [attr.aria-label]="'Modifier ' + participant.name" (click)="edit(participant)">Modifier</button>
                    <button mat-button type="button" [attr.aria-label]="'Retirer ' + participant.name" (click)="remove(participant)">Retirer</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class ProjectParticipants {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  readonly project = input.required<ProjectInfo>();

  protected readonly participants = signal<ParticipantInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** Modifier la liste : droit de modifier ce projet (global ou à portée projet). */
  protected readonly canEdit = computed(() => {
    this.auth.permissions();
    this.auth.projectPermissions?.();
    return this.auth.canOnProject('projects:update', this.project().id);
  });

  constructor() {
    effect(() => {
      const id = this.project().id;
      untracked(() => void this.load(id));
    });
  }

  protected period(participant: ParticipantInfo): string {
    if (!participant.startDate && !participant.endDate) return '—';
    return `${participant.startDate ? formatDate(participant.startDate) : '…'} → ${participant.endDate ? formatDate(participant.endDate) : 'en cours'}`;
  }

  protected async add(): Promise<void> {
    const added = await this.dialogs.open<ParticipantInfo>(ParticipantDialog, {
      size: 'md',
      data: { project: this.project(), participant: null },
    });
    if (!added) return;
    this.notifier.success(`${added.name} participe maintenant au projet.`);
    await this.load(this.project().id);
  }

  protected async edit(participant: ParticipantInfo): Promise<void> {
    const saved = await this.dialogs.open<ParticipantInfo>(ParticipantDialog, {
      size: 'md',
      data: { project: this.project(), participant },
    });
    if (!saved) return;
    this.notifier.success(`${saved.name} enregistré.`);
    await this.load(this.project().id);
  }

  protected async remove(participant: ParticipantInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Retirer ${participant.name} ?`,
      message:
        "Cette personne disparaît de la liste des participants du projet. Ses dépenses et recettes ne changent pas, et ses droits d'accès non plus.\n" +
        'Si elle a seulement quitté le projet, indiquez plutôt une date de fin en la modifiant : vous gardez ainsi l’historique.',
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.api.removeParticipant(participant.id);
      this.notifier.success(`${participant.name} retiré du projet.`);
      await this.load(this.project().id);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le participant n'a pas pu être retiré. Réessayez dans un instant.").message);
    }
  }

  private async load(projectId: string): Promise<void> {
    this.error.set(null);
    try {
      this.participants.set(await this.api.listParticipants(projectId));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les participants.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
