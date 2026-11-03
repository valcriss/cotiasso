import { Component, computed, effect, input, model, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { CategorySplitBody, OperationCategoryInfo } from '../admin/admin-api.service';
import { formatEuroCents, centsToApi, formatCents, parseAmountToCents } from '../accounting/amount';

/** Une ligne de la répartition : la catégorie, le montant tel qu'écrit, et si la personne l'a saisi (sinon il se calcule). */
export interface SplitRow {
  categoryId: string;
  amount: string;
  manual: boolean;
}

export interface SplitState {
  /** Parts prêtes à envoyer à l'API. */
  parts: CategorySplitBody[];
  /** Total déjà réparti, en centimes. */
  assigned: number;
  /** Ce qu'il reste à répartir (négatif : trop réparti), en centimes. */
  remaining: number;
  /** Vrai si les parts sont complètes : au moins deux, chacune avec sa catégorie et un montant, total exact. */
  valid: boolean;
}

export const MAX_SPLIT_ROWS = 10;

/** Montant d'une ligne en centimes ; `null` si le texte n'est pas un montant. Une zone vide vaut zéro. */
const cents = (row: SplitRow): number | null => parseAmountToCents(row.amount);

/** Évalue une répartition par rapport au montant à répartir (en centimes entiers, jamais en flottant). */
export function evaluateSplit(rows: SplitRow[], total: number | null): SplitState {
  const amounts = rows.map(cents);
  const assigned = amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const remaining = (total ?? 0) - assigned;
  const complete = rows.length >= 2 && rows.every((row, index) => row.categoryId !== '' && amounts[index] !== null && amounts[index]! > 0);
  const distinct = new Set(rows.map((row) => row.categoryId)).size === rows.length;
  return {
    parts: complete ? rows.map((row, index) => ({ categoryId: row.categoryId, amount: centsToApi(amounts[index]!) })) : [],
    assigned,
    remaining,
    valid: complete && distinct && total !== null && total > 0 && remaining === 0,
  };
}

/** La dernière ligne qui n'a pas été saisie reprend ce qui reste à répartir : la personne n'a pas à faire la soustraction. */
function withAutoRemainder(rows: SplitRow[], total: number | null): SplitRow[] {
  const last = rows.length - 1;
  if (last < 1 || rows[last]!.manual || total === null) return rows;
  const others = rows.slice(0, last).reduce((sum, row) => sum + (cents(row) ?? 0), 0);
  const rest = total - others;
  const amount = rest > 0 ? formatCents(rest) : '';
  return rows[last]!.amount === amount ? rows : rows.map((row, index) => (index === last ? { ...row, amount } : row));
}

/**
 * Choix de la catégorie d'un mouvement : une liste déroulante, ou — avec « Fractionner » — plusieurs catégories qui se
 * partagent le montant (ex. 10 € de cotisations et 10 € de dons). Une répartition n'est valide que si tout le montant est
 * réparti. La liste déroulante reste portée par le contrôle du formulaire parent ; la répartition est le modèle `splits`
 * (vide = une seule catégorie).
 */
@Component({
  selector: 'app-category-field',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styles: `
    :host {
      display: block;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .row {
      align-items: flex-start;
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(0, 3fr) minmax(110px, 1fr) auto;
    }
    .row .remove {
      margin-top: 4px;
    }
    .toolbar {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      justify-content: space-between;
      margin-top: 4px;
    }
    .rest {
      align-items: center;
      display: inline-flex;
      font: var(--mat-sys-label-large);
      gap: 6px;
    }
    .rest mat-icon {
      font-size: 20px;
      height: 20px;
      width: 20px;
    }
    .rest.ok {
      color: var(--app-success);
    }
    .rest.warn {
      color: var(--app-warning);
    }
    .rest.bad {
      color: var(--mat-sys-error);
    }
    /* Liste sur toute la largeur, puis le lien « Fractionner » en dessous (jamais à côté de la liste). */
    .single {
      align-items: flex-start;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .single mat-form-field {
      align-self: stretch;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
  `,
  template: `
    @if (splits(); as rows) {
      <div class="rows" role="group" [attr.aria-label]="label()">
        @for (row of rows; track $index; let index = $index) {
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>{{ incoming() ? 'D’où vient cette part ?' : 'À quoi sert cette part ?' }}</mat-label>
              <mat-select [value]="row.categoryId" [aria-label]="'Catégorie de la part ' + (index + 1)" (selectionChange)="setCategory(index, $event.value)">
                @for (category of available(index); track category.id) {
                  <mat-option [value]="category.id">{{ category.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Montant (€)</mat-label>
              <input
                matInput
                inputmode="decimal"
                autocomplete="off"
                placeholder="0,00"
                [value]="row.amount"
                [attr.aria-label]="'Montant de la part ' + (index + 1)"
                (input)="setAmount(index, $any($event.target).value)"
              />
            </mat-form-field>
            @if (rows.length > 2) {
              <button mat-icon-button class="remove" type="button" [attr.aria-label]="'Retirer la part ' + (index + 1)" (click)="removeRow(index)">
                <mat-icon fontSet="material-icons-outlined">delete</mat-icon>
              </button>
            } @else {
              <span></span>
            }
          </div>
        }
      </div>
      <div class="toolbar">
        <span class="rest num" [class.ok]="state().valid" [class.warn]="state().remaining > 0" [class.bad]="state().remaining < 0" role="status">
          @if (!(totalCents() !== null && totalCents()! > 0)) {
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">info</mat-icon> Indiquez d’abord le montant à répartir.
          } @else if (state().remaining === 0) {
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">check_circle</mat-icon> Tout le montant ({{ format(totalCents()!) }}) est réparti.
          } @else if (state().remaining > 0) {
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">error_outline</mat-icon> Reste à répartir : {{ format(state().remaining) }} sur {{ format(totalCents()!) }}
          } @else {
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">error_outline</mat-icon> Trop réparti de {{ format(-state().remaining) }} : le total ne doit pas dépasser {{ format(totalCents()!) }}
          }
        </span>
        <span>
          @if (rows.length < maxRows && rows.length < choices().length) {
            <button mat-button type="button" (click)="addRow()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une catégorie
            </button>
          }
          <button mat-button type="button" (click)="cancelSplit()">Une seule catégorie</button>
        </span>
      </div>
    } @else {
      <div class="single">
      <mat-form-field appearance="outline">
        <mat-label>{{ label() }}</mat-label>
        <mat-select [formControl]="control()" [attr.formcontrolname]="name()" required>
          @for (category of choices(); track category.id) {
            <mat-option [value]="category.id">{{ category.label }}</mat-option>
          }
        </mat-select>
        <mat-hint>{{ hint() || 'Choisissez la catégorie qui ressemble le plus à cette opération.' }}</mat-hint>
        @if (control().hasError('required')) {
          <mat-error>Choisissez une catégorie.</mat-error>
        }
      </mat-form-field>
      @if (choices().length >= 2) {
        <button mat-button type="button" [disabled]="!(totalCents() !== null && totalCents()! > 0)" (click)="startSplit()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">call_split</mat-icon> Fractionner entre plusieurs catégories
        </button>
        @if (!(totalCents() !== null && totalCents()! > 0)) {
          <span class="muted">Indiquez d’abord le montant pour pouvoir le fractionner.</span>
        }
      }
      </div>
    }
  `,
})
export class CategoryField {
  /** Libellé de la liste déroulante (« D'où vient cet argent ? »). */
  readonly label = input.required<string>();
  readonly hint = input<string>('');
  readonly incoming = input.required<boolean>();
  readonly choices = input.required<OperationCategoryInfo[]>();
  /** Contrôle du formulaire parent qui porte la catégorie unique (désactivé pendant une répartition). */
  readonly control = input.required<FormControl<string>>();
  /** Nom du contrôle, recopié sur la liste pour que les tests et les lecteurs d'écran le retrouvent. */
  readonly name = input<string>('categoryId');
  /** Montant à répartir, en centimes (valeur absolue) ; `null` ou zéro tant qu'il n'est pas connu. */
  readonly totalCents = input<number | null>(null);
  /** Répartition en cours ; `null` = une seule catégorie. */
  readonly splits = model<SplitRow[] | null>(null);

  protected readonly maxRows = MAX_SPLIT_ROWS;
  protected readonly format = formatEuroCents;
  protected readonly state = computed(() => evaluateSplit(this.splits() ?? [], this.totalCents()));

  constructor() {
    // Le montant peut changer pendant la répartition : la dernière ligne non saisie reprend le reste.
    effect(() => {
      const total = this.totalCents();
      const rows = untracked(() => this.splits());
      if (rows) this.splits.set(withAutoRemainder(rows, total));
    });
  }

  /** Catégories encore libres pour cette ligne : une catégorie ne sert qu'une fois dans une répartition. */
  protected available(index: number): OperationCategoryInfo[] {
    const used = new Set((this.splits() ?? []).filter((_, i) => i !== index).map((row) => row.categoryId));
    return this.choices().filter((category) => !used.has(category.id));
  }

  protected startSplit(): void {
    const total = this.totalCents();
    if (total === null || total <= 0) return;
    const current = this.control().value;
    this.control().disable({ emitEvent: false });
    this.splits.set(withAutoRemainder([{ categoryId: current, amount: formatCents(total), manual: true }, { categoryId: '', amount: '', manual: false }], total));
  }

  protected cancelSplit(): void {
    const first = this.splits()?.[0]?.categoryId;
    this.control().enable({ emitEvent: false });
    if (first && !this.control().value) this.control().setValue(first);
    this.splits.set(null);
  }

  protected setCategory(index: number, categoryId: string): void {
    this.update((rows) => rows.map((row, i) => (i === index ? { ...row, categoryId } : row)));
  }

  protected setAmount(index: number, amount: string): void {
    this.update((rows) => rows.map((row, i) => (i === index ? { ...row, amount, manual: true } : row)));
  }

  protected addRow(): void {
    // La ligne qui était la dernière garde son montant ; la nouvelle reprend le reste.
    this.update((rows) => [...rows.map((row, i) => (i === rows.length - 1 ? { ...row, manual: true } : row)), { categoryId: '', amount: '', manual: false }]);
  }

  protected removeRow(index: number): void {
    this.update((rows) => {
      const next = rows.filter((_, i) => i !== index);
      return next.map((row, i) => (i === next.length - 1 ? { ...row, manual: false } : row));
    });
  }

  private update(change: (rows: SplitRow[]) => SplitRow[]): void {
    const rows = this.splits();
    if (rows) this.splits.set(withAutoRemainder(change(rows), this.totalCents()));
  }
}
