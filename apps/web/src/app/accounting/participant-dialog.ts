import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type MemberInfo, type ParticipantInfo, type ProjectInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { DateField } from '../ui/date-field';

export interface ParticipantDialogData {
  project: ProjectInfo;
  /** Participant à modifier, ou `null` pour en ajouter un. */
  participant: ParticipantInfo | null;
}

/** Ajout et modification d'un participant de projet. Être participant ne donne aucun droit d'accès : c'est une information. */
@Component({
  selector: 'app-participant-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="participant ? 'Modifier ' + participant.name : 'Ajouter un participant'"
        description="Indiquez qui participe au projet et avec quel rôle. C'est une information : elle ne donne aucun droit d'accès (les droits se règlent dans les rôles)."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        @if (!participant) {
          <mat-form-field appearance="outline">
            <mat-label>Membre</mat-label>
            <mat-select formControlName="memberId" required>
              @for (member of members(); track member.id) {
                <mat-option [value]="member.id">{{ member.firstName }} {{ member.lastName }}</mat-option>
              }
            </mat-select>
            @if (form.controls.memberId.hasError('required')) {
              <mat-error>Choisissez le membre qui participe.</mat-error>
            }
            @if (membersUnavailable()) {
              <mat-hint>La liste des membres n'est pas accessible avec vos droits.</mat-hint>
            }
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Rôle dans le projet</mat-label>
          <input matInput formControlName="role" placeholder="Bénévole, coordinatrice, trésorier du projet…" required />
          @if (form.controls.role.hasError('required')) {
            <mat-error>Indiquez son rôle, par exemple « Bénévole ».</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <app-date-field label="Depuis le (facultatif)" formControlName="startDate" />
          <app-date-field label="Jusqu'au (facultatif)" formControlName="endDate" hint="Renseignez-la quand la personne quitte le projet." />
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Note (facultatif)</mat-label>
          <textarea matInput rows="2" formControlName="note"></textarea>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class ParticipantDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<ParticipantDialog, ParticipantInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly data = inject<ParticipantDialogData>(MAT_DIALOG_DATA);
  protected readonly participant = this.data.participant;

  protected readonly members = signal<MemberInfo[]>([]);
  protected readonly membersUnavailable = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    memberId: ['', this.participant ? [] : [Validators.required]],
    role: [this.participant?.role ?? '', [Validators.required]],
    startDate: [this.participant?.startDate ?? ''],
    endDate: [this.participant?.endDate ?? ''],
    note: [this.participant?.note ?? ''],
  });

  constructor() {
    if (!this.participant) {
      void this.api
        .listMembers({ status: 'ACTIVE' })
        .then((page) => this.members.set(page.members))
        .catch(() => this.membersUnavailable.set(true));
    }
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const value = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const saved = this.participant
        ? await this.api.updateParticipant(this.participant.id, {
            role: value.role.trim(),
            startDate: value.startDate || null,
            endDate: value.endDate || null,
            note: value.note,
          })
        : await this.api.addParticipant(this.data.project.id, {
            memberId: value.memberId,
            role: value.role.trim(),
            startDate: value.startDate || null,
            endDate: value.endDate || null,
            note: value.note,
          });
      this.reference.close(saved);
    } catch (failure) {
      const described = describeHttpError(failure, "Le participant n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
