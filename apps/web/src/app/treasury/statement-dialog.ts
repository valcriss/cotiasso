import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AdminApiService, type FinancialAccountInfo } from '../admin/admin-api.service';
import { centsToApi, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

export interface StatementDialogData {
  account: FinancialAccountInfo;
}

/** Enregistrement du solde indiqué par un relevé bancaire. Renvoie `true` une fois enregistré. */
@Component({
  selector: 'app-statement-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="'Solde du relevé — ' + data.account.name"
        description="Recopiez le solde de fin indiqué sur votre relevé bancaire. Il sert de preuve et permet de repérer un écart avec vos enregistrements ; il ne modifie rien."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        submitLabel="Enregistrer le solde"
      >
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Début de la période</mat-label>
            <input matInput type="date" formControlName="periodStart" required />
            @if (form.controls.periodStart.hasError('required')) {
              <mat-error>Indiquez le premier jour du relevé.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Fin de la période</mat-label>
            <input matInput type="date" formControlName="periodEnd" required />
            @if (form.controls.periodEnd.hasError('required')) {
              <mat-error>Indiquez le dernier jour du relevé.</mat-error>
            }
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Solde de fin (€)</mat-label>
          <input matInput inputmode="decimal" formControlName="closingBalance" placeholder="1 250,00" required />
          <mat-hint>Un solde négatif s'écrit avec un signe moins : -120,40.</mat-hint>
          @if (form.controls.closingBalance.hasError('required')) {
            <mat-error>Recopiez le solde de fin du relevé.</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class StatementDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<StatementDialog, boolean>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<StatementDialogData>(MAT_DIALOG_DATA);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    periodStart: ['', [Validators.required]],
    periodEnd: ['', [Validators.required]],
    closingBalance: ['', [Validators.required]],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const raw = this.form.getRawValue();
    const negative = raw.closingBalance.trim().startsWith('-');
    const cents = parseAmountToCents(raw.closingBalance.replace(/^-/, ''));
    if (cents === null) {
      this.error.set("Le solde n'est pas un montant valide. Exemple : 1 250,00.");
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      await this.api.recordStatement(this.data.account.id, {
        periodStart: raw.periodStart,
        periodEnd: raw.periodEnd,
        closingBalance: centsToApi(negative ? -cents : cents),
      });
      this.reference.close(true);
    } catch (failure) {
      const described = describeHttpError(failure, "Le solde n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
