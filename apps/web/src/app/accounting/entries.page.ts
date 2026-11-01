import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type EntryInfo,
  type EntryStatus,
  type FiscalYearInfo,
  type JournalInfo,
} from '../admin/admin-api.service';
import { RouterLink } from '@angular/router';
import { ActionBar } from '../ui/action-bar';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { formatApiAmount } from './amount';
import { ENTRY_STATUS_LABELS } from './entry-editor';

/** Comptabilité : liste filtrée des écritures ; la saisie et la lecture d’une écriture ont leur page (`EntryPage`). */
@Component({
  selector: 'app-entries-page',
  imports: [ReactiveFormsModule, RouterLink, ActionBar, MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
  `,
  template: `
    <app-action-bar
      label="Actions des écritures"
      description="Chaque mouvement d’argent noté dans les comptes. Un brouillon peut encore être modifié ; une écriture comptabilisée est définitive."
    >
      @if (canCreate()) {
        <a mat-flat-button routerLink="ecritures/nouvelle">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon>
          Nouvelle écriture
        </a>
      }
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    <form class="panel filters" [formGroup]="filters" (ngSubmit)="search()">
      <mat-form-field appearance="outline">
        <mat-label>Exercice</mat-label>
        <mat-select formControlName="fiscalYearId">
          <mat-option value="">Tous</mat-option>
          @for (year of years(); track year.id) {
            <mat-option [value]="year.id">{{ year.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Journal</mat-label>
        <mat-select formControlName="journalId">
          <mat-option value="">Tous</mat-option>
          @for (journal of journals(); track journal.id) {
            <mat-option [value]="journal.id">{{ journal.code }} — {{ journal.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>État</mat-label>
        <mat-select formControlName="status">
          <mat-option value="">Tous</mat-option>
          <mat-option value="DRAFT">Brouillons</mat-option>
          <mat-option value="POSTED">Comptabilisées</mat-option>
          <mat-option value="REVERSED">Contrepassées</mat-option>
        </mat-select>
      </mat-form-field>
      <div class="actions"><button mat-flat-button type="submit"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">filter_alt</mat-icon> Filtrer</button></div>
    </form>

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (entries().length === 0) {
      <p class="muted">Aucune écriture pour ces critères.@if (canCreate()) { Cliquez sur « Nouvelle écriture » pour noter votre première opération. }</p>
    } @else {
      <table class="table">
        <caption class="sr-only">Écritures</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Journal</th>
            <th scope="col">N°</th>
            <th scope="col">Libellé</th>
            <th scope="col" class="amount">Montant</th>
            <th scope="col">État</th>
            <th scope="col"><span class="sr-only">Ouvrir</span></th>
          </tr>
        </thead>
        <tbody>
          @for (entry of entries(); track entry.id) {
            <tr>
              <td>{{ entry.date }}</td>
              <td>{{ entry.journalCode }}</td>
              <td>{{ entry.number ?? '—' }}</td>
              <td>{{ entry.label }}</td>
              <td class="amount">{{ amount(entry.totalDebit) }}</td>
              <td>{{ statusLabel(entry.status) }}</td>
              <td class="row-actions">
                <a mat-button [attr.aria-label]="'Ouvrir ' + entry.label" [routerLink]="['ecritures', entry.id]">Ouvrir</a>
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (next()) {
        <div class="more"><button mat-stroked-button type="button" [disabled]="loadingMore()" (click)="more()">Charger la suite</button></div>
      }
    }
  `,
})
export class EntriesPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly journals = signal<JournalInfo[]>([]);

  protected readonly entries = signal<EntryInfo[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canCreate = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:create');
  });

  protected readonly filters = this.fb.group({ fiscalYearId: [''], journalId: [''], status: [''] });
  protected readonly amount = formatApiAmount;

  constructor() {
    void this.init();
  }

  protected statusLabel(status: EntryStatus): string {
    return ENTRY_STATUS_LABELS[status];
  }

  protected async search(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.listEntries(this.query());
      this.entries.set(page.entries);
      this.next.set(page.next);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les écritures.').message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async more(): Promise<void> {
    const after = this.next();
    if (!after) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.listEntries({ ...this.query(), after });
      this.entries.update((current) => [...current, ...page.entries]);
      this.next.set(page.next);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la suite.').message);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private query() {
    const { fiscalYearId, journalId, status } = this.filters.getRawValue();
    return {
      ...(fiscalYearId && { fiscalYearId }),
      ...(journalId && { journalId }),
      ...(status && { status: status as EntryStatus }),
    };
  }

  private async init(): Promise<void> {
    try {
      const [years, journals] = await Promise.all([this.api.listFiscalYears(), this.api.listJournals()]);
      this.years.set(years);
      this.journals.set(journals.filter((j) => j.active));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la structure comptable.').message);
    }
    await this.search();
  }
}
