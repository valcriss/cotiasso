import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type BudgetReportInfo, type BudgetReportRowInfo, type ProjectInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { ExportLink } from '../reports/export-link';
import { formatEuroAmount } from './amount';
import { ThemeService } from '../theme/theme.service';

/**
 * Suivi du budget d'un projet : ce qui était prévu, ce qui est promis sans être payé, ce qui est réellement dépensé, et ce
 * qu'il reste. Toute la vie du projet ou un exercice. Le réalisé vient des écritures comptabilisées, comme la synthèse.
 */
@Component({
  selector: 'app-project-report',
  imports: [MatFormFieldModule, MatIconModule, MatSelectModule, ExportLink],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .other td {
      font-style: italic;
    }
    .note {
      display: block;
      font-size: 0.85em;
      font-style: normal;
      color: var(--mat-sys-on-surface-variant);
    }
    .formula {
      margin: 12px 0 0;
    }
    .warnings {
      margin: 8px 0;
      padding-left: 20px;
    }
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Suivi du budget de ' + project().name">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">insights</mat-icon><span>Suivi du budget</span></h3>
        <div class="actions">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Période</mat-label>
            <mat-select [value]="year()" (selectionChange)="changeYear($event.value)" aria-label="Période du suivi">
              <mat-option value="">Toute la vie du projet</mat-option>
              @for (fiscalYear of report()?.fiscalYears ?? []; track fiscalYear.id) {
                <mat-option [value]="fiscalYear.id">Exercice {{ fiscalYear.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (report()) {
            <app-export-link [base]="'/api/projects/' + project().id + '/budget-report/csv'" [params]="{ fiscalYearId: year() }" [print]="true" />
          }
        </div>
      </div>
      <p class="muted">
        Compare ce que vous aviez <strong>prévu</strong> (le budget), ce qui est <strong>promis mais pas encore payé</strong> (les
        engagements) et ce qui est <strong>réellement dépensé</strong> ({{ simple() ? 'les opérations enregistrées dans les comptes' : 'les écritures comptabilisées' }}).
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (report(); as data) {
        @if (data.budget; as budget) {
          <p class="muted">Budget en vigueur : n° {{ budget.number }} — {{ budget.label }}.</p>
        }
        @if (data.warnings.length > 0) {
          <ul class="warnings" aria-label="À savoir">
            @for (warning of data.warnings; track warning) {
              <li>{{ warning }}</li>
            }
          </ul>
        }

        <table class="table">
          <caption class="sr-only">Dépenses</caption>
          <thead>
            <tr>
              <th scope="col">Dépenses (charges)</th>
              <th scope="col" class="amount">Prévu</th>
              <th scope="col" class="amount">Engagé, pas encore payé</th>
              <th scope="col" class="amount">Dépensé</th>
              <th scope="col" class="amount">Reste disponible</th>
            </tr>
          </thead>
          <tbody>
            @for (row of data.charges.rows; track row.key) {
              <tr [class.other]="row.outOfBudget">
                <td>
                  {{ row.label }}
                  @if (row.note) {
                    <span class="note">{{ row.note }}</span>
                  }
                </td>
                <td class="amount">{{ amount(row.budget) }}</td>
                <td class="amount">{{ amount(row.engaged) }}</td>
                <td class="amount">{{ amount(row.actual) }}</td>
                <td class="amount">{{ amount(row.remaining) }} @if (over(row.remaining)) { <span class="chip">Dépassement</span> }</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">Aucune dépense prévue, engagée ni enregistrée pour ce projet.</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td>Total des dépenses</td>
              <td class="amount">{{ amount(data.charges.total.budget) }}</td>
              <td class="amount">{{ amount(data.charges.total.engaged) }}</td>
              <td class="amount">{{ amount(data.charges.total.actual) }}</td>
              <td class="amount">{{ amount(data.charges.total.remaining) }} @if (over(data.charges.total.remaining)) { <span class="chip">Dépassement</span> }</td>
            </tr>
          </tfoot>
        </table>

        <table class="table">
          <caption class="sr-only">Recettes</caption>
          <thead>
            <tr>
              <th scope="col">Recettes (produits)</th>
              <th scope="col" class="amount">Prévu</th>
              <th scope="col" class="amount">Encaissé</th>
              <th scope="col" class="amount">Reste à recevoir</th>
            </tr>
          </thead>
          <tbody>
            @for (row of data.products.rows; track row.key) {
              <tr [class.other]="row.outOfBudget">
                <td>
                  {{ row.label }}
                  @if (row.note) {
                    <span class="note">{{ row.note }}</span>
                  }
                </td>
                <td class="amount">{{ amount(row.budget) }}</td>
                <td class="amount">{{ amount(row.actual) }}</td>
                <td class="amount">{{ amount(row.remaining) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="muted">Aucune recette prévue ni enregistrée pour ce projet.</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td>Total des recettes</td>
              <td class="amount">{{ amount(data.products.total.budget) }}</td>
              <td class="amount">{{ amount(data.products.total.actual) }}</td>
              <td class="amount">{{ amount(data.products.total.remaining) }}</td>
            </tr>
          </tfoot>
        </table>
        <p class="muted formula"><strong>Comment lire le reste disponible ?</strong> {{ data.formula }}</p>
      }
    </section>
  `,
})
export class ProjectReport {
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  private readonly api = inject(AdminApiService);

  readonly project = input.required<ProjectInfo>();
  /** Recharge le suivi quand un autre panneau a changé les chiffres (budget, engagements). */
  readonly refreshKey = input<number>(0);

  protected readonly report = signal<BudgetReportInfo | null>(null);
  protected readonly year = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.project().id;
      this.refreshKey();
      untracked(() => void this.load(id, this.year()));
    });
  }

  protected amount(value: string | null): string {
    return value === null ? '—' : formatEuroAmount(value);
  }

  protected over(value: BudgetReportRowInfo['remaining']): boolean {
    return value !== null && value.startsWith('-') && !/^-0\.00$/.test(value);
  }

  protected async changeYear(value: string): Promise<void> {
    this.year.set(value);
    await this.load(this.project().id, value);
  }

  private async load(projectId: string, year: string): Promise<void> {
    this.error.set(null);
    try {
      this.report.set(await this.api.budgetReport(projectId, year || undefined));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger le suivi du budget.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
