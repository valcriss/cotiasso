import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { startWith } from 'rxjs';
import { AdminApiService, type ExpenseCandidateInfo, type GrantExpensesInfo, type GrantInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { centsToApi, formatApiAmount, formatCents, parseAmountToCents } from '../accounting/amount';
import { FormDialog } from '../ui/form-dialog';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { formatDate } from '../ui/dates';

const positive = (control: { value: string }) => {
  const cents = parseAmountToCents(control.value);
  return cents === null || cents <= 0 ? { amount: true } : null;
};

/** Affecter une dépense à la subvention : choisir une dépense déjà comptabilisée de l'un des projets financés, et la part à y imputer. */
@Component({
  selector: 'app-grant-expense-dialog',
  imports: [FrDatePipe, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Affecter une dépense"
        description="Choisissez une dépense déjà enregistrée dans la comptabilité, pour l'un des projets que cette subvention finance, et la part que la subvention prend en charge. C'est un suivi pour le compte rendu : cela ne crée aucune écriture."
        submitLabel="Affecter la dépense"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        [submitDisabled]="!loading() && candidates().length === 0"
      >
        @if (loading()) {
          <p class="muted">Recherche des dépenses…</p>
        } @else if (unavailable()) {
          <p class="muted">La liste des dépenses n'est pas accessible avec vos droits : il faut pouvoir consulter les écritures.</p>
        } @else if (candidates().length === 0) {
          <p class="muted">
            Aucune dépense disponible. Seules les dépenses comptabilisées des projets financés par cette subvention, dont une part n'est
            pas déjà affectée, sont proposées. Vérifiez que la dépense est bien comptabilisée et affectée à l'un de ces projets.
          </p>
        } @else {
          <mat-form-field appearance="outline">
            <mat-label>Dépense</mat-label>
            <mat-select formControlName="allocationId" required>
              @for (candidate of candidates(); track candidate.allocationId) {
                <mat-option [value]="candidate.allocationId">{{ label(candidate) }}</mat-option>
              }
            </mat-select>
            <mat-hint>Seules les dépenses comptabilisées dont une part est encore libre sont proposées.</mat-hint>
            @if (form.controls.allocationId.hasError('required')) {
              <mat-error>Choisissez la dépense à affecter.</mat-error>
            }
          </mat-form-field>
          @if (selected(); as chosen) {
            @if (chosen.outOfPeriod) {
              <p class="alert" role="alert">
                Cette dépense est datée du {{ chosen.entry.date | frDate }}, hors de la période financée par la subvention. Vous pouvez l'affecter, mais
                certains financeurs l'écartent : elle sera signalée dans le compte rendu.
              </p>
            }
          }
          <mat-form-field appearance="outline">
            <mat-label>Part prise en charge par la subvention (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" autocomplete="off" required />
            @if (selected(); as chosen) {
              <mat-hint>Disponible sur cette dépense : {{ amount(chosen.remaining) }} € (sur {{ amount(chosen.amount) }} €).</mat-hint>
            }
            @if (form.controls.amount.hasError('required') || form.controls.amount.hasError('amount')) {
              <mat-error>Saisissez un montant positif, par exemple 250 ou 120,50.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Cofinancement : explication (facultatif)</mat-label>
            <textarea matInput rows="2" formControlName="coFinancingReason" placeholder="Complété par les fonds propres, financé aussi par…"></textarea>
            <mat-hint>À remplir si le total affecté dépasse le montant accordé : l'explication figurera dans le compte rendu.</mat-hint>
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class GrantExpenseDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<GrantExpenseDialog, GrantExpensesInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly grant = inject<{ grant: GrantInfo }>(MAT_DIALOG_DATA).grant;

  protected readonly candidates = signal<ExpenseCandidateInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly unavailable = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly amount = formatApiAmount;
  protected readonly form = this.fb.group({
    allocationId: ['', [Validators.required]],
    amount: ['', [Validators.required, positive]],
    coFinancingReason: [''],
  });

  private readonly changes = toSignal(this.form.controls.allocationId.valueChanges.pipe(startWith('')));
  protected readonly selected = computed(() => this.candidates().find((c) => c.allocationId === this.changes()) ?? null);

  constructor() {
    void this.api
      .grantExpenseCandidates(this.grant.id)
      .then((list) => this.candidates.set(list))
      .catch(() => this.unavailable.set(true))
      .finally(() => this.loading.set(false));
    // Choisir une dépense propose sa part libre, tant que le montant n'a pas été saisi à la main.
    this.form.controls.allocationId.valueChanges.subscribe((id) => {
      const chosen = this.candidates().find((c) => c.allocationId === id);
      if (chosen && !this.form.controls.amount.dirty) {
        this.form.controls.amount.setValue(formatCents(parseAmountToCents(chosen.remaining) ?? 0).replace(/\s/g, ''));
      }
    });
  }

  protected label(candidate: ExpenseCandidateInfo): string {
    const number = candidate.entry.number === null ? '' : ` n° ${candidate.entry.number}`;
    return `${formatDate(candidate.entry.date)} · ${candidate.entry.label} (${candidate.entry.journalCode}${number}) · ${candidate.account.number} ${candidate.account.label} · ${candidate.project.code} — ${formatApiAmount(candidate.remaining)} € libres`;
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
        await this.api.attachGrantExpense(this.grant.id, {
          allocationId: v.allocationId,
          amount: centsToApi(parseAmountToCents(v.amount) ?? 0),
          coFinancingReason: v.coFinancingReason.trim() || null,
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "La dépense n'a pas pu être affectée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Annuler une affectation de dépense, avec un motif. Elle reste dans l'historique et la dépense redevient disponible. */
@Component({
  selector: 'app-grant-expense-cancel-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Annuler l'affectation"
        description="Cette dépense ne comptera plus pour la subvention, et elle redeviendra disponible pour une autre. L'affectation reste visible dans l'historique avec son motif : rien n'est effacé."
        submitLabel="Annuler l'affectation"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Pourquoi ?</mat-label>
          <textarea matInput rows="2" formControlName="reason" placeholder="Affectée à la mauvaise subvention, écriture annulée…" required></textarea>
          @if (form.controls.reason.hasError('required') || form.controls.reason.hasError('minlength')) {
            <mat-error>Indiquez le motif en quelques mots (3 caractères au moins), pour garder la trace de ce qui s'est passé.</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class GrantExpenseCancelDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<GrantExpenseCancelDialog, GrantExpensesInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<{ expenseId: string }>(MAT_DIALOG_DATA);

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
      this.reference.close(await this.api.cancelGrantExpense(this.data.expenseId, this.form.getRawValue().reason.trim()));
    } catch (failure) {
      const described = describeHttpError(failure, "L'affectation n'a pas pu être annulée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
