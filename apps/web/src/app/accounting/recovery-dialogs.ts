import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type AccountInfo,
  type FinancialAccountInfo,
  type PrepareReportInfo,
  type RecoveryBatchInfo,
  type RecoveryItemInfo,
} from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

const INVALID = 'Vérifiez les champs signalés en rouge, puis validez de nouveau.';

/** Création d'un lot de reprise : un nom pour s'y retrouver. Renvoie le lot créé. */
@Component({
  selector: 'app-batch-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Nouveau lot de reprise"
        description="Un lot regroupe les écritures préparées en une fois pour reprendre l'historique (par exemple « Reprise 2025 — compte courant »). Rien n'est définitif tant que vous ne comptabilisez pas le lot, et vous pouvez l'abandonner."
        submitLabel="Créer le lot"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom du lot</mat-label>
          <input matInput formControlName="name" placeholder="Reprise 2025 — compte courant" required />
          @if (form.controls.name.hasError('required') || form.controls.name.hasError('minlength')) {
            <mat-error>Donnez un nom d'au moins 3 caractères au lot.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Note (facultatif)</mat-label>
          <input matInput formControlName="note" placeholder="Pièces manquantes, source des données…" />
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class BatchDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<BatchDialog, RecoveryBatchInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({ name: ['', [Validators.required, Validators.minLength(3)]], note: [''] });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    const { name, note } = this.form.getRawValue();
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.createRecoveryBatch({ name: name.trim(), ...(note.trim() && { note: note.trim() }) }));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le lot n'a pas pu être créé. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface OpeningDialogData {
  batchId: string;
  /** Comptes financiers dont le solde d'ouverture n'est pas nul. */
  accounts: FinancialAccountInfo[];
  /** Comptes de capitaux (classe 1) actifs. */
  capitalAccounts: AccountInfo[];
}

/** Solde d'ouverture d'un compte : banque / compte de capitaux choisi, origine expliquée. Renvoie l'écriture préparée. */
@Component({
  selector: 'app-opening-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Reprendre un solde de départ"
        description="Le premier solde d'un compte n'est pas une recette : il vient de quelque part (fonds apportés à la création, résultat des années précédentes…). Dites d'où, pour que les comptes restent compréhensibles. Un brouillon est préparé, à relire avant de comptabiliser le lot."
        submitLabel="Préparer le brouillon"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        @if (data.accounts.length === 0) {
          <p class="muted">Aucun compte n'a de solde d'ouverture à reprendre : tous les soldes de départ sont nuls.</p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Compte</mat-label>
            <mat-select formControlName="financialAccountId" required>
              @for (account of data.accounts; track account.id) {
                <mat-option [value]="account.id">{{ account.name }} — {{ account.balances.opening }} € au {{ account.openedOn }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>D'où vient cet argent ?</mat-label>
            <mat-select formControlName="counterpartAccountId" required>
              @for (account of data.capitalAccounts; track account.id) {
                <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
              }
            </mat-select>
            <mat-hint>Un compte de capitaux du plan comptable (fonds associatifs, report à nouveau…).</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Explication</mat-label>
            <input matInput formControlName="explanation" placeholder="Fonds apportés à la création de l'association" required />
            <mat-hint>Elle sera lisible dans le libellé de l'écriture.</mat-hint>
            @if (form.controls.explanation.hasError('minlength') || form.controls.explanation.hasError('required')) {
              <mat-error>Expliquez l'origine de ce solde en quelques mots (5 caractères au moins).</mat-error>
            }
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class OpeningDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<OpeningDialog, RecoveryItemInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<OpeningDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    financialAccountId: [this.data.accounts[0]?.id ?? '', [Validators.required]],
    counterpartAccountId: ['', [Validators.required]],
    explanation: ['', [Validators.required, Validators.minLength(5)]],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    const raw = this.form.getRawValue();
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.prepareRecoveryOpening(this.data.batchId, { ...raw, explanation: raw.explanation.trim() }));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le brouillon d'ouverture n'a pas pu être préparé. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface PrepareDialogData {
  batchId: string;
  accounts: FinancialAccountInfo[];
}

/** Prépare un brouillon par transaction qualifiée d'un compte, sur une période. Renvoie le compte rendu. */
@Component({
  selector: 'app-prepare-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Préparer les écritures d'un compte"
        description="L'application prépare un brouillon d'écriture pour chaque transaction du compte dont vous avez choisi le compte de contrepartie. Les autres sont simplement listées avec la raison : rien n'est perdu, vous pourrez relancer après les avoir qualifiées."
        submitLabel="Préparer"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Compte</mat-label>
          <mat-select formControlName="financialAccountId" required>
            @for (account of data.accounts; track account.id) {
              <mat-option [value]="account.id">{{ account.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Du (facultatif)</mat-label>
            <input matInput type="date" formControlName="from" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Au (facultatif)</mat-label>
            <input matInput type="date" formControlName="to" />
          </mat-form-field>
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class PrepareDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<PrepareDialog, PrepareReportInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<PrepareDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    financialAccountId: [this.data.accounts[0]?.id ?? '', [Validators.required]],
    from: [''],
    to: [''],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    const { financialAccountId, from, to } = this.form.getRawValue();
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.prepareRecoveryEntries(this.data.batchId, { financialAccountId, ...(from && { from }), ...(to && { to }) }));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Les écritures n'ont pas pu être préparées. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
