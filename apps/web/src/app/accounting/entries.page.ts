import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type AccountInfo,
  type EntryInfo,
  type EntryStatus,
  type FiscalYearInfo,
  type JournalInfo,
  type ProjectInfo,
} from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { formatApiAmount } from './amount';
import { ENTRY_STATUS_LABELS, EntryEditor } from './entry-editor';

/** Comptabilité : liste filtrée des écritures et éditeur (brouillon, comptabilisation, contrepassation). */
@Component({
  selector: 'app-entries-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, EntryEditor],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    tr.clickable {
      cursor: pointer;
    }
    tr.selected td {
      background: var(--mat-sys-surface-container-low);
    }
  `,
  template: `
    <header class="head">
      <h2>Écritures</h2>
      @if (canCreate()) {
        <button mat-flat-button type="button" (click)="startNew()">
          <mat-icon fontSet="material-icons-outlined">add</mat-icon>
          Nouvelle écriture
        </button>
      }
    </header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (editing()) {
      <app-entry-editor
        [entryId]="selectedId()"
        [journals]="journals()"
        [accounts]="activeAccounts()"
        [projects]="activeProjects()"
        (changed)="onChanged($event.id)"
        (closed)="close()"
      />
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
      <p class="muted">Aucune écriture pour ces critères.</p>
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
            <tr class="clickable" [class.selected]="entry.id === selectedId()">
              <td>{{ entry.date }}</td>
              <td>{{ entry.journalCode }}</td>
              <td>{{ entry.number ?? '—' }}</td>
              <td>{{ entry.label }}</td>
              <td class="amount">{{ amount(entry.totalDebit) }}</td>
              <td>{{ statusLabel(entry.status) }}</td>
              <td class="row-actions">
                <button mat-button type="button" [attr.aria-label]="'Ouvrir ' + entry.label" (click)="open(entry)">Ouvrir</button>
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
  private readonly accounts = signal<AccountInfo[]>([]);
  protected readonly activeAccounts = computed(() => this.accounts().filter((a) => a.active));
  private readonly projects = signal<ProjectInfo[]>([]);
  protected readonly activeProjects = computed(() => this.projects().filter((p) => p.status !== 'ARCHIVED'));

  protected readonly entries = signal<EntryInfo[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Éditeur ouvert ? `selectedId` = null avec `editing` vrai signifie « nouvelle écriture ». */
  protected readonly editing = signal(false);
  protected readonly selectedId = signal<string | null>(null);

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

  protected startNew(): void {
    this.selectedId.set(null);
    this.editing.set(true);
  }

  protected open(entry: EntryInfo): void {
    this.selectedId.set(entry.id);
    this.editing.set(true);
  }

  protected close(): void {
    this.editing.set(false);
    this.selectedId.set(null);
  }

  protected async onChanged(id: string | null): Promise<void> {
    if (id !== null) this.selectedId.set(id);
    await this.search();
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
      const [years, journals, accounts] = await Promise.all([
        this.api.listFiscalYears(),
        this.api.listJournals(),
        this.api.listAccounts(),
      ]);
      this.years.set(years);
      this.journals.set(journals.filter((j) => j.active));
      this.accounts.set(accounts);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la structure comptable.').message);
    }
    // La liste des projets exige projects:view ; sans ce droit, la ventilation n'est simplement pas proposée.
    this.projects.set(await this.api.listProjects().catch(() => []));
    await this.search();
  }
}
