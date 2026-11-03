import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FinancialAccountInfo, type OperationCategoryInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { todayLocalIso } from '../ui/dates';
import { DateField } from '../ui/date-field';
import { FormDialog } from '../ui/form-dialog';
import { euros } from './reimbursement-labels';
import { ReimbursementsApi, type ReimbursementInfo, type TransactionCandidate } from './reimbursements-api';

export interface PayDialogData {
  request: ReimbursementInfo;
}

/**
 * Étape de remboursement : le trésorier a viré l’argent, il le dit ici. Soit l’application enregistre la sortie d’argent
 * (nouvelle opération), soit on rattache un mouvement déjà importé du relevé. Renvoie la demande remboursée.
 */
@Component({
  selector: 'app-pay-dialog',
  imports: [DateField, FormDialog, MatButtonToggleModule, MatFormFieldModule, MatSelectModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="'Rembourser la demande n° ' + data.request.number"
        [description]="'Vous remboursez ' + data.request.requesterName + ' : ' + amount + '. Une fois enregistré, le remboursement apparaît dans vos comptes et la demande est terminée.'"
        submitLabel="Enregistrer le remboursement"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-button-toggle-group formControlName="mode" aria-label="Comment enregistrer le remboursement" hideSingleSelectionIndicator>
          <mat-button-toggle value="CREATE">J’enregistre le paiement</mat-button-toggle>
          <mat-button-toggle value="EXISTING" [disabled]="candidates().length === 0">C’est déjà sur le relevé</mat-button-toggle>
        </mat-button-toggle-group>
        @if (candidates().length === 0 && !loading()) {
          <p class="muted">Aucun mouvement de {{ amount }} n’est encore sur vos comptes. Si le virement vient d’être fait, enregistrez-le ici.</p>
        }

        @if (form.controls.mode.value === 'CREATE') {
          <mat-form-field appearance="outline">
            <mat-label>Compte qui a payé</mat-label>
            <mat-select formControlName="financialAccountId">
              @for (account of accounts(); track account.id) {
                <mat-option [value]="account.id">{{ account.name }}</mat-option>
              }
            </mat-select>
            @if (form.controls.financialAccountId.invalid) {
              <mat-error>Choisissez le compte bancaire ou la caisse qui a servi au remboursement.</mat-error>
            }
          </mat-form-field>
          <app-date-field label="Date du paiement" formControlName="date" errorText="Indiquez la date du paiement." required />
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Mouvement du relevé</mat-label>
            <mat-select formControlName="transactionId">
              @for (candidate of candidates(); track candidate.id) {
                <mat-option [value]="candidate.id">{{ candidate.date }} · {{ candidate.accountName }} · {{ candidate.label }}@if (candidate.booked) { (déjà enregistré) }</mat-option>
              }
            </mat-select>
            @if (form.controls.transactionId.invalid) {
              <mat-error>Choisissez le mouvement qui correspond à ce remboursement.</mat-error>
            }
          </mat-form-field>
        }

        @if (needsCategory()) {
          <mat-form-field appearance="outline">
            <mat-label>Catégorie de la dépense</mat-label>
            <mat-select formControlName="categoryId">
              @for (category of categories(); track category.id) {
                <mat-option [value]="category.id">{{ category.label }}</mat-option>
              }
            </mat-select>
            <mat-hint>Ce que le remboursement a servi à payer (fournitures, assurance…).</mat-hint>
            @if (form.controls.categoryId.invalid) {
              <mat-error>Choisissez la catégorie de la dépense.</mat-error>
            }
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class PayDialog {
  private readonly admin = inject(AdminApiService);
  private readonly api = inject(ReimbursementsApi);
  private readonly reference = inject<MatDialogRef<PayDialog, ReimbursementInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<PayDialogData>(MAT_DIALOG_DATA);
  protected readonly amount = euros(this.data.request.amount);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly accounts = signal<FinancialAccountInfo[]>([]);
  protected readonly categories = signal<OperationCategoryInfo[]>([]);
  protected readonly candidates = signal<TransactionCandidate[]>([]);

  protected readonly form = this.fb.group({
    mode: ['CREATE' as 'CREATE' | 'EXISTING'],
    financialAccountId: [''],
    date: [todayLocalIso()],
    transactionId: [''],
    categoryId: [''],
  });

  /** Le mouvement déjà enregistré dans les comptes n'a pas besoin de catégorie. */
  protected needsCategory(): boolean {
    if (this.form.controls.mode.value === 'CREATE') return true;
    const chosen = this.candidates().find((c) => c.id === this.form.controls.transactionId.value);
    return !chosen?.booked;
  }

  constructor() {
    void this.load();
    this.form.controls.mode.valueChanges.subscribe(() => this.updateValidators());
    this.form.controls.transactionId.valueChanges.subscribe(() => this.updateValidators());
    this.updateValidators();
  }

  private updateValidators(): void {
    const create = this.form.controls.mode.value === 'CREATE';
    this.setRequired(this.form.controls.financialAccountId, create);
    this.setRequired(this.form.controls.date, create);
    this.setRequired(this.form.controls.transactionId, !create);
    this.setRequired(this.form.controls.categoryId, this.needsCategory());
  }

  private setRequired(control: FormControl<string>, required: boolean): void {
    control.setValidators(required ? Validators.required : null);
    control.updateValueAndValidity({ emitEvent: false });
  }

  protected async save(): Promise<void> {
    this.updateValidators();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis validez de nouveau.');
      return;
    }
    const raw = this.form.getRawValue();
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.process(
          this.data.request.id,
          raw.mode === 'CREATE'
            ? { mode: 'CREATE', financialAccountId: raw.financialAccountId, date: raw.date, categoryId: raw.categoryId }
            : { mode: 'EXISTING', transactionId: raw.transactionId, ...(this.needsCategory() && { categoryId: raw.categoryId }) },
        ),
      );
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Le remboursement n’a pas pu être enregistré. Rien n’a été modifié : réessayez dans un instant.').message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const [accounts, categories, candidates] = await Promise.all([
        this.admin.listFinancialAccounts(),
        this.admin.listOperationCategories(),
        this.api.candidates(this.data.request.id).catch(() => []),
      ]);
      this.accounts.set(accounts.filter((a) => !a.archivedOn));
      this.categories.set(categories.filter((c) => c.direction === 'OUT'));
      this.candidates.set(candidates);
      if (this.accounts().length === 1) this.form.controls.financialAccountId.setValue(this.accounts()[0]!.id);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'La liste des comptes n’a pas pu être chargée. Rechargez la page.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
