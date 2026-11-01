import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type EntryCandidateInfo, type TransactionInfo } from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

export interface LinkEntryDialogData {
  transaction: TransactionInfo;
}

/** Associe une transaction à une écriture déjà saisie dont la ligne de banque a le même montant. Renvoie la transaction mise à jour. */
@Component({
  selector: 'app-link-entry-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Associer à une écriture"
        [description]="description"
        submitLabel="Associer"
        [dirty]="form.dirty"
        [busy]="busy()"
        [submitDisabled]="candidates().length === 0"
        [error]="error()"
      >
        @if (loading()) {
          <p class="muted">Recherche des écritures qui correspondent…</p>
        } @else if (candidates().length === 0) {
          <p class="muted">
            Aucune écriture ne correspond à cette transaction : il faut une écriture dont la ligne de banque est de
            {{ amount(data.transaction.amount) }} € sur ce compte. Utilisez plutôt « Comptabiliser » pour en préparer une.
          </p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Écriture</mat-label>
            <mat-select formControlName="entryId" required>
              @for (candidate of candidates(); track candidate.id) {
                <mat-option [value]="candidate.id">
                  {{ candidate.date }} · {{ candidate.label }} ·
                  {{ candidate.status === 'POSTED' ? candidate.journalCode + ' n° ' + candidate.number : 'brouillon' }}
                </mat-option>
              }
            </mat-select>
            @if (form.controls.entryId.hasError('required')) {
              <mat-error>Choisissez l'écriture qui correspond à ce mouvement.</mat-error>
            }
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class LinkEntryDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<LinkEntryDialog, TransactionInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<LinkEntryDialogData>(MAT_DIALOG_DATA);

  protected readonly candidates = signal<EntryCandidateInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;
  protected readonly description =
    "Vous avez déjà saisi l'écriture de ce mouvement ? Reliez-la à la transaction : elles seront considérées comme un seul et même mouvement, sans doublon.";
  protected readonly form = this.fb.group({ entryId: [''] });

  constructor() {
    void this.load();
  }

  protected async save(): Promise<void> {
    const { entryId } = this.form.getRawValue();
    if (!entryId) {
      this.form.markAllAsTouched();
      this.error.set("Choisissez l'écriture à associer, puis validez de nouveau.");
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.linkTransactionEntry(this.data.transaction.id, entryId));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'association n'a pas pu être faite. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.candidates.set(await this.api.entryCandidates(this.data.transaction.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de chercher les écritures. Réessayez dans un instant.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
