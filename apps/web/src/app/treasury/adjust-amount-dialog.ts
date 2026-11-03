import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { AdminApiService, type AdjustAmountResult, type TransactionInfo } from '../admin/admin-api.service';
import { centsToApi, formatApiAmount, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { todayLocalIso } from '../ui/dates';
import { DateField } from '../ui/date-field';

export interface AdjustAmountDialogData {
  transaction: TransactionInfo;
  accountName: string;
}

/**
 * « Corriger le montant » (ADR 0032) : le montant d’une opération enregistrée est définitif, on ne le réécrit pas. On ajoute une
 * petite opération de correction pour la différence : l’historique reste lisible et le solde redevient juste.
 */
@Component({
  selector: 'app-adjust-amount-dialog',
  imports: [DateField, FrDatePipe, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (submit)="$event.preventDefault(); save()" novalidate>
      <app-form-dialog
        title="Corriger le montant"
        description="Le montant d’une opération enregistrée ne se réécrit pas. Indiquez le montant juste : le logiciel ajoute une opération de correction pour la différence, dans la même catégorie. Rien n’est effacé."
        submitLabel="Ajouter la correction"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <p class="summary">
          <strong>{{ data.transaction.label }}</strong><br />
          <span class="muted">{{ data.transaction.operationDate | frDate }} · {{ amount(data.transaction.amount) }} € · {{ data.accountName }}</span>
        </p>
        <mat-form-field appearance="outline">
          <mat-label>Montant juste (€)</mat-label>
          <input matInput formControlName="amount" inputmode="decimal" autocomplete="off" required />
          <mat-hint>Le montant que l’opération aurait dû avoir, sans signe.</mat-hint>
        </mat-form-field>
        <app-date-field label="Date de la correction" formControlName="date" hint="La correction est datée d’aujourd’hui par défaut ; l’opération d’origine garde sa date." required />
        @if (consequence(); as text) {
          <p class="notice">{{ text }}</p>
        }
      </app-form-dialog>
    </form>
  `,
})
export class AdjustAmountDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<AdjustAmountDialog, AdjustAmountResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<AdjustAmountDialogData>(MAT_DIALOG_DATA);
  protected readonly amount = formatApiAmount;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({ amount: [''], date: [todayLocalIso()] });
  private readonly typed = toSignal(this.form.controls.amount.valueChanges.pipe(map((value) => parseAmountToCents(value))), { initialValue: null });

  /** Dit avant d’agir ce qui sera ajouté (sens et montant de l’écart). */
  protected readonly consequence = computed(() => {
    const cents = this.typed();
    if (cents === null || cents <= 0) return null;
    const current = parseAmountToCents(this.data.transaction.amount.replace(/^-/, '')) ?? 0;
    const gap = current - cents;
    if (gap === 0) return 'Ce montant est déjà celui de l’opération : il n’y a rien à corriger.';
    const incoming = !this.data.transaction.amount.startsWith('-');
    const reduces = gap > 0;
    const sign = incoming === reduces ? 'dépensé' : 'reçu';
    return `Une correction de ${formatApiAmount(centsToApi(Math.abs(gap)))} € « argent ${sign} » sera ajoutée. Une fois faite, l’opération vaudra bien ${formatApiAmount(centsToApi(cents))} €.`;
  });

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    if (cents === null || cents <= 0) {
      this.error.set('Indiquez le montant juste, par exemple 40,00. Rien n’a été modifié.');
      this.details.set([]);
      return;
    }
    if (!raw.date) {
      this.error.set('Indiquez la date de la correction. Rien n’a été modifié.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.adjustOperationAmount(this.data.transaction.id, { amount: centsToApi(cents), date: raw.date }));
    } catch (failure) {
      const described = describeHttpError(failure, "La correction n'a pas pu être ajoutée. Rien n'a été modifié : réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
