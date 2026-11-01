import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ClosingPanel } from './closing-panel';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import {
  AdminApiService,
  type AccountInfo,
  type FiscalYearInfo,
  type JournalInfo,
  type JournalType,
} from './admin-api.service';

export const JOURNAL_TYPES: readonly { value: JournalType; label: string }[] = [
  { value: 'BANK', label: 'Banque' },
  { value: 'CASH', label: 'Caisse' },
  { value: 'PURCHASES', label: 'Achats' },
  { value: 'REVENUE', label: 'Produits' },
  { value: 'MISC', label: 'Opérations diverses' },
  { value: 'OPENING', label: 'À-nouveaux' },
];

const STATUS_LABELS: Record<FiscalYearInfo['status'], string> = {
  OPEN: 'Ouvert',
  CLOSING: 'En cours de clôture',
  CLOSED: 'Clôturé',
};

const ACCOUNT_NUMBER = /^[1-8][0-9]{2,7}$/;

export interface ParsedAccounts {
  accounts: { number: string; label: string }[];
  errors: string[];
}

/** Lit un plan de comptes « numéro;libellé » (ou tabulation). Une première ligne d'en-tête est ignorée. */
export function parseAccountCsv(text: string): ParsedAccounts {
  const accounts: { number: string; label: string }[] = [];
  const errors: string[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (line.trim() === '') return;
      const cut = line.search(/[;\t]/);
      const number = (cut < 0 ? line : line.slice(0, cut)).trim().replace(/^"|"$/g, '');
      const label = (cut < 0 ? '' : line.slice(cut + 1)).trim().replace(/^"|"$/g, '');
      if (index === 0 && !/^\d/.test(number)) return;
      if (!ACCOUNT_NUMBER.test(number)) errors.push(`Ligne ${index + 1} : numéro « ${number} » invalide.`);
      else if (label === '') errors.push(`Ligne ${index + 1} : libellé manquant.`);
      else accounts.push({ number, label });
    });
  return { accounts, errors };
}

