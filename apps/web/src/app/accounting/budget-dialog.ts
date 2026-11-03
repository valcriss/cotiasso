import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { startWith } from 'rxjs';
import {
  AdminApiService,
  type AccountInfo,
  type BudgetInfo,
  type BudgetLineKind,
  type BudgetSummaryInfo,
  type ProjectInfo,
} from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { formatEuroCents, centsToApi, formatCents, parseAmountToCents } from './amount';
import { BUDGET_KIND_LABELS } from './project-labels';
import { DateField } from '../ui/date-field';

export type BudgetDialogData =
  | { mode: 'create'; project: ProjectInfo; versions: BudgetSummaryInfo[] }
  | { mode: 'edit'; project: ProjectInfo; budget: BudgetInfo };

/**
 * Préparer un budget (libellé et version à reprendre) ou en modifier les lignes. Une ligne est une dépense ou une recette
 * prévue, sur une période. Renvoie le budget enregistré. Un budget est une prévision : il ne crée aucune écriture.
 */
@Component({
  selector: 'app-budget-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styles: `
    .line {
      border: 1px solid var(--app-border);
      border-radius: 4px;
      padding: 12px 12px 0;
      margin-bottom: 12px;
    }
    .line-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .totals {
      font-variant-numeric: tabular-nums;
      margin: 8px 0 0;
    }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="data.mode === 'create' ? 'Préparer un budget' : 'Budget n° ' + budgetNumber + ' — ' + data.project.name"
        [description]="
          data.mode === 'create'
            ? 'Un budget est ce que vous prévoyez de dépenser et de recevoir pour ce projet. Vous le préparez ici, puis le bureau l\\'approuve. Il ne crée aucune écriture comptable.'
            : 'Listez les dépenses et les recettes que vous prévoyez, avec leur période. Tant que le budget n\\'est pas approuvé, vous pouvez le modifier librement.'
        "
        [submitLabel]="data.mode === 'create' ? 'Préparer le budget' : 'Enregistrer le budget'"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom de ce budget</mat-label>
          <input matInput formControlName="label" placeholder="Budget prévisionnel 2026" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Donnez un nom à ce budget, par exemple « Budget prévisionnel 2026 ».</mat-error>
          }
        </mat-form-field>

        @if (data.mode === 'create') {
          @if (data.versions.length > 0) {
            <mat-form-field appearance="outline">
              <mat-label>Partir de</mat-label>
              <mat-select formControlName="fromBudgetId">
                @for (version of data.versions; track version.id) {
                  <mat-option [value]="version.id">n° {{ version.number }} — {{ version.label }}</mat-option>
                }
              </mat-select>
              <mat-hint>Les lignes de cette version sont recopiées : vous ne retapez que ce qui change.</mat-hint>
            </mat-form-field>
          }
        } @else {
          @for (line of lines.controls; track line; let index = $index) {
            <div class="line" [formGroup]="line" role="group" [attr.aria-label]="'Ligne ' + (index + 1)">
              <div class="line-head">
                <strong>Ligne {{ index + 1 }}</strong>
                <button mat-button type="button" (click)="removeLine(index)" [attr.aria-label]="'Supprimer la ligne ' + (index + 1)">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">delete</mat-icon> Retirer
                </button>
              </div>
              <div class="row">
                <mat-form-field appearance="outline">
                  <mat-label>Type</mat-label>
                  <mat-select formControlName="kind" (selectionChange)="line.controls.accountId.setValue('')">
                    @for (kind of kinds; track kind.value) {
                      <mat-option [value]="kind.value">{{ kind.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" class="grow">
                  <mat-label>Poste</mat-label>
                  <input matInput formControlName="label" placeholder="Location de salle" required />
                  @if (line.controls.label.hasError('required')) {
                    <mat-error>Nommez ce poste, par exemple « Location de salle ».</mat-error>
                  }
                </mat-form-field>
              </div>
              <div class="row">
                <app-date-field label="Du" formControlName="periodStart" errorText="Indiquez le début de la période." required />
                <app-date-field label="Au" formControlName="periodEnd" errorText="Indiquez la fin de la période." required />
                <mat-form-field appearance="outline">
                  <mat-label>Montant (€)</mat-label>
                  <input matInput inputmode="decimal" formControlName="amount" placeholder="500,00" autocomplete="off" required />
                  @if (line.controls.amount.hasError('required') || line.controls.amount.hasError('amount')) {
                    <mat-error>Saisissez un montant positif, par exemple 500 ou 120,50.</mat-error>
                  }
                </mat-form-field>
              </div>
              @if (accounts().length > 0) {
                <mat-form-field appearance="outline">
                  <mat-label>Compte comptable (facultatif)</mat-label>
                  <mat-select formControlName="accountId">
                    <mat-option value="">Aucun</mat-option>
                    @for (account of accountsFor(line.controls.kind.value); track account.id) {
                      <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
                    }
                  </mat-select>
                  <mat-hint>Sert à rapprocher plus tard le prévu du réalisé. Vous pouvez laisser vide.</mat-hint>
                </mat-form-field>
              }
            </div>
          }
          @if (lines.length === 0) {
            <p class="muted">Aucune ligne pour l'instant. Ajoutez une première dépense ou recette prévue.</p>
          }
          <div>
            <button mat-stroked-button type="button" (click)="addLine('CHARGE')">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une dépense prévue
            </button>
            <button mat-stroked-button type="button" (click)="addLine('PRODUCT')">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une recette prévue
            </button>
          </div>
          <p class="totals" aria-live="polite">
            Dépenses prévues : <strong>{{ format(totals().charges) }}</strong> · Recettes prévues :
            <strong>{{ format(totals().products) }}</strong> · Résultat prévu : <strong>{{ format(totals().products - totals().charges) }}</strong>
          </p>
        }
      </app-form-dialog>
    </form>
  `,
})
export class BudgetDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<BudgetDialog, BudgetInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<BudgetDialogData>(MAT_DIALOG_DATA);

  protected readonly kinds = (Object.keys(BUDGET_KIND_LABELS) as BudgetLineKind[]).map((value) => ({ value, label: BUDGET_KIND_LABELS[value] }));
  protected readonly accounts = signal<AccountInfo[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly format = formatEuroCents;
  protected readonly budgetNumber = this.data.mode === 'edit' ? this.data.budget.number : 0;

  private readonly amountValidator = (control: { value: string }) => {
    const cents = parseAmountToCents(control.value);
    return cents === null || cents <= 0 ? { amount: true } : null;
  };

  private newLine(init?: { kind?: BudgetLineKind; label?: string; accountId?: string | null; periodStart?: string; periodEnd?: string; amount?: string }) {
    return this.fb.group({
      kind: [init?.kind ?? ('CHARGE' as BudgetLineKind)],
      label: [init?.label ?? '', [Validators.required]],
      accountId: [init?.accountId ?? ''],
      periodStart: [init?.periodStart ?? this.data.project.startDate ?? '', [Validators.required]],
      periodEnd: [init?.periodEnd ?? this.data.project.endDate ?? '', [Validators.required]],
      amount: [init?.amount ?? '', [Validators.required, this.amountValidator]],
    });
  }

  protected readonly lines = new FormArray(
    this.data.mode === 'edit'
      ? this.data.budget.lines.map((line) =>
          this.newLine({ ...line, amount: formatCents(parseAmountToCents(line.amount) ?? 0).replace(/\s/g, '') }),
        )
      : [],
  );

  protected readonly form = this.fb.group({
    label: [
      this.data.mode === 'edit'
        ? this.data.budget.label
        : `Budget prévisionnel ${new Date().getFullYear()}`,
      [Validators.required],
    ],
    fromBudgetId: [this.data.mode === 'create' ? (this.data.versions[0]?.id ?? '') : ''],
    lines: this.lines,
  });

  private readonly changes = toSignal(this.form.valueChanges.pipe(startWith(null)));

  /** Totaux en centimes entiers, recalculés à chaque frappe. */
  protected readonly totals = computed(() => {
    this.changes();
    let charges = 0;
    let products = 0;
    for (const line of this.lines.getRawValue() as { kind: BudgetLineKind; amount: string }[]) {
      const cents = parseAmountToCents(line.amount);
      if (cents === null || cents < 0) continue;
      if (line.kind === 'CHARGE') charges += cents;
      else products += cents;
    }
    return { charges, products };
  });

  constructor() {
    if (this.data.mode === 'edit') {
      // Les comptes sont facultatifs : si la liste est refusée (droit absent), la colonne reste simplement masquée.
      void this.api
        .listAccounts()
        .then((accounts) => this.accounts.set(accounts.filter((a) => a.active && /^[67]/.test(a.number))))
        .catch(() => undefined);
    }
  }

  protected accountsFor(kind: BudgetLineKind): AccountInfo[] {
    const prefix = kind === 'CHARGE' ? '6' : '7';
    return this.accounts().filter((account) => account.number.startsWith(prefix));
  }

  protected addLine(kind: BudgetLineKind): void {
    this.lines.push(this.newLine({ kind }));
    this.form.markAsDirty();
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const label = this.form.controls.label.value.trim();
      const saved =
        this.data.mode === 'create'
          ? await this.api.createBudget(this.data.project.id, {
              label,
              ...(this.form.controls.fromBudgetId.value && { fromBudgetId: this.form.controls.fromBudgetId.value }),
            })
          : await this.api.updateBudget(this.data.budget.id, {
              label,
              lines: (this.lines.getRawValue() as Record<string, string>[]).map((line) => ({
                kind: line['kind'] as BudgetLineKind,
                label: line['label']!.trim(),
                accountId: line['accountId'] || null,
                periodStart: line['periodStart']!,
                periodEnd: line['periodEnd']!,
                amount: centsToApi(parseAmountToCents(line['amount']) ?? 0),
              })),
            });
      this.reference.close(saved);
    } catch (failure) {
      const described = describeHttpError(failure, "Le budget n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
