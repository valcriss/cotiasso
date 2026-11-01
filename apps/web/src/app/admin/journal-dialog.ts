import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { AdminApiService, type JournalInfo, type JournalType } from './admin-api.service';

/** Types de journal, avec un libellé en langage courant. */
export const JOURNAL_TYPES: readonly { value: JournalType; label: string }[] = [
  { value: 'BANK', label: 'Banque' },
  { value: 'CASH', label: 'Caisse' },
  { value: 'PURCHASES', label: 'Achats (factures de dépenses)' },
  { value: 'REVENUE', label: 'Produits (ventes, cotisations, subventions)' },
  { value: 'MISC', label: 'Opérations diverses' },
  { value: 'OPENING', label: "À-nouveaux (reports à l'ouverture)" },
];

/** Création d'un journal comptable, en boîte de dialogue. Renvoie le journal créé. */
@Component({
  selector: 'app-journal-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Nouveau journal"
        description="Un journal est un cahier dans lequel on classe les écritures d'un même type (achats, banque…). Son code et son type ne pourront plus être changés."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        submitLabel="Créer le journal"
      >
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" placeholder="VT" autocomplete="off" required />
            <mat-hint>Lettres majuscules, chiffres, tirets</mat-hint>
            @if (form.controls.code.hasError('required')) {
              <mat-error>Donnez un code court au journal, par exemple VT.</mat-error>
            } @else if (form.controls.code.hasError('pattern')) {
              <mat-error>Utilisez des majuscules, des chiffres ou des tirets (10 caractères au plus).</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Nom du journal</mat-label>
            <input matInput formControlName="label" placeholder="Ventes" required />
            @if (form.controls.label.hasError('required')) {
              <mat-error>Donnez un nom au journal.</mat-error>
            }
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Type</mat-label>
          <mat-select formControlName="type">
            @for (type of types; track type.value) {
              <mat-option [value]="type.value">{{ type.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class JournalDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<JournalDialog, JournalInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly types = JOURNAL_TYPES;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9-]{1,10}$/)]],
    label: ['', [Validators.required]],
    type: ['MISC' as JournalType],
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
      this.reference.close(await this.api.createJournal({ code: value.code, label: value.label.trim(), type: value.type }));
    } catch (failure) {
      const described = describeHttpError(failure, "Le journal n'a pas pu être créé. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
