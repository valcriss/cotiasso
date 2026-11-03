import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { AdminApiService, type FiscalYearInfo } from './admin-api.service';
import { DateField } from '../ui/date-field';

/** Création d'un exercice comptable, en boîte de dialogue. Renvoie l'exercice créé. */
@Component({
  selector: 'app-fiscal-year-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Nouvel exercice comptable"
        description="Un exercice est la période sur laquelle vous arrêtez vos comptes, souvent une année. Ses dates ne doivent pas chevaucher celles d'un autre exercice."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        submitLabel="Créer l'exercice"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom de l'exercice</mat-label>
          <input matInput formControlName="label" placeholder="Exercice 2026" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Donnez un nom à l'exercice, par exemple « Exercice 2026 ».</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <app-date-field label="Premier jour" formControlName="start" errorText="Indiquez le premier jour de l'exercice." required />
          <app-date-field label="Dernier jour" formControlName="end" errorText="Indiquez le dernier jour de l'exercice." required />
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class FiscalYearDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<FiscalYearDialog, FiscalYearInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    label: ['', [Validators.required]],
    start: ['', [Validators.required]],
    end: ['', [Validators.required]],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const value = this.form.getRawValue();
      this.reference.close(await this.api.createFiscalYear({ label: value.label.trim(), start: value.start, end: value.end }));
    } catch (failure) {
      const described = describeHttpError(failure, "L'exercice n'a pas pu être créé. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
