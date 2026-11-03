import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type ProjectInfo, type ProjectStatus } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { PROJECT_STATUS_LABELS } from './project-labels';
import { DateField } from '../ui/date-field';

export interface ProjectDialogData {
  /** Projet à modifier, ou `null` pour en créer un. */
  project: ProjectInfo | null;
}

/** Création et modification d'un projet, en boîte de dialogue. Renvoie le projet enregistré. */
@Component({
  selector: 'app-project-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="project ? 'Modifier le projet ' + project.code : 'Nouveau projet'"
        description="Un projet regroupe les dépenses et les recettes d'une même action (festival, ateliers…), pour savoir ce qu'elle coûte et ce qu'elle rapporte."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        @if (!project) {
          <mat-form-field appearance="outline">
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" placeholder="FESTIVAL" autocomplete="off" required />
            <mat-hint>Quelques lettres majuscules, sans espace. Il ne pourra plus être changé.</mat-hint>
            @if (form.controls.code.hasError('required')) {
              <mat-error>Donnez un code court au projet, par exemple FESTIVAL.</mat-error>
            } @else if (form.controls.code.hasError('pattern')) {
              <mat-error>Utilisez des majuscules, des chiffres ou des tirets (20 caractères au plus).</mat-error>
            }
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Nom</mat-label>
          <input matInput formControlName="name" placeholder="Festival d'été" required />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Donnez un nom au projet.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>État</mat-label>
          <mat-select formControlName="status">
            @for (status of statuses; track status.value) {
              <mat-option [value]="status.value">{{ status.label }}</mat-option>
            }
          </mat-select>
          <mat-hint>
            @if (project?.permanent) {
              Le projet permanent reste toujours actif.
            } @else {
              Archivé : le projet n'accepte plus de nouvelles saisies.
            }
          </mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Objet (facultatif)</mat-label>
          <textarea matInput rows="2" formControlName="description" placeholder="À quoi sert ce projet ?"></textarea>
        </mat-form-field>
        <div class="row">
          <app-date-field label="Début (facultatif)" formControlName="startDate" />
          <app-date-field label="Fin (facultatif)" formControlName="endDate" />
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class ProjectDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<ProjectDialog, ProjectInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly project = inject<ProjectDialogData>(MAT_DIALOG_DATA).project;

  protected readonly statuses = (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((value) => ({
    value,
    label: PROJECT_STATUS_LABELS[value],
  }));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    code: [this.project?.code ?? '', this.project ? [] : [Validators.required, Validators.pattern(/^[A-Z0-9-]{1,20}$/)]],
    name: [this.project?.name ?? '', [Validators.required]],
    description: [this.project?.description ?? ''],
    status: [this.project?.status ?? ('PREPARATION' as ProjectStatus)],
    startDate: [this.project?.startDate ?? ''],
    endDate: [this.project?.endDate ?? ''],
  });

  constructor() {
    // Le projet permanent reste actif : son état n'est pas modifiable.
    if (this.project?.permanent) this.form.controls.status.disable();
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
      const saved = this.project
        ? await this.api.updateProject(this.project.id, {
            name: value.name.trim(),
            description: value.description,
            ...(this.project.permanent ? {} : { status: value.status }),
            startDate: value.startDate || null,
            endDate: value.endDate || null,
          })
        : await this.api.createProject({
            code: value.code,
            name: value.name.trim(),
            description: value.description,
            status: value.status,
            startDate: value.startDate || null,
            endDate: value.endDate || null,
          });
      this.reference.close(saved);
    } catch (failure) {
      const described = describeHttpError(failure, "Le projet n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
