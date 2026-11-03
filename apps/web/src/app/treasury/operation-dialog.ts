import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FinancialAccountInfo, type GuidedOperationResult, type OperationCategoryInfo, type ProjectInfo } from '../admin/admin-api.service';
import { centsToApi, formatCents, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { CategoryField, evaluateSplit, type SplitRow } from './category-field';
import { DateField } from '../ui/date-field';

export interface OperationDialogData {
  direction: 'IN' | 'OUT';
  /** Comptes actifs sur lesquels on peut enregistrer. */
  accounts: FinancialAccountInfo[];
  categories: OperationCategoryInfo[];
  projects: ProjectInfo[];
  /** Compte proposé d'office (celui qui est ouvert), s'il y en a un. */
  accountId: string | null;
  /** L'utilisateur peut-il comptabiliser tout de suite ? Sinon l'opération reste un brouillon à relire. */
  canPost: boolean;
}

/**
 * « J'ai reçu de l'argent » / « J'ai dépensé de l'argent » (ADR 0028) : un seul formulaire en langage courant. Le logiciel
 * en tire la transaction et l'écriture à partie double ; l'aperçu montre ce que verra l'expert-comptable.
 */
@Component({
  selector: 'app-operation-dialog',
  imports: [CategoryField, DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="incoming ? 'J’ai reçu de l’argent' : 'J’ai dépensé de l’argent'"
        [description]="
          incoming
            ? 'Cotisation, don, subvention, vente… Indiquez sur quel compte l’argent est arrivé, combien et pourquoi : le logiciel s’occupe de la comptabilité.'
            : 'Achat, loyer, assurance… Indiquez de quel compte l’argent est sorti, combien et pourquoi : le logiciel s’occupe de la comptabilité.'
        "
        [submitLabel]="data.canPost ? 'Enregistrer l’opération' : 'Enregistrer en brouillon'"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>{{ incoming ? 'Sur quel compte l’argent est-il arrivé ?' : 'De quel compte l’argent est-il sorti ?' }}</mat-label>
            <mat-select formControlName="accountId" required>
              @for (account of data.accounts; track account.id) {
                <mat-option [value]="account.id">{{ account.name }}</mat-option>
              }
            </mat-select>
            @if (form.controls.accountId.hasError('required')) {
              <mat-error>Choisissez le compte concerné.</mat-error>
            }
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Montant (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" placeholder="25,00" autocomplete="off" required />
            <mat-hint>Toujours positif : le sens est déjà choisi.</mat-hint>
            @if (form.controls.amount.touched && amountCents() === null) {
              <mat-error>Écrivez un montant avec des chiffres, par exemple 25,00.</mat-error>
            }
          </mat-form-field>
          <app-date-field label="Date" formControlName="date" required />
        </div>
        <app-category-field
          [label]="incoming ? 'D’où vient cet argent ?' : 'À quoi a servi cet argent ?'"
          [hint]="selectedCategory()?.hint ?? ''"
          [incoming]="incoming"
          [choices]="choices"
          [control]="form.controls.categoryId"
          [totalCents]="amountCents()"
          [(splits)]="splits"
        />
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <input matInput formControlName="label" [placeholder]="incoming ? 'Cotisation de Marie Dupont' : 'Facture de l’assureur'" autocomplete="off" required />
          <mat-hint>Ce qui vous permettra de retrouver l’opération plus tard.</mat-hint>
          @if (form.controls.label.hasError('required')) {
            <mat-error>Décrivez l’opération en quelques mots.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>{{ incoming ? 'Reçu dans le cadre de quelle activité ? (facultatif)' : 'Pour quelle activité ? (facultatif)' }}</mat-label>
          <mat-select formControlName="projectId">
            <mat-option [value]="null">Aucune activité en particulier</mat-option>
            @for (project of projects; track project.id) {
              <mat-option [value]="project.id">{{ project.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>
            {{
              incoming
                ? 'Si cet argent a été reçu pendant ou à l’occasion d’une activité (festival, atelier…), choisissez-la. Sinon, laissez vide : il sera rattaché au fonctionnement général.'
                : 'Si cette dépense concerne une activité (festival, atelier…), choisissez-la pour savoir ce qu’elle coûte. Sinon, laissez vide : elle sera rattachée au fonctionnement général.'
            }}
          </mat-hint>
        </mat-form-field>

        @if (preview(); as lines) {
          <section class="preview" aria-label="Ce que verra l’expert-comptable">
            <strong>Ce que verra l’expert-comptable</strong>
            <p class="muted">
              Chaque opération est notée deux fois dans les comptes, c’est ce qu’on appelle la « partie double » : une fois où l’argent est
              passé, une fois pour dire pourquoi. Vous n’avez rien à saisir de plus.
            </p>
            <table>
              <thead>
                <tr><th scope="col">Compte</th><th scope="col" class="amount">Débit</th><th scope="col" class="amount">Crédit</th></tr>
              </thead>
              <tbody>
                @for (line of lines; track line.account) {
                  <tr>
                    <td>{{ line.account }}</td>
                    <td class="amount">{{ line.debit }}</td>
                    <td class="amount">{{ line.credit }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="muted">
              @if (data.canPost) {
                L’opération sera enregistrée définitivement. Si vous vous trompez, vous pourrez l’annuler : une opération inverse est alors
                ajoutée, l’historique reste lisible.
              } @else {
                Vous n’avez pas le droit d’enregistrer définitivement : l’opération sera mise en brouillon pour qu’une personne habilitée la relise.
              }
            </p>
          </section>
        }
      </app-form-dialog>
    </form>
  `,
  styles: `
    .preview {
      background: var(--app-surface-variant, var(--mat-sys-surface-container));
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 16px;
    }
    .preview p {
      margin: 0;
    }
    .preview table {
      border-collapse: collapse;
      width: 100%;
    }
    .preview th,
    .preview td {
      padding: 4px 6px;
      text-align: left;
    }
    .preview .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `,
})
export class OperationDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<OperationDialog, GuidedOperationResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<OperationDialogData>(MAT_DIALOG_DATA);

  protected readonly incoming = this.data.direction === 'IN';
  protected readonly choices = this.data.categories.filter((c) => c.direction === this.data.direction && c.active);
  protected readonly projects = this.data.projects.filter((p) => p.status !== 'ARCHIVED');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    accountId: [this.data.accountId ?? (this.data.accounts.length === 1 ? this.data.accounts[0]!.id : ''), [Validators.required]],
    amount: [''],
    date: [new Date().toISOString().slice(0, 10)],
    categoryId: ['', [Validators.required]],
    label: ['', [Validators.required]],
    projectId: this.fb.control<string | null>(null),
  });
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly amountCents = computed(() => parseAmountToCents(this.values().amount));
  protected readonly selectedCategory = computed(() => this.choices.find((c) => c.id === this.values().categoryId));

  /** Répartition en cours (« Fractionner »), ou `null` pour une seule catégorie. */
  protected readonly splits = signal<SplitRow[] | null>(null);

  /** Aperçu des lignes d'écriture : la banque, puis une ligne par catégorie (une seule, ou une par part répartie). */
  protected readonly preview = computed(() => {
    const account = this.data.accounts.find((a) => a.id === this.values().accountId);
    const cents = this.amountCents();
    if (!account || cents === null || cents <= 0) return null;
    const amount = formatCents(cents);
    const bank = { account: `${account.accountNumber} · ${account.name}`, debit: this.incoming ? amount : '', credit: this.incoming ? '' : amount };
    const line = (category: { account: { number: string; label: string } }, value: string) => ({
      account: `${category.account.number} · ${category.account.label}`,
      debit: this.incoming ? '' : value,
      credit: this.incoming ? value : '',
    });
    const rows = this.splits();
    if (rows) {
      const parts = rows
        .map((row) => ({ category: this.choices.find((c) => c.id === row.categoryId), cents: parseAmountToCents(row.amount) }))
        .filter((part): part is { category: OperationCategoryInfo; cents: number } => !!part.category && part.cents !== null && part.cents > 0);
      return parts.length > 0 ? [bank, ...parts.map((part) => line(part.category, formatCents(part.cents)))] : null;
    }
    const category = this.selectedCategory();
    return category ? [bank, line(category, amount)] : null;
  });

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    this.form.markAllAsTouched();
    if (this.form.invalid || cents === null || cents <= 0 || !raw.date) {
      this.error.set('Vérifiez les champs signalés : le compte, un montant supérieur à zéro (par exemple 25,00), la date, la catégorie et une description sont nécessaires.');
      this.details.set([]);
      return;
    }
    const rows = this.splits();
    const state = rows ? evaluateSplit(rows, cents) : null;
    if (state && !state.valid) {
      this.error.set(
        state.remaining !== 0
          ? 'Le total des parts doit être égal au montant de l’opération. Complétez ou corrigez les montants, puis enregistrez de nouveau.'
          : 'Chaque part a besoin d’une catégorie différente et d’un montant supérieur à zéro. Corrigez les lignes, puis enregistrez de nouveau.',
      );
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.recordOperation({
          financialAccountId: raw.accountId,
          direction: this.data.direction,
          amount: centsToApi(cents),
          date: raw.date,
          label: raw.label.trim(),
          ...(state ? { splits: state.parts } : { categoryId: raw.categoryId }),
          ...(raw.projectId && { projectId: raw.projectId }),
          post: this.data.canPost,
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "L'opération n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
