import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type AccountInfo, type CommitmentInfo, type EntryCandidateInfo, type ProjectInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { centsToApi, formatApiAmount, formatCents, parseAmountToCents } from './amount';
import { DateField } from '../ui/date-field';

export interface CommitmentDialogData {
  project: ProjectInfo;
  /** Engagement à modifier, ou `null` pour en enregistrer un. */
  commitment: CommitmentInfo | null;
}

/** Enregistrer ou modifier un engagement : une dépense promise (devis, bon de commande) pas encore payée. */
@Component({
  selector: 'app-commitment-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="data.commitment ? 'Modifier l\\'engagement' : 'Enregistrer un engagement'"
        description="Un engagement est une dépense que vous avez promise mais pas encore payée : un devis accepté, un bon de commande. Il n'écrit rien dans la comptabilité ; il sert à savoir combien il reste vraiment à dépenser."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Objet de l'engagement</mat-label>
          <input matInput formControlName="label" placeholder="Devis traiteur" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Dites en quelques mots ce qui est promis, par exemple « Devis traiteur ».</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Montant promis (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" placeholder="300,00" autocomplete="off" required />
            @if (form.controls.amount.hasError('required') || form.controls.amount.hasError('amount')) {
              <mat-error>Saisissez un montant positif, par exemple 300 ou 120,50.</mat-error>
            }
          </mat-form-field>
          <app-date-field label="Date de l'engagement" formControlName="committedOn" hint="Le jour du devis accepté ou de la commande." errorText="Indiquez la date de l'engagement." required />
        </div>
        @if (accounts().length > 0) {
          <mat-form-field appearance="outline">
            <mat-label>Compte de dépense (facultatif)</mat-label>
            <mat-select formControlName="accountId">
              <mat-option value="">Aucun</mat-option>
              @for (account of accounts(); track account.id) {
                <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
              }
            </mat-select>
            <mat-hint>Permet de comparer avec la ligne du budget qui porte le même compte.</mat-hint>
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Note (facultatif)</mat-label>
          <textarea matInput rows="2" formControlName="note"></textarea>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class CommitmentDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CommitmentDialog, CommitmentInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<CommitmentDialogData>(MAT_DIALOG_DATA);

  protected readonly accounts = signal<AccountInfo[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    label: [this.data.commitment?.label ?? '', [Validators.required]],
    amount: [
      this.data.commitment ? formatCents(parseAmountToCents(this.data.commitment.amount) ?? 0).replace(/\s/g, '') : '',
      [
        Validators.required,
        (control: { value: string }) => {
          const cents = parseAmountToCents(control.value);
          return cents === null || cents <= 0 ? { amount: true } : null;
        },
      ],
    ],
    committedOn: [this.data.commitment?.committedOn ?? new Date().toISOString().slice(0, 10), [Validators.required]],
    accountId: [this.data.commitment?.accountId ?? ''],
    note: [this.data.commitment?.note ?? ''],
  });

  constructor() {
    // Le compte est facultatif : si la liste est refusée (droit absent), le champ reste simplement masqué.
    void this.api
      .listAccounts()
      .then((accounts) => this.accounts.set(accounts.filter((a) => a.active && a.number.startsWith('6'))))
      .catch(() => undefined);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const value = this.form.getRawValue();
    const body = {
      label: value.label.trim(),
      amount: centsToApi(parseAmountToCents(value.amount) ?? 0),
      committedOn: value.committedOn,
      accountId: value.accountId || null,
      note: value.note,
    };
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const saved = this.data.commitment
        ? await this.api.updateCommitment(this.data.commitment.id, body)
        : await this.api.createCommitment(this.data.project.id, body);
      this.reference.close(saved);
    } catch (failure) {
      const described = describeHttpError(failure, "L'engagement n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Solder un engagement : choisir l'écriture comptabilisée qui porte la dépense réelle de ce projet. */
@Component({
  selector: 'app-commitment-settle-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Solder l'engagement"
        [description]="
          'La facture est arrivée et enregistrée dans la comptabilité ? Choisissez son écriture. « ' +
          commitment.label +
          ' » ne comptera plus comme promis : c\\'est la dépense réelle qui prendra le relais dans le suivi du budget. Si l\\'écriture est annulée plus tard, l\\'engagement redeviendra promis.'
        "
        submitLabel="Solder l'engagement"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        [submitDisabled]="!loading() && candidates().length === 0"
      >
        @if (loading()) {
          <p class="muted">Recherche des écritures…</p>
        } @else if (candidates().length === 0) {
          <p class="muted">
            Aucune écriture comptabilisée ne porte de dépense affectée à ce projet. Enregistrez d'abord la facture dans la comptabilité
            en l'affectant à ce projet, puis revenez ici.
          </p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Écriture de la facture</mat-label>
            <mat-select formControlName="entryId" required>
              @for (candidate of candidates(); track candidate.id) {
                <mat-option [value]="candidate.id">{{ label(candidate) }}</mat-option>
              }
            </mat-select>
            <mat-hint>Seules les écritures comptabilisées qui portent une dépense de ce projet sont proposées.</mat-hint>
            @if (form.controls.entryId.hasError('required')) {
              <mat-error>Choisissez l'écriture qui porte la facture.</mat-error>
            }
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class CommitmentSettleDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CommitmentSettleDialog, CommitmentInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly commitment = inject<{ commitment: CommitmentInfo }>(MAT_DIALOG_DATA).commitment;

  protected readonly candidates = signal<EntryCandidateInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({ entryId: ['', [Validators.required]] });

  constructor() {
    void this.api
      .commitmentCandidates(this.commitment.id)
      .then((candidates) => this.candidates.set(candidates))
      .catch((failure) => this.error.set(describeHttpError(failure, 'Impossible de chercher les écritures.').message))
      .finally(() => this.loading.set(false));
  }

  protected label(candidate: EntryCandidateInfo): string {
    const number = candidate.number === null ? '' : ` n° ${candidate.number}`;
    return `${candidate.journalCode}${number} · ${candidate.date} · ${candidate.label} — ${formatApiAmount(candidate.projectAmount)} € sur ce projet`;
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Choisissez l\'écriture qui porte la facture, puis validez.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.settleCommitment(this.commitment.id, this.form.getRawValue().entryId));
    } catch (failure) {
      const described = describeHttpError(failure, "L'engagement n'a pas pu être soldé. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Annuler un engagement abandonné (devis refusé, commande annulée), avec son motif. L'historique est conservé. */
@Component({
  selector: 'app-commitment-cancel-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Annuler l'engagement"
        [description]="'« ' + commitment.label + ' » ne comptera plus dans ce qui est promis. Il reste visible dans la liste avec son motif : rien n\\'est effacé.'"
        submitLabel="Annuler l'engagement"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Pourquoi ?</mat-label>
          <textarea matInput rows="2" formControlName="reason" placeholder="Devis refusé, commande annulée…" required></textarea>
          @if (form.controls.reason.hasError('required')) {
            <mat-error>Indiquez pourquoi cet engagement est annulé.</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class CommitmentCancelDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CommitmentCancelDialog, CommitmentInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly commitment = inject<{ commitment: CommitmentInfo }>(MAT_DIALOG_DATA).commitment;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({ reason: ['', [Validators.required]] });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Indiquez pourquoi cet engagement est annulé, puis validez.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.cancelCommitment(this.commitment.id, this.form.getRawValue().reason.trim()));
    } catch (failure) {
      const described = describeHttpError(failure, "L'engagement n'a pas pu être annulé. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
