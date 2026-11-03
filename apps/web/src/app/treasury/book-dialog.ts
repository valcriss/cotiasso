import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FinancialAccountInfo, type GuidedOperationResult, type OperationCategoryInfo, type ProjectInfo, type TransactionInfo } from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { FrDatePipe } from '../ui/fr-date.pipe';

export interface BookDialogData {
  transaction: TransactionInfo;
  account: FinancialAccountInfo;
  categories: OperationCategoryInfo[];
  projects: ProjectInfo[];
  canPost: boolean;
}

/**
 * « Classer et enregistrer » un mouvement qui existe déjà (importé du relevé ou saisi) : on choisit la catégorie, le
 * logiciel prépare et enregistre l'écriture à partie double (ADR 0028). Renvoie le résultat de l'enregistrement.
 */
@Component({
  selector: 'app-book-dialog',
  imports: [FrDatePipe, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Classer et enregistrer ce mouvement"
        [description]="incoming ? 'De l’argent est arrivé sur le compte. Dites d’où il vient : le logiciel s’occupe de la comptabilité.' : 'De l’argent est sorti du compte. Dites à quoi il a servi : le logiciel s’occupe de la comptabilité.'"
        [submitLabel]="data.canPost ? 'Classer et enregistrer' : 'Classer en brouillon'"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <p class="summary">
          <strong>{{ data.transaction.label }}</strong><br />
          <span class="muted">{{ data.transaction.operationDate | frDate }} · {{ amount(data.transaction.amount) }} € · {{ data.account.name }}</span>
        </p>
        <mat-form-field appearance="outline">
          <mat-label>{{ incoming ? 'D’où vient cet argent ?' : 'À quoi a servi cet argent ?' }}</mat-label>
          <mat-select formControlName="categoryId" required>
            @for (category of choices; track category.id) {
              <mat-option [value]="category.id">{{ category.label }}</mat-option>
            }
          </mat-select>
          <mat-hint>{{ selected()?.hint || 'Choisissez la catégorie qui ressemble le plus à ce mouvement.' }}</mat-hint>
          @if (form.controls.categoryId.hasError('required')) {
            <mat-error>Choisissez une catégorie.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Pour quel projet ? (facultatif)</mat-label>
          <mat-select formControlName="projectId">
            <mat-option value="">Fonctionnement général (par défaut)</mat-option>
            @for (project of data.projects; track project.id) {
              <mat-option [value]="project.id">{{ project.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (selected(); as category) {
          <p class="muted">
            Ce que verra l’expert-comptable : {{ incoming ? 'le compte ' + data.account.accountNumber + ' est débité et le compte ' + category.account.number + ' (' + category.account.label + ') crédité' : 'le compte ' + category.account.number + ' (' + category.account.label + ') est débité et le compte ' + data.account.accountNumber + ' crédité' }}.
            {{ data.canPost ? 'L’opération est enregistrée définitivement ; vous pourrez toujours l’annuler.' : 'Elle sera mise en brouillon pour qu’une personne habilitée la relise.' }}
          </p>
        }
      </app-form-dialog>
    </form>
  `,
})
export class BookDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<BookDialog, GuidedOperationResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<BookDialogData>(MAT_DIALOG_DATA);
  protected readonly amount = formatApiAmount;

  protected readonly incoming = !this.data.transaction.amount.startsWith('-');
  protected readonly choices = this.data.categories.filter((c) => c.active && c.direction === (this.incoming ? 'IN' : 'OUT'));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    categoryId: [this.choices.find((c) => c.account.id === this.data.transaction.counterpartAccountId)?.id ?? '', [Validators.required]],
    projectId: [this.data.transaction.projectId ?? ''],
  });
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly selected = computed(() => this.choices.find((c) => c.id === this.values().categoryId));

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Choisissez une catégorie pour ce mouvement, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const raw = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.bookTransaction(this.data.transaction.id, { categoryId: raw.categoryId, ...(raw.projectId && { projectId: raw.projectId }), post: this.data.canPost }));
    } catch (failure) {
      const described = describeHttpError(failure, "Le mouvement n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
