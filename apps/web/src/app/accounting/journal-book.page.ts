import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type FiscalYearInfo,
  type JournalBookEntryInfo,
  type JournalInfo,
} from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { formatApiAmount } from './amount';
import { ActionBar } from '../ui/action-bar';
import { ReportFilters, type PeriodFilter } from './report-filters';

/** Livre-journal : les écritures comptabilisées dans l'ordre de leur numérotation, avec leurs lignes. */
@Component({
  selector: 'app-journal-book-page',
  imports: [ActionBar, FormsModule, MatFormFieldModule, MatSelectModule, ReportFilters],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .entry-head {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin: 0 0 8px;
    }
    .tag {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    tfoot td {
      font-weight: 500;
    }
  `,
  template: `
    <app-action-bar label="Livre-journal" description="Toutes les écritures comptabilisées dans l’ordre chronologique, comme un cahier de bord de la comptabilité." />
    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    <app-report-filters [years]="years()" (filtered)="show($event)">
      <mat-form-field appearance="outline">
        <mat-label>Journal</mat-label>
        <mat-select [(ngModel)]="journalId" [ngModelOptions]="{ standalone: true }">
          <mat-option value="">Tous</mat-option>
          @for (journal of journals(); track journal.id) {
            <mat-option [value]="journal.id">{{ journal.code }} — {{ journal.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </app-report-filters>

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (loaded() && entries().length === 0) {
      <p class="muted">Aucune écriture comptabilisée pour ces critères.</p>
    }

    @for (entry of entries(); track entry.id) {
      <section class="panel" [attr.aria-label]="'Écriture ' + entry.journalCode + ' ' + entry.number">
        <div class="entry-head">
          <h3>{{ entry.journalCode }} n° {{ entry.number }} — {{ entry.label }}</h3>
          <span class="tag">
            {{ entry.date }}@if (entry.reference) {
              · Réf. {{ entry.reference }}
            }@if (entry.kind === 'REVERSAL') {
              · Contrepassation
            }@if (entry.kind === 'OPENING') {
              · À-nouveaux
            }@if (entry.status === 'REVERSED') {
              · Contrepassée
            }
          </span>
        </div>
        <table class="table">
          <caption class="sr-only">Lignes de l'écriture {{ entry.journalCode }} {{ entry.number }}</caption>
          <thead>
            <tr>
              <th scope="col">Compte</th>
              <th scope="col">Libellé</th>
              <th scope="col" class="amount">Débit</th>
              <th scope="col" class="amount">Crédit</th>
            </tr>
          </thead>
          <tbody>
            @for (line of entry.lines; track $index) {
              <tr>
                <td>{{ line.accountNumber }} — {{ line.accountLabel }}</td>
                <td>{{ line.label }}</td>
                <td class="amount">{{ line.debit === '0.00' ? '' : amount(line.debit) }}</td>
                <td class="amount">{{ line.credit === '0.00' ? '' : amount(line.credit) }}</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">Totaux</td>
              <td class="amount">{{ amount(entry.totalDebit) }}</td>
              <td class="amount">{{ amount(entry.totalCredit) }}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    }
  `,
})
export class JournalBookPage {
  private readonly api = inject(AdminApiService);

  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly journals = signal<JournalInfo[]>([]);
  protected readonly entries = signal<JournalBookEntryInfo[]>([]);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected journalId = '';

  protected readonly amount = formatApiAmount;

  constructor() {
    void this.init();
  }

  protected async show(filter: PeriodFilter): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const { entries } = await this.api.journalBook({
        fiscalYearId: filter.fiscalYearId,
        from: filter.from,
        to: filter.to,
        journalId: this.journalId,
      });
      this.entries.set(entries);
      this.loaded.set(true);
    } catch (failure) {
      this.entries.set([]);
      this.error.set(describeHttpError(failure, 'Impossible de charger le livre-journal.').message);
    } finally {
      this.loading.set(false);
    }
  }

  private async init(): Promise<void> {
    try {
      const [years, journals] = await Promise.all([this.api.listFiscalYears(), this.api.listJournals()]);
      this.journals.set(journals);
      this.years.set(years);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la structure comptable.').message);
    }
  }
}
