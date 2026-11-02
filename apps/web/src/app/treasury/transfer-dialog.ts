import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ThemeService } from '../theme/theme.service';
import { AdminApiService, type FinancialAccountInfo, type TransferInfo } from '../admin/admin-api.service';
import { centsToApi, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

export interface TransferDialogData {
  /** Comptes actifs entre lesquels on peut virer. */
  accounts: FinancialAccountInfo[];
  /** Compte de départ proposé (celui qui est ouvert), s'il y en a un. */
  fromAccountId: string | null;
}

/** Virement interne entre deux comptes de l'association (banque vers livret, caisse vers banque…). Renvoie le virement créé. */
@Component({
  selector: 'app-transfer-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="simple ? 'Déplacer de l’argent entre mes comptes' : 'Nouveau virement interne'"
        description="De l'argent qui passe d'un de vos comptes à un autre (par exemple de la banque vers le livret, ou de la caisse vers la banque). Ce n'est ni une dépense ni une recette : rien n'est gagné ni perdu."
        submitLabel="Enregistrer le virement"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Depuis le compte</mat-label>
            <mat-select formControlName="fromAccountId" required>
              @for (account of data.accounts; track account.id) {
                <mat-option [value]="account.id">{{ account.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Vers le compte</mat-label>
            <mat-select formControlName="toAccountId" required>
              @for (account of destinations(); track account.id) {
                <mat-option [value]="account.id">{{ account.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Montant (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" placeholder="300,00" required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="date" required />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Libellé (facultatif)</mat-label>
          <input matInput formControlName="label" placeholder="Virement vers le livret" />
          <mat-hint>Sans libellé, il sera nommé d'après les deux comptes.</mat-hint>
        </mat-form-field>
        <mat-checkbox formControlName="prepareEntry">{{ simple ? 'L’enregistrer aussi dans les comptes (en brouillon, à relire avant de le valider)' : 'Préparer aussi l’écriture comptable (à relire avant de la comptabiliser)' }}</mat-checkbox>
      </app-form-dialog>
    </form>
  `,
})
export class TransferDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<TransferDialog, TransferInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<TransferDialogData>(MAT_DIALOG_DATA);
  protected readonly simple = inject(ThemeService).viewMode() === 'simple';

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    fromAccountId: [this.data.fromAccountId ?? this.data.accounts[0]?.id ?? ''],
    toAccountId: [''],
    amount: [''],
    date: [new Date().toISOString().slice(0, 10)],
    label: [''],
    prepareEntry: [true],
  });
  private readonly from = signal(this.form.controls.fromAccountId.value);
  protected readonly destinations = computed(() => this.data.accounts.filter((a) => a.id !== this.from()));

  constructor() {
    this.form.controls.fromAccountId.valueChanges.subscribe((id) => {
      this.from.set(id);
      if (this.form.controls.toAccountId.value === id) this.form.controls.toAccountId.setValue('');
    });
  }

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    this.form.markAllAsTouched();
    if (!raw.fromAccountId || !raw.toAccountId || cents === null || cents <= 0 || !raw.date) {
      this.error.set('Choisissez le compte de départ et le compte d’arrivée, indiquez un montant supérieur à zéro (par exemple 300,00) et une date.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.createTransfer({
          fromAccountId: raw.fromAccountId,
          toAccountId: raw.toAccountId,
          amount: centsToApi(cents),
          date: raw.date,
          ...(raw.label.trim() && { label: raw.label.trim() }),
          prepareEntry: raw.prepareEntry,
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "Le virement n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
