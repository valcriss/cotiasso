import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { startWith } from 'rxjs';
import {
  AdminApiService,
  type GrantFinanceInfo,
  type GrantInfo,
  type GrantScheduleInfo,
  type PaymentCandidateInfo,
} from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { centsToApi, formatApiAmount, formatCents, parseAmountToCents } from '../accounting/amount';
import { FormDialog } from '../ui/form-dialog';

const positive = (control: { value: string }) => {
  const cents = parseAmountToCents(control.value);
  return cents === null || cents <= 0 ? { amount: true } : null;
};
const toForm = (amount: string | null) => (amount === null ? '' : formatCents(parseAmountToCents(amount) ?? 0).replace(/\s/g, ''));

export interface ScheduleDialogData {
  grant: GrantInfo;
  /** Échéance à modifier, ou `null` pour en ajouter une. */
  line: GrantScheduleInfo | null;
  /** Ce qui n'est pas encore planifié sur le montant accordé (pour guider la saisie). */
  unplanned: string;
}

/** Ajouter ou modifier une échéance : un versement attendu du financeur (date, montant, condition). Un plan, pas une écriture. */
@Component({
  selector: 'app-schedule-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="data.line ? 'Modifier l\\'échéance' : 'Ajouter une échéance'"
        description="Une échéance est un versement que vous attendez du financeur, à une date donnée. Ce n'est qu'un plan : l'argent réellement reçu s'enregistre à part, en rattachant l'encaissement."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Date prévue</mat-label>
            <input matInput type="date" formControlName="dueOn" required />
            @if (form.controls.dueOn.hasError('required')) {
              <mat-error>Indiquez la date à laquelle vous attendez ce versement.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Montant attendu (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" placeholder="300,00" autocomplete="off" required />
            <mat-hint>Reste à planifier : {{ unplanned }} €.</mat-hint>
            @if (form.controls.amount.hasError('required') || form.controls.amount.hasError('amount')) {
              <mat-error>Saisissez un montant positif, par exemple 300 ou 120,50.</mat-error>
            }
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Condition (facultatif)</mat-label>
          <input matInput formControlName="condition" placeholder="À la signature, après le bilan intermédiaire…" />
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class ScheduleDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<ScheduleDialog, GrantFinanceInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<ScheduleDialogData>(MAT_DIALOG_DATA);
  protected readonly unplanned = formatApiAmount(this.data.unplanned);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    dueOn: [this.data.line?.dueOn ?? '', [Validators.required]],
    amount: [toForm(this.data.line?.amount ?? null), [Validators.required, positive]],
    condition: [this.data.line?.condition ?? ''],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const v = this.form.getRawValue();
    const body = { dueOn: v.dueOn, amount: centsToApi(parseAmountToCents(v.amount) ?? 0), condition: v.condition.trim() };
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(
        this.data.line ? await this.api.updateGrantSchedule(this.data.line.id, body) : await this.api.addGrantSchedule(this.data.grant.id, body),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "L'échéance n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface PaymentDialogData {
  grant: GrantInfo;
  schedule: GrantScheduleInfo[];
}

/** Enregistrer un versement reçu : choisir l'encaissement sur le compte bancaire, et la part qui vient de cette subvention. */
@Component({
  selector: 'app-grant-payment-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Enregistrer un versement reçu"
        description="Le financeur a versé de l'argent ? Rattachez l'encaissement vu sur votre compte bancaire à cette subvention. Cela ne crée aucune écriture comptable : l'encaissement se comptabilise normalement, à part."
        submitLabel="Enregistrer le versement"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        [submitDisabled]="!loading() && candidates().length === 0"
      >
        @if (loading()) {
          <p class="muted">Recherche des encaissements…</p>
        } @else if (unavailable()) {
          <p class="muted">La liste des encaissements n'est pas accessible avec vos droits : il faut pouvoir consulter les comptes.</p>
        } @else if (candidates().length === 0) {
          <p class="muted">
            Aucun encaissement disponible. Importez ou saisissez d'abord le versement dans la page Comptes, puis revenez ici.
          </p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Encaissement</mat-label>
            <mat-select formControlName="transactionId" required>
              @for (candidate of candidates(); track candidate.id) {
                <mat-option [value]="candidate.id">{{ label(candidate) }}</mat-option>
              }
            </mat-select>
            <mat-hint>Seuls les encaissements dont une part n'est affectée à rien sont proposés.</mat-hint>
            @if (form.controls.transactionId.hasError('required')) {
              <mat-error>Choisissez l'encaissement qui correspond au versement.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Part de cette subvention (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" autocomplete="off" required />
            @if (selected(); as chosen) {
              <mat-hint>Disponible sur cet encaissement : {{ amount(chosen.remaining) }} €.</mat-hint>
            }
            @if (form.controls.amount.hasError('required') || form.controls.amount.hasError('amount')) {
              <mat-error>Saisissez un montant positif, par exemple 300 ou 120,50.</mat-error>
            }
          </mat-form-field>
          @if (data.schedule.length > 0) {
            <mat-form-field appearance="outline">
              <mat-label>Échéance réglée (facultatif)</mat-label>
              <mat-select formControlName="scheduleId">
                <mat-option value="">Aucune</mat-option>
                @for (line of data.schedule; track line.id) {
                  <mat-option [value]="line.id">{{ line.dueOn }} — {{ amount(line.amount) }} € attendus</mat-option>
                }
              </mat-select>
              <mat-hint>Pour suivre ce qui est attendu et ce qui est arrivé.</mat-hint>
            </mat-form-field>
          }
          <mat-form-field appearance="outline">
            <mat-label>Note (facultatif)</mat-label>
            <input matInput formControlName="note" />
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class GrantPaymentDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<GrantPaymentDialog, GrantFinanceInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<PaymentDialogData>(MAT_DIALOG_DATA);

  protected readonly candidates = signal<PaymentCandidateInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly unavailable = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly amount = formatApiAmount;
  protected readonly form = this.fb.group({
    transactionId: ['', [Validators.required]],
    amount: ['', [Validators.required, positive]],
    scheduleId: [''],
    note: [''],
  });

  private readonly changes = toSignal(this.form.controls.transactionId.valueChanges.pipe(startWith('')));
  protected readonly selected = computed(() => this.candidates().find((c) => c.id === this.changes()) ?? null);

  constructor() {
    void this.api
      .grantPaymentCandidates(this.data.grant.id)
      .then((list) => this.candidates.set(list))
      .catch(() => this.unavailable.set(true))
      .finally(() => this.loading.set(false));
    // Choisir l'encaissement propose sa part disponible, tant que le montant n'a pas été saisi à la main.
    this.form.controls.transactionId.valueChanges.subscribe((id) => {
      const chosen = this.candidates().find((c) => c.id === id);
      if (chosen && !this.form.controls.amount.dirty) this.form.controls.amount.setValue(toForm(chosen.remaining));
    });
  }

  protected label(candidate: PaymentCandidateInfo): string {
    return `${candidate.operationDate} · ${candidate.label} · ${candidate.accountName} — ${formatApiAmount(candidate.amount)} €`;
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const v = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.recordGrantPayment(this.data.grant.id, {
          transactionId: v.transactionId,
          amount: centsToApi(parseAmountToCents(v.amount) ?? 0),
          scheduleId: v.scheduleId || null,
          note: v.note.trim() || null,
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "Le versement n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Annuler un versement rattaché par erreur, avec un motif. Il reste dans l'historique et l'encaissement redevient disponible. */
@Component({
  selector: 'app-grant-payment-cancel-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Annuler le versement"
        description="Ce versement ne comptera plus dans ce qui a été reçu, et l'encaissement redeviendra disponible pour un autre rattachement. Il reste visible dans l'historique avec son motif : rien n'est effacé."
        submitLabel="Annuler le versement"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Pourquoi ?</mat-label>
          <textarea matInput rows="2" formControlName="reason" placeholder="Rattaché à la mauvaise subvention…" required></textarea>
          @if (form.controls.reason.hasError('required') || form.controls.reason.hasError('minlength')) {
            <mat-error>Indiquez le motif en quelques mots (3 caractères au moins), pour garder la trace de ce qui s'est passé.</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class GrantPaymentCancelDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<GrantPaymentCancelDialog, GrantFinanceInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<{ paymentId: string }>(MAT_DIALOG_DATA);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({ reason: ['', [Validators.required, Validators.minLength(3)]] });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Indiquez le motif, puis validez.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.cancelGrantPayment(this.data.paymentId, this.form.getRawValue().reason.trim()));
    } catch (failure) {
      const described = describeHttpError(failure, "Le versement n'a pas pu être annulé. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
