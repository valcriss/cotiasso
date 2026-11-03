import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type AccountInfo,
  type FiscalYearInfo,
  type LedgerAccountInfo,
} from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { formatApiAmount, formatBalance } from './amount';
import { ActionBar } from '../ui/action-bar';
import { ExportLink } from '../reports/export-link';
import { ReportFilters, type PeriodFilter } from './report-filters';
import { FrDatePipe } from '../ui/fr-date.pipe';

/** Grand livre : les mouvements de chaque compte avec leur solde cumulé, écritures comptabilisées seulement. */
@Component({
  selector: 'app-ledger-page',
  imports: [FrDatePipe, ActionBar, ExportLink, FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, ReportFilters],
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
    <app-action-bar label="Grand livre" description="Le détail des mouvements de chaque compte, avec son solde au fil du temps. Seules les écritures comptabilisées y figurent.">
      @if (exportParams(); as params) {
        <app-export-link path="ledger" [params]="params" />
      }
    </app-action-bar>
    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    <app-report-filters [years]="years()" (filtered)="show($event)">
      <mat-form-field appearance="outline">
        <mat-label>Compte</mat-label>
        <mat-select [(ngModel)]="accountId" [ngModelOptions]="{ standalone: true }">
          <mat-option value="">Tous</mat-option>
          @for (account of accounts(); track account.id) {
            <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Classe ou préfixe</mat-label>
        <input matInput inputmode="numeric" placeholder="ex. 6" [(ngModel)]="prefix" [ngModelOptions]="{ standalone: true }" />
      </mat-form-field>
    </app-report-filters>

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (loaded() && result().length === 0) {
      <p class="muted">Aucun mouvement comptabilisé pour ces critères.</p>
    }

    @for (account of result(); track account.accountId) {
      <section class="panel" [attr.aria-label]="'Compte ' + account.number">
        <h3>{{ account.number }} — {{ account.label }}</h3>
        <table class="table">
          <caption class="sr-only">Mouvements du compte {{ account.number }}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Journal</th>
              <th scope="col">N°</th>
              <th scope="col">Libellé</th>
              <th scope="col" class="amount">Débit</th>
              <th scope="col" class="amount">Crédit</th>
              <th scope="col" class="amount">Solde</th>
            </tr>
          </thead>
          <tbody>
            @for (line of account.lines; track $index) {
              <tr>
                <td>{{ line.date | frDate }}</td>
                <td>{{ line.journalCode }}</td>
                <td>{{ line.entryNumber }}</td>
                <td>{{ line.lineLabel || line.entryLabel }}</td>
                <td class="amount">{{ line.debit === '0.00' ? '' : amount(line.debit) }}</td>
                <td class="amount">{{ line.credit === '0.00' ? '' : amount(line.credit) }}</td>
                <td class="amount">{{ balance(line.balance) }}</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4">Totaux</td>
              <td class="amount">{{ amount(account.totalDebit) }}</td>
              <td class="amount">{{ amount(account.totalCredit) }}</td>
              <td class="amount">{{ balance(account.balance) }}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    }
  `,
})
export class LedgerPage {
  private readonly api = inject(AdminApiService);

  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly accounts = signal<AccountInfo[]>([]);
  protected readonly result = signal<LedgerAccountInfo[]>([]);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected accountId = '';
  protected prefix = '';

  protected readonly amount = formatApiAmount;
  protected readonly balance = formatBalance;

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
      const { accounts } = await this.api.ledger({
        fiscalYearId: filter.fiscalYearId,
        from: filter.from,
        to: filter.to,
        accountId: this.accountId,
        prefix: this.prefix.trim(),
      });
      this.result.set(accounts);
      this.loaded.set(true);
    } catch (failure) {
      this.result.set([]);
      this.error.set(describeHttpError(failure, "Impossible de charger le grand livre.").message);
    } finally {
      this.loading.set(false);
    }
  }

  private async init(): Promise<void> {
    try {
      const [years, accounts] = await Promise.all([this.api.listFiscalYears(), this.api.listAccounts()]);
      this.accounts.set(accounts);
      this.years.set(years);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la structure comptable.').message);
    }
  }

  private paramsFor(filter: PeriodFilter): Record<string, string | undefined> {
    return { fiscalYearId: filter.fiscalYearId, from: filter.from, to: filter.to, accountId: this.accountId, prefix: this.prefix.trim() };
  }
}
