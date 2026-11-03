import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { centsToApi, formatEuroAmount, formatEuroCents, parseAmountToCents } from '../accounting/amount';
import { defaultYear } from '../accounting/report-filters';
import { AdminApiService, type FiscalYearInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { PageHeader } from '../ui/page-header';

interface BudgetRow {
  code: string;
  label: string;
  amount: string;
}

interface BudgetState {
  groups: { direction: 'IN' | 'OUT'; rows: BudgetRow[] }[];
  estimates: Record<string, string>;
  history: { id: string; date: string; actor: string; code: string; label: string; previous: string; amount: string }[];
}

@Component({
  selector: 'app-budget-page',
  imports: [FormsModule, FrDatePipe, DatePipe, MatFormFieldModule, MatInputModule, MatSelectModule, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .budget-table { overflow-x: auto; margin-bottom: 20px; }
    .exercise-selector { margin-bottom: 20px; }
    table { width: 100%; min-width: 44rem; table-layout: fixed; border-collapse: collapse; }
    .history-table { table-layout: auto; }
    .history-table :is(th, td):nth-child(-n+3) { text-align: left; }
    .amount-column { width: 12rem; }
    .positive { color: light-dark(#176b36, #80d99d); }
    .negative { color: var(--mat-sys-error); }
    th, td { padding: 8px 12px; border-bottom: 1px solid var(--app-border); text-align: right; }
    tbody th { font-weight: 400; }
    tfoot th { font-weight: 700; }
    tfoot tr {
      background-color: var(--mat-sys-surface-container-low);
      border-top: 2px solid var(--app-border);
    }
    tbody tr:hover {
      background-color: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent);
    }
    th:first-child { text-align: left; }
    input { width: 8rem; padding: 6px; text-align: right; border: 1px solid var(--mat-sys-outline); border-radius: 4px; }
  `,
  template: `
    <app-page-header title="Budget" icon="pie_chart"
      description="Prévoyez les recettes et les dépenses de l’association et comparez-les aux montants inscrits dans les comptes." />
    @if (error()) {
      <p class="error-banner" role="alert">{{ error() }}</p>
    }
    @if (years().length) {
      <mat-form-field class="exercise-selector" appearance="outline">
        <mat-label>Exercice comptable</mat-label>
        <mat-select [value]="year()?.id" [disabled]="loading()" (selectionChange)="select($event.value)">
          @for (item of years(); track item.id) {
            <mat-option [value]="item.id">{{ item.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    }
    @if (loading()) {
      <p role="status">Chargement du budget…</p>
    } @else if (year(); as period) {
      @if (budgetGroups()) {
        <section class="panel">
          <h2>Du {{ period.start | frDate }} au {{ period.end | frDate }}</h2>
          <p>Retrouvez les catégories de vos recettes et dépenses. Chaque estimation est enregistrée quand vous quittez son champ.</p>
          @if (hasSharedAmounts()) {
            <p class="muted">Quand plusieurs catégories utilisent le même compte, leur montant réel est affiché sur une ligne commune.</p>
          }
          @if (hasPreviousCategories()) {
            <p role="status">Certaines estimations ont été saisies dans d’anciennes catégories. Retrouvez-les dans l’historique et reportez-les dans les rubriques actuelles pour les inclure dans les totaux.</p>
          }
          <div>
            <p>Saisissez les estimations en positif. Les dépenses réelles sont affichées en négatif. Un écart négatif indique des recettes inférieures aux prévisions ou des dépenses supérieures au budget.</p>
            @for (group of groups(); track group.title) {
              <h3>{{ group.title }}</h3>
              <div class="budget-table">
                <table>
                  <colgroup>
                    <col />
                    <col class="amount-column" span="3" />
                  </colgroup>
                  <thead><tr>
                    <th scope="col">Catégorie</th>
                    <th scope="col">Montant estimé (€)</th>
                    <th scope="col">Montant réel</th>
                    <th scope="col">Différence</th>
                  </tr></thead>
                  <tbody>
                    @for (row of group.rows; track row.code) {
                      <tr>
                        <th scope="row">{{ row.label }}</th>
                        <td><input matInput inputmode="decimal" [attr.aria-label]="'Montant estimé en euros · ' + row.label"
                          [name]="row.code" [ngModel]="estimates()[row.code] ?? ''"
                          (ngModelChange)="updateEstimate(row.code, $event)" [readonly]="!canEdit()" (blur)="save(row)" placeholder="0,00" /></td>
                        <td>{{ formatAmount(group.direction === -1 ? reverseSign(row.amount) : row.amount) }}</td>
                        <td>
                          @let gap = difference(row.amount, estimates()[row.code], group.direction);
                          @if (gap !== null) {
                            <span [class.positive]="gap > 0" [class.negative]="gap < 0">{{ gap > 0 ? "+" : "" }}{{ formatEuroCents(gap) }}</span>
                          } @else { — }
                        </td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    @let total = totals(group.rows, group.direction);
                    <tr>
                      <th scope="row">{{ group.direction === 1 ? 'Total des recettes' : 'Total des dépenses' }}</th>
                      <td>{{ total.estimated === null ? '—' : formatEuroCents(total.estimated) }}</td>
                      <td>{{ formatEuroCents(total.actual) }}</td>
                      <td>
                        @if (total.gap !== null) {
                          <span [class.positive]="total.gap > 0" [class.negative]="total.gap < 0">{{ total.gap > 0 ? "+" : "" }}{{ formatEuroCents(total.gap) }}</span>
                        } @else { — }
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            }
            @let result = exerciseResult();
            <div class="budget-table">
              <table>
                <colgroup>
                  <col />
                  <col class="amount-column" span="3" />
                </colgroup>
                <thead><tr>
                  <th scope="col">Synthèse</th>
                  <th scope="col">Montant estimé</th>
                  <th scope="col">Montant réel</th>
                  <th scope="col">Différence</th>
                </tr></thead>
                <tfoot><tr>
                  <th scope="row">Résultat de l’exercice (recettes moins dépenses)</th>
                  <td>{{ result.estimated === null ? '—' : formatEuroCents(result.estimated) }}</td>
                  <td>{{ formatEuroCents(result.actual) }}</td>
                  <td>
                    @if (result.gap !== null) {
                      <span [class.positive]="result.gap > 0" [class.negative]="result.gap < 0">{{ result.gap > 0 ? "+" : "" }}{{ formatEuroCents(result.gap) }}</span>
                    } @else { — }
                  </td>
                </tr></tfoot>
              </table>
            </div>

            <p role="status">{{ feedback() }}</p>
            <details>
              <summary>Historique des modifications</summary>
              @if (history().length) {
                <div class="budget-table">
                  <table class="history-table">
                    <thead><tr>
                      <th scope="col">Date et heure</th>
                      <th scope="col">Modifié par</th>
                      <th scope="col">Catégorie</th>
                      <th scope="col">Avant</th>
                      <th scope="col">Après</th>
                    </tr></thead>
                    <tbody>
                      @for (change of history(); track change.id) {
                        <tr>
                          <td>{{ change.date | date:"dd/MM/yyyy 'à' HH:mm" }}</td>
                          <td>{{ change.actor }}</td>
                          <td>{{ historyCategory(change.label, change.code) }}</td>
                          <td>{{ formatAmount(change.previous) }}</td>
                          <td>{{ formatAmount(change.amount) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <p>Aucune estimation modifiée pour cet exercice.</p>
              }
            </details>
          </div>
        </section>
      }
    } @else if (!error()) {
      <p class="panel">Pour préparer un budget, créez d’abord un exercice dans Paramètres › Comptabilité.</p>
    }
  `,
})
export class BudgetPage {
  private readonly http = inject(HttpClient);
  private pending = Promise.resolve();
  private saved: Record<string, string> = {};
  readonly history = signal<BudgetState['history']>([]);
  readonly canEdit = computed(() => this.auth.can('entries:create'));
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  readonly years = signal<FiscalYearInfo[]>([]);
  readonly year = signal<FiscalYearInfo | undefined>(undefined);
  readonly budgetGroups = signal<BudgetState['groups'] | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly feedback = signal('');
  readonly estimates = signal<Record<string, string>>({});
  readonly formatAmount = formatEuroAmount;
  readonly groups = computed(() => {
    const groups = this.budgetGroups() ?? [];
    return [
      { title: 'Recettes', direction: 1, rows: groups.find((group) => group.direction === 'IN')?.rows ?? [] },
      { title: 'Dépenses', direction: -1, rows: groups.find((group) => group.direction === 'OUT')?.rows ?? [] },
    ];
  });

  readonly hasSharedAmounts = computed(() =>
    this.groups().some(({ rows }) => rows.some(({ label }) => label.startsWith('Montant commun · '))),
  );

  readonly hasPreviousCategories = computed(() => {
    const codes = new Set(this.groups().flatMap((group) => group.rows.map((row) => row.code)));
    return this.history().some(({ code }) => !codes.has(code) && this.estimates()[code] !== '0.00');
  });

  updateEstimate(code: string, value: string): void {
    this.estimates.update((estimates) => ({ ...estimates, [code]: value }));
    this.feedback.set('');
  }

  readonly formatEuroCents = formatEuroCents;

  reverseSign(amount: string): string {
    return amount.startsWith('-') ? amount.slice(1) : '-' + amount;
  }

  difference(actual: string, estimate: string | undefined, direction: number): number | null {
    const planned = parseAmountToCents(estimate);
    const real = parseAmountToCents(actual.replace(/^-/, ''));
    if (planned === null || real === null) return null;
    return ((actual.startsWith('-') ? -real : real) - planned) * direction;
  }

  totals(rows: BudgetRow[], direction: number) {
    const estimates = this.estimates();
    let estimated = 0;
    let actual = 0;
    let gap = 0;
    let valid = true;
    for (const row of rows) {
      const planned = parseAmountToCents(estimates[row.code]);
      const actualAmount = this.difference(row.amount, undefined, direction) ?? 0;
      actual += actualAmount;
      if (planned === null) {
        valid = false;
      } else {
        estimated += planned;
        gap += actualAmount - planned * direction;
      }
    }
    return { estimated: valid ? estimated : null, actual, gap: valid ? gap : null };
  }

  readonly exerciseResult = computed(() => {
    const [receipts, expenses] = this.groups().map((group) => this.totals(group.rows, group.direction));
    return {
      estimated: receipts.estimated === null || expenses.estimated === null ? null : receipts.estimated - expenses.estimated,
      actual: receipts.actual + expenses.actual,
      gap: receipts.gap === null || expenses.gap === null ? null : receipts.gap + expenses.gap,
    };
  });

  ngOnInit(): void {
    void this.loadYears();
  }

  private async loadYears(): Promise<void> {
    try {
      const years = await this.api.listFiscalYears();
      this.years.set(years);
      const initial = defaultYear(years);
      if (initial) await this.select(initial.id);
    } catch {
      this.error.set('Les exercices n’ont pas pu être chargés. Vérifiez votre connexion et rechargez la page.');
    } finally {
      this.loading.set(false);
    }
  }

  async select(id: string): Promise<void> {
    this.year.set(this.years().find((year) => year.id === id));
    this.budgetGroups.set(null);
    this.error.set('');
    this.feedback.set('');
    this.estimates.set({});
    this.history.set([]);
    this.loading.set(true);
    try {
      await this.pending;
      const budget = await firstValueFrom(this.http.get<BudgetState>('/api/annual-budgets/' + id));
      this.saved = budget.estimates;
      this.estimates.set(budget.estimates);
      this.history.set(budget.history);
      this.budgetGroups.set(budget.groups);
    } catch {
      this.error.set('Le budget n’a pas pu être chargé. Vérifiez votre connexion et rechargez la page.');
    } finally {
      this.loading.set(false);
    }
  }

  historyCategory(label: string, code: string): string {
    const group = this.groups().find((group) => group.rows.some((row) => row.code === code));
    return group ? group.title + ' · ' + label : label;
  }

  save(row: BudgetRow): void {
    const year = this.year();
    if (!year || !this.canEdit()) return;
    const cents = parseAmountToCents(this.estimates()[row.code]);
    if (cents === null) {
      this.feedback.set('Le montant n’a pas été enregistré. Saisissez un montant positif avec deux décimales au plus.');
      return;
    }
    const amount = centsToApi(cents);
    this.pending = this.pending.then(async () => {
      if ((this.saved[row.code] ?? '0.00') === amount) return;
      try {
        const budget = await firstValueFrom(this.http.put<BudgetState>('/api/annual-budgets/' + year.id + '/estimate', {
          code: row.code,
          label: row.label,
          amount,
          expected: this.saved[row.code] ?? '0.00',
        }));
        this.saved = { ...this.saved, [row.code]: amount };
        if (this.year()?.id === year.id) {
          this.history.set(budget.history);
          this.feedback.set('Montant enregistré.');
        }
      } catch (error) {
        if (this.year()?.id === year.id) {
          this.feedback.set(error instanceof HttpErrorResponse && error.status === 409
            ? 'Ce montant a changé. Rechargez le budget avant de réessayer.'
            : 'Le montant n’a pas été enregistré. Vérifiez votre connexion, puis quittez à nouveau le champ pour réessayer.');
        }
      }
    });
  }
}
