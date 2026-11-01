import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type AccountInfo, type FinancialAccountInfo } from '../admin/admin-api.service';
import { centsToApi, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

export interface AccountDialogData {
  /** Comptes de trésorerie (classe 5) encore libres, parmi lesquels choisir. */
  freeAccounts: AccountInfo[];
}

/** Création d'un compte bancaire ou d'une caisse, en boîte de dialogue. Renvoie le compte créé. */
@Component({
  selector: 'app-financial-account-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Nouveau compte financier"
        description="Un compte financier suit l'argent d'un compte bancaire ou d'une caisse. Un journal lui est créé automatiquement pour enregistrer ses opérations."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        submitLabel="Créer le compte"
      >
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Nom du compte</mat-label>
            <input matInput formControlName="name" placeholder="Compte courant" required />
            @if (form.controls.name.hasError('required')) {
              <mat-error>Donnez un nom à ce compte, par exemple « Compte courant ».</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type">
              <mat-option value="BANK">Compte bancaire</mat-option>
              <mat-option value="CASH">Caisse (espèces)</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Compte du plan comptable</mat-label>
          <mat-select formControlName="accountId" required>
            @for (candidate of data.freeAccounts; track candidate.id) {
              <mat-option [value]="candidate.id">{{ candidate.number }} — {{ candidate.label }}</mat-option>
            }
          </mat-select>
          <mat-hint>
            @if (data.freeAccounts.length === 0) {
              Aucun compte de trésorerie disponible : ajoutez-en un (numéro commençant par 5) dans Paramètres › Comptabilité.
            } @else {
              Le compte de trésorerie (numéro commençant par 5, ex. 512) qui correspond à ce compte.
            }
          </mat-hint>
          @if (form.controls.accountId.hasError('required')) {
            <mat-error>Choisissez le compte du plan comptable qui correspond.</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Suivi à partir du</mat-label>
            <input matInput type="date" formControlName="openedOn" required />
            <mat-hint>Date de départ de vos enregistrements</mat-hint>
            @if (form.controls.openedOn.hasError('required')) {
              <mat-error>Indiquez la date de départ.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Solde à cette date (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="openingBalance" placeholder="1 250,00" />
            <mat-hint>Ce qu'il y avait sur le compte ce jour-là. Aucune écriture n'est créée.</mat-hint>
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Repère (facultatif)</mat-label>
          <input matInput formControlName="reference" placeholder="Fin de l'IBAN, agence…" />
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class FinancialAccountDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<FinancialAccountDialog, FinancialAccountInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<AccountDialogData>(MAT_DIALOG_DATA);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    name: ['', [Validators.required]],
    type: ['BANK' as 'BANK' | 'CASH'],
    accountId: ['', [Validators.required]],
    openedOn: ['', [Validators.required]],
    openingBalance: [''],
    reference: [''],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const raw = this.form.getRawValue();
    const negative = raw.openingBalance.trim().startsWith('-');
    const cents = parseAmountToCents(raw.openingBalance.replace(/^-/, ''));
    if (cents === null) {
      this.error.set("Le solde à l'ouverture n'est pas un montant valide. Exemple : 1 250,00.");
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.createFinancialAccount({
          name: raw.name.trim(),
          type: raw.type,
          reference: raw.reference.trim() === '' ? null : raw.reference.trim(),
          accountId: raw.accountId,
          openedOn: raw.openedOn,
          openingBalance: centsToApi(negative ? -cents : cents),
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "Le compte n'a pas pu être créé. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
