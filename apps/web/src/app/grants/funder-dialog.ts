import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FunderInfo, type FunderType } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { FUNDER_TYPE_LABELS } from './grant-labels';

/** Ajout et modification d'un financeur : l'organisme qui verse (ou pourrait verser) une subvention. */
@Component({
  selector: 'app-funder-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="funder ? 'Modifier ' + funder.name : 'Nouveau financeur'"
        description="Un financeur est l'organisme qui accorde une subvention : une mairie, une région, une fondation, une entreprise… Vous le retrouverez dans chaque demande de subvention."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom du financeur</mat-label>
          <input matInput formControlName="name" placeholder="Région, Mairie de…, Fondation…" required />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Donnez le nom du financeur.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select formControlName="type">
            @for (type of types; track type.value) {
              <mat-option [value]="type.value">{{ type.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Personne à contacter (facultatif)</mat-label>
          <input matInput formControlName="contactName" />
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Email (facultatif)</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="off" />
            @if (form.controls.email.hasError('email')) {
              <mat-error>Cette adresse email semble incomplète, par exemple prenom@exemple.fr.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Téléphone (facultatif)</mat-label>
            <input matInput formControlName="phone" autocomplete="off" />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Note (facultatif)</mat-label>
          <textarea matInput rows="2" formControlName="note"></textarea>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class FunderDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<FunderDialog, FunderInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly funder = inject<{ funder: FunderInfo | null }>(MAT_DIALOG_DATA).funder;

  protected readonly types = (Object.keys(FUNDER_TYPE_LABELS) as FunderType[]).map((value) => ({ value, label: FUNDER_TYPE_LABELS[value] }));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    name: [this.funder?.name ?? '', [Validators.required]],
    type: [this.funder?.type ?? ('LOCAL_AUTHORITY' as FunderType)],
    contactName: [this.funder?.contactName ?? ''],
    email: [this.funder?.email ?? '', [Validators.email]],
    phone: [this.funder?.phone ?? ''],
    note: [this.funder?.note ?? ''],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const value = this.form.getRawValue();
    const body = { ...value, name: value.name.trim() };
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(this.funder ? await this.api.updateFunder(this.funder.id, body) : await this.api.createFunder(body));
    } catch (failure) {
      const described = describeHttpError(failure, "Le financeur n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
