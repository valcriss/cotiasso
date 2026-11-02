import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AdminApiService, type FiscalYearInfo, type TrialBalanceInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { formatApiAmount } from './amount';
import { ActionBar } from '../ui/action-bar';
import { ExportLink } from '../reports/export-link';
import { ReportFilters, type PeriodFilter } from './report-filters';

/** Balance : débit, crédit et soldes de chaque compte mouvementé, avec la vérification de l'équilibre. */
@Component({
  selector: 'app-trial-balance-page',
  imports: [ActionBar, ExportLink, FormsModule, MatFormFieldModule, MatIconModule, MatInputModule, ReportFilters],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    tfoot td {
      font-weight: 500;
    }
  `,
  template: `
    <app-action-bar label="Balance" description="Pour chaque compte, le total des débits, des crédits et le solde. Sert à vérifier d’un coup d’œil que les comptes sont équilibrés.">
      @if (exportParams(); as params) {
        <app-export-link path="trial-balance" [params]="params" />
      }
    </app-action-bar>
    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    <app-report-filters [years]="years()" (filtered)="show($event)">
      <mat-form-field appearance="outline">
        <mat-label>Classe ou préfixe</mat-label>
        <input matInput inputmode="numeric" placeholder="ex. 6" [(ngModel)]="prefix" [ngModelOptions]="{ standalone: true }" />
      </mat-form-field>
    </app-report-filters>

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (result(); as balance) {
      @if (balance.rows.length === 0) {
        <p class="muted">Aucun mouvement comptabilisé pour ces critères.</p>
      } @else {
        @if (balance.balanced) {
          <p class="success" role="status">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">check_circle</mat-icon> Balance équilibrée : total des débits = total des crédits.
          </p>
        } @else if (!filtered()) {
          <p class="alert" role="alert">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">warning</mat-icon> Balance déséquilibrée : anomalie à investiguer avant tout état de synthèse.
          </p>
        } @else {
          <p class="muted">Sélection partielle : l'équilibre ne se vérifie que sur l'ensemble des comptes.</p>
        }
        <section class="panel">
          <table class="table">
            <caption class="sr-only">Balance des comptes</caption>
            <thead>
              <tr>
                <th scope="col">Compte</th>
                <th scope="col">Libellé</th>
                <th scope="col" class="amount">Débit</th>
                <th scope="col" class="amount">Crédit</th>
                <th scope="col" class="amount">Solde débiteur</th>
                <th scope="col" class="amount">Solde créditeur</th>
              </tr>
            </thead>
            <tbody>
              @for (row of balance.rows; track row.accountId) {
                <tr>
                  <td>{{ row.number }}</td>
                  <td>{{ row.label }}</td>
                  <td class="amount">{{ amount(row.debit) }}</td>
                  <td class="amount">{{ amount(row.credit) }}</td>
                  <td class="amount">{{ row.debitBalance === '0.00' ? '' : amount(row.debitBalance) }}</td>
                  <td class="amount">{{ row.creditBalance === '0.00' ? '' : amount(row.creditBalance) }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2">Totaux</td>
                <td class="amount">{{ amount(balance.totals.debit) }}</td>
                <td class="amount">{{ amount(balance.totals.credit) }}</td>
                <td class="amount">{{ amount(balance.totals.debitBalance) }}</td>
                <td class="amount">{{ amount(balance.totals.creditBalance) }}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      }
    }
  `,
})
export class TrialBalancePage {
  private readonly api = inject(AdminApiService);

  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly result = signal<TrialBalanceInfo | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Vrai quand un filtre de période ou de compte restreint la balance : l'équilibre n'est alors plus un contrôle. */
  protected readonly filtered = signal(false);
  protected prefix = '';

  protected readonly amount = formatApiAmount;

  constructor() {
    void this.init();
  }

  /** Paramètres de l'état affiché : l'export CSV reprend exactement les mêmes filtres. */
  protected readonly exportParams = signal<Record<string, string | undefined> | null>(null);

  protected async show(filter: PeriodFilter): Promise<void> {
    this.exportParams.set(this.paramsFor(filter));
    this.error.set(null);
    this.loading.set(true);
    try {
      this.result.set(
        await this.api.trialBalance({
          fiscalYearId: filter.fiscalYearId,
          from: filter.from,
          to: filter.to,
          prefix: this.prefix.trim(),
        }),
      );
      this.filtered.set(this.prefix.trim() !== '');
    } catch (failure) {
      this.result.set(null);
      this.error.set(describeHttpError(failure, 'Impossible de charger la balance.').message);
    } finally {
      this.loading.set(false);
    }
  }

  private async init(): Promise<void> {
    try {
      this.years.set(await this.api.listFiscalYears());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les exercices.').message);
    }
  }

  private paramsFor(filter: PeriodFilter): Record<string, string | undefined> {
    return { fiscalYearId: filter.fiscalYearId, from: filter.from, to: filter.to, prefix: this.prefix.trim() };
  }
}