@Component({
  selector: 'app-accounting-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, ClosingPanel],
  styleUrl: './admin-pages.scss',
  template: `
    <h2>Comptabilité</h2>
    @if (!canEdit()) {
      <p class="muted">Vous pouvez consulter la structure comptable, mais pas la modifier.</p>
    }
    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @if (notice(); as message) {
      <p class="success" role="status">{{ message }}</p>
    }

    <section class="panel" aria-labelledby="fy-title">
      <h3 id="fy-title">Exercices</h3>
      <p class="muted">Dates libres, sans chevauchement. Un exercice ne se supprime pas.</p>
      @if (years().length === 0) {
        <p class="muted">Aucun exercice. Créez le premier pour pouvoir saisir des écritures.</p>
      } @else {
        <table class="table">
          <caption class="sr-only">Exercices</caption>
          <thead>
            <tr><th scope="col">Libellé</th><th scope="col">Début</th><th scope="col">Fin</th><th scope="col">État</th><th scope="col"><span class="sr-only">Clôture</span></th></tr>
          </thead>
          <tbody>
            @for (year of years(); track year.id) {
              <tr>
                <td>{{ year.label }}</td>
                <td>{{ year.start }}</td>
                <td>{{ year.end }}</td>
                <td>{{ statusLabel(year.status) }}</td>
                <td class="row-actions">
                  @if (canClose()) {
                    <button mat-stroked-button type="button" [attr.aria-label]="'Clôture de ' + year.label" (click)="closingYearId.set(year.id)">Clôture…</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (closingYear(); as year) {
        <app-closing-panel [year]="year" [accounts]="accounts()" (changed)="load()" (closed)="closingYearId.set(null)" />
      }
      @if (canEdit()) {
        <form class="row" [formGroup]="yearForm" (ngSubmit)="addYear()" novalidate>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Libellé</mat-label>
            <input matInput formControlName="label" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Début</mat-label>
            <input matInput type="date" formControlName="start" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Fin</mat-label>
            <input matInput type="date" formControlName="end" />
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="busy() || yearForm.invalid">Créer l'exercice</button>
        </form>
      }
    </section>

    <section class="panel" aria-labelledby="jr-title">
      <h3 id="jr-title">Journaux</h3>
      <p class="muted">Le code et le type d'un journal sont définitifs ; on le désactive au lieu de le supprimer.</p>
      <table class="table">
        <caption class="sr-only">Journaux</caption>
        <thead>
          <tr><th scope="col">Code</th><th scope="col">Libellé</th><th scope="col">Type</th><th scope="col">État</th><th scope="col"></th></tr>
        </thead>
        <tbody>
          @for (journal of journals(); track journal.id) {
            <tr>
              <td>{{ journal.code }}</td>
              <td>{{ journal.label }}</td>
              <td>{{ journalTypeLabel(journal.type) }}</td>
              <td>{{ journal.active ? 'Actif' : 'Désactivé' }}</td>
              <td class="row-actions">
                @if (canEdit()) {
                  <button mat-stroked-button type="button" [disabled]="busy()" (click)="toggleJournal(journal)">
                    {{ journal.active ? 'Désactiver' : 'Réactiver' }}
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (canEdit()) {
        <form class="row" [formGroup]="journalForm" (ngSubmit)="addJournal()" novalidate>
          <mat-form-field appearance="outline">
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Libellé</mat-label>
            <input matInput formControlName="label" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type">
              @for (type of journalTypes; track type.value) {
                <mat-option [value]="type.value">{{ type.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="busy() || journalForm.invalid">Créer le journal</button>
        </form>
      }
    </section>

    <section class="panel" aria-labelledby="ac-title">
      <h3 id="ac-title">Plan de comptes</h3>
      <p class="muted">
        Aucun plan n'est fourni : importez le vôtre (fichier « numéro;libellé ») ou créez les comptes un à un. Le numéro est
        définitif ; un compte se désactive, il ne se supprime pas.
      </p>
      <mat-form-field appearance="outline">
        <mat-label>Filtrer par numéro ou libellé</mat-label>
        <input matInput [value]="filter()" (input)="filter.set($any($event.target).value)" />
      </mat-form-field>
      @if (visibleAccounts().length === 0) {
        <p class="muted">Aucun compte à afficher.</p>
      } @else {
        <table class="table">
          <caption class="sr-only">Plan de comptes</caption>
          <thead>
            <tr><th scope="col">Numéro</th><th scope="col">Libellé</th><th scope="col">État</th><th scope="col"></th></tr>
          </thead>
          <tbody>
            @for (account of visibleAccounts(); track account.id) {
              <tr>
                <td>{{ account.number }}</td>
                <td>{{ account.label }}</td>
                <td>{{ account.active ? 'Actif' : 'Désactivé' }}</td>
                <td class="row-actions">
                  @if (canEdit()) {
                    <button mat-stroked-button type="button" [disabled]="busy()" (click)="toggleAccount(account)">
                      {{ account.active ? 'Désactiver' : 'Réactiver' }}
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (hiddenCount() > 0) {
          <p class="muted">{{ hiddenCount() }} compte(s) de plus : affinez le filtre.</p>
        }
      }
      @if (canEdit()) {
        <form class="row" [formGroup]="accountForm" (ngSubmit)="addAccount()" novalidate>
          <mat-form-field appearance="outline">
            <mat-label>Numéro</mat-label>
            <input matInput formControlName="number" inputmode="numeric" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Libellé</mat-label>
            <input matInput formControlName="label" />
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="busy() || accountForm.invalid">Créer le compte</button>
        </form>
        <div class="actions">
          <label class="muted" for="accounts-file">Importer un plan (CSV « numéro;libellé »)</label>
          <input id="accounts-file" type="file" accept=".csv,.txt,text/csv,text/plain" (change)="importFile($event)" />
        </div>
        @for (message of importErrors(); track message) {
          <p class="alert" role="alert">{{ message }}</p>
        }
      }
    </section>
  `,
})
export class AccountingPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly journalTypes = JOURNAL_TYPES;
  protected readonly canEdit = computed(() => {
    this.auth.permissions();
    return this.auth.can('settings.accounting:admin');
  });

  protected readonly canClose = computed(() => {
    this.auth.permissions();
    return this.auth.can('fiscal-years:close');
  });
  protected readonly closingYearId = signal<string | null>(null);
  protected readonly closingYear = computed(() => this.years().find((y) => y.id === this.closingYearId()) ?? null);
  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly journals = signal<JournalInfo[]>([]);
  protected readonly accounts = signal<AccountInfo[]>([]);
  protected readonly filter = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly importErrors = signal<string[]>([]);

  private readonly pageSize = 200;
  private readonly matching = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    return needle === ''
      ? this.accounts()
      : this.accounts().filter((a) => a.number.startsWith(needle) || a.label.toLowerCase().includes(needle));
  });
  protected readonly visibleAccounts = computed(() => this.matching().slice(0, this.pageSize));
  protected readonly hiddenCount = computed(() => Math.max(0, this.matching().length - this.pageSize));

  protected readonly yearForm = this.fb.group({
    label: ['', [Validators.required]],
    start: ['', [Validators.required]],
    end: ['', [Validators.required]],
  });
  protected readonly journalForm = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9-]{1,10}$/)]],
    label: ['', [Validators.required]],
    type: ['MISC' as JournalType, [Validators.required]],
  });
  protected readonly accountForm = this.fb.group({
    number: ['', [Validators.required, Validators.pattern(ACCOUNT_NUMBER)]],
    label: ['', [Validators.required]],
  });

  constructor() {
    void this.load();
  }

  protected statusLabel(status: FiscalYearInfo['status']): string {
    return STATUS_LABELS[status];
  }

  protected journalTypeLabel(type: JournalType): string {
    return JOURNAL_TYPES.find((t) => t.value === type)?.label ?? type;
  }

  protected addYear(): Promise<void> {
    return this.run(async () => {
      await this.api.createFiscalYear(this.yearForm.getRawValue());
      this.yearForm.reset();
    }, 'Exercice créé.');
  }

  protected addJournal(): Promise<void> {
    return this.run(async () => {
      await this.api.createJournal(this.journalForm.getRawValue());
      this.journalForm.reset({ code: '', label: '', type: 'MISC' });
    }, 'Journal créé.');
  }

  protected toggleJournal(journal: JournalInfo): Promise<void> {
    return this.run(() => this.api.updateJournal(journal.id, { active: !journal.active }).then(() => undefined));
  }

  protected addAccount(): Promise<void> {
    return this.run(async () => {
      await this.api.createAccount(this.accountForm.getRawValue());
      this.accountForm.reset();
    }, 'Compte créé.');
  }

  protected toggleAccount(account: AccountInfo): Promise<void> {
    return this.run(() => this.api.updateAccount(account.id, { active: !account.active }).then(() => undefined));
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.importErrors.set([]);
    if (!file) return;

    const { accounts, errors } = parseAccountCsv(await file.text());
    if (errors.length > 0) {
      this.importErrors.set(errors.slice(0, 5).concat(errors.length > 5 ? [`… et ${errors.length - 5} autre(s) erreur(s).`] : []));
      return;
    }
    if (accounts.length === 0) {
      this.importErrors.set(['Le fichier ne contient aucun compte.']);
      return;
    }
    await this.run(async () => {
      const result = await this.api.importAccounts(accounts);
      this.notice.set(`${result.created} compte(s) créé(s), ${result.skipped} déjà présent(s) laissé(s) tel(s) quel(s).`);
    });
  }

  protected async load(): Promise<void> {
    try {
      const [years, journals, accounts] = await Promise.all([
        this.api.listFiscalYears(),
        this.api.listJournals(),
        this.api.listAccounts(),
      ]);
      this.years.set(years);
      this.journals.set(journals);
      this.accounts.set(accounts);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la structure comptable.').message);
    }
  }

  private async run(action: () => Promise<void>, success?: string): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      if (success) this.notice.set(success);
      await this.load();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Action impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
  }
}
