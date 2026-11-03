import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type CategoryChoiceBody, type FinancialAccountInfo, type GuidedOperationResult, type OperationCategoryInfo, type ProjectInfo, type TransactionInfo } from '../admin/admin-api.service';
import { formatEuroAmount, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { CategoryField, evaluateSplit, type SplitRow } from './category-field';

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
  imports: [CategoryField, FrDatePipe, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Classer et enregistrer ce mouvement"
        [description]="incoming ? 'De l’argent est arrivé sur le compte. Dites d’où il vient : le logiciel s’occupe de la comptabilité.' : 'De l’argent est sorti du compte. Dites à quoi il a servi : le logiciel s’occupe de la comptabilité.'"
        [submitLabel]="data.canPost ? 'Classer et enregistrer' : 'Classer et envoyer pour validation'"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <p class="summary">
          <strong>{{ data.transaction.label }}</strong><br />
          <span class="muted">{{ data.transaction.operationDate | frDate }} · {{ amount(data.transaction.amount) }} · {{ data.account.name }}</span>
        </p>
        <app-category-field
          [label]="incoming ? 'D’où vient cet argent ?' : 'À quoi a servi cet argent ?'"
          [hint]="selected()?.hint ?? ''"
          [incoming]="incoming"
          [choices]="choices"
          [control]="form.controls.categoryId"
          [totalCents]="totalCents"
          [(splits)]="splits"
        />
        <mat-form-field appearance="outline">
          <mat-label>{{ incoming ? 'Reçu dans le cadre de quel projet ? (facultatif)' : 'Pour quel projet ? (facultatif)' }}</mat-label>
          <mat-select formControlName="projectId">
            <mat-option [value]="null">Aucun projet en particulier</mat-option>
            @for (project of data.projects; track project.id) {
              <mat-option [value]="project.id">{{ project.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>
            {{
              incoming
                ? 'Si cet argent a été reçu pendant ou à l’occasion d’un projet (festival, atelier…), choisissez-le. Sinon, laissez vide : il sera rattaché au projet « Fonctionnement ».'
                : 'Si cette dépense concerne un projet (festival, atelier…), choisissez-le pour savoir ce qu’il coûte. Sinon, laissez vide : elle sera rattachée au projet « Fonctionnement ».'
            }}
          </mat-hint>
        </mat-form-field>
        @if (splits()) {
          <p class="muted">
            Ce que verra l’expert-comptable : une seule écriture. Le compte {{ data.account.accountNumber }} est {{ incoming ? 'débité' : 'crédité' }} du total, et
            chaque catégorie reçoit sa part : {{ splitSummary() }}.
            {{ data.canPost ? 'L’opération est enregistrée définitivement ; vous pourrez toujours l’annuler.' : 'Elle sera mise en brouillon pour qu’une personne habilitée la relise.' }}
          </p>
        } @else if (selected(); as category) {
          <p class="muted">
            Ce que verra l’expert-comptable : {{ incoming ? 'le compte ' + data.account.accountNumber + ' est débité et le compte ' + category.account.number + ' (' + category.account.label + ') crédité' : 'le compte ' + category.account.number + ' (' + category.account.label + ') est débité et le compte ' + data.account.accountNumber + ' crédité' }}.
            {{ data.canPost ? 'L’opération est enregistrée définitivement ; vous pourrez toujours l’annuler.' : 'Elle sera envoyée pour validation, en brouillon : une personne autorisée la relira puis l’enregistrera ; rien n’est compté dans les rapports avant.' }}
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
  protected readonly amount = formatEuroAmount;

  protected readonly incoming = !this.data.transaction.amount.startsWith('-');
  protected readonly choices = this.data.categories.filter((c) => c.active && c.direction === (this.incoming ? 'IN' : 'OUT'));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    categoryId: [this.choices.find((c) => c.account.id === this.data.transaction.counterpartAccountId)?.id ?? '', [Validators.required]],
    projectId: this.fb.control<string | null>(this.data.transaction.projectId ?? null),
  });
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly selected = computed(() => this.choices.find((c) => c.id === this.values().categoryId));
  /** Répartition en cours (« Fractionner »), ou `null` pour une seule catégorie. */
  protected readonly splits = signal<SplitRow[] | null>(null);
  /** Montant du mouvement à répartir, en centimes (toujours positif : le sens est celui du mouvement). */
  protected readonly totalCents = parseAmountToCents(this.data.transaction.amount.replace(/^-/, ''));
  protected readonly splitSummary = computed(() =>
    (this.splits() ?? [])
      .filter((row) => row.categoryId)
      .map((row) => {
        const category = this.choices.find((c) => c.id === row.categoryId);
        return `${category?.label ?? '?'} (compte ${category?.account.number ?? '?'}) ${formatEuroAmount(row.amount || '0,00')}`;
      })
      .join(', '),
  );

  protected async save(): Promise<void> {
    const rows = this.splits();
    if (rows) {
      const state = evaluateSplit(rows, this.totalCents);
      if (!state.valid) {
        this.error.set(
          state.remaining !== 0
            ? 'Le total des parts doit être égal au montant du mouvement. Complétez ou corrigez les montants, puis enregistrez de nouveau.'
            : 'Chaque part a besoin d’une catégorie différente et d’un montant supérieur à zéro. Corrigez les lignes, puis enregistrez de nouveau.',
        );
        this.details.set([]);
        return;
      }
      await this.send({ splits: state.parts });
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Choisissez une catégorie pour ce mouvement, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    await this.send({ categoryId: this.form.getRawValue().categoryId });
  }

  private async send(choice: CategoryChoiceBody): Promise<void> {
    const projectId = this.form.getRawValue().projectId;
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.bookTransaction(this.data.transaction.id, { ...choice, ...(projectId && { projectId }), post: this.data.canPost }));
    } catch (failure) {
      const described = describeHttpError(failure, "Le mouvement n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
