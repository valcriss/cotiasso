import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { AdminApiService, type AccountInfo, type FiscalYearInfo, type JournalInfo } from './admin-api.service';
import { ClosingDialog, type ClosingDialogData } from './closing-dialog';
import { FiscalYearDialog } from './fiscal-year-dialog';
import { JOURNAL_TYPES, JournalDialog } from './journal-dialog';
import { PlanAccountDialog } from './plan-account-dialog';
import { CategoriesPanel } from './categories-panel';

const STATUS_LABELS: Record<FiscalYearInfo['status'], string> = {
  OPEN: 'Ouvert',
  CLOSING: 'Fermé à la saisie',
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

/** Paramètres › Comptabilité : exercices, journaux et plan de comptes. Création en boîtes de dialogue. */
@Component({
  selector: 'app-accounting-page',
  imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, ActionBar, CategoriesPanel],
  styleUrl: './admin-pages.scss',
  template: `
    <app-action-bar
      label="Actions de la comptabilité"
      description="La structure de votre comptabilité : les exercices (périodes comptables), les journaux (cahiers d'enregistrement) et le plan de comptes."
    >
      @if (canEdit()) {
        <button mat-flat-button type="button" (click)="addYear()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouvel exercice
        </button>
        <button mat-stroked-button type="button" (click)="addJournal()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau journal
        </button>
        <button mat-stroked-button type="button" (click)="addAccount()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau compte
        </button>
        <button mat-stroked-button type="button" (click)="planFile.click()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">upload_file</mat-icon> Importer un plan (CSV)
        </button>
        <input #planFile class="sr-only" type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Fichier du plan de comptes" (change)="importFile($event)" />
      }
    </app-action-bar>

    @if (!canEdit()) {
      <p class="muted">Vous pouvez consulter la structure comptable, mais pas la modifier.</p>
    }
    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @for (message of importErrors(); track message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    <app-categories-panel [canEdit]="canEdit()" [accounts]="accounts()" (planChanged)="load()" />

    <section class="panel" aria-labelledby="rules-title">
      <h3 id="rules-title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">rule</mat-icon><span>Règles de comptabilisation</span></h3>
      <mat-checkbox [checked]="projectRequired()" [disabled]="!canEdit() || busy()" (change)="setProjectRequired($event.checked)">
        Projet obligatoire sur les charges et les produits
      </mat-checkbox>
      <p class="muted">
        Une écriture de charge ou de produit sans projet reste enregistrable en brouillon, mais ne peut pas être comptabilisée.
        Les opérations générales se ventilent sur le projet permanent « Fonctionnement ».
      </p>
    </section>

    <section class="panel" aria-labelledby="fy-title">
      <h3 id="fy-title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">event</mat-icon><span>Exercices</span></h3>
      <p class="muted">Dates libres, sans chevauchement. Un exercice ne se supprime pas ; on le clôture quand les comptes de la période sont arrêtés.</p>
      @if (years().length === 0) {
        <p class="muted">Aucun exercice pour l'instant. Créez le premier pour pouvoir enregistrer des écritures.</p>
      } @else {
        <table class="table">
          <caption class="sr-only">Exercices</caption>
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Début</th>
              <th scope="col">Fin</th>
              <th scope="col">État</th>
              <th scope="col"><span class="sr-only">Clôture</span></th>
            </tr>
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
                    <button mat-button type="button" [attr.aria-label]="'Clôture de ' + year.label" (click)="closeYear(year)">Clôture…</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    <section class="panel" aria-labelledby="jr-title">
      <h3 id="jr-title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">book</mat-icon><span>Journaux</span></h3>
      <p class="muted">Le code et le type d'un journal sont définitifs ; on le désactive au lieu de le supprimer.</p>
      <table class="table">
        <caption class="sr-only">Journaux</caption>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Nom</th>
            <th scope="col">Type</th>
            <th scope="col">État</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
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
                  <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="(journal.active ? 'Désactiver ' : 'Réactiver ') + journal.code" (click)="toggleJournal(journal)">
                    {{ journal.active ? 'Désactiver' : 'Réactiver' }}
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>

    <section class="panel" aria-labelledby="ac-title">
      <h3 id="ac-title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_tree</mat-icon><span>Plan de comptes</span></h3>
      <p class="muted">
        Aucun plan n'est imposé : installez les catégories de départ (elles ajoutent les comptes courants), importez le vôtre (fichier « numéro;libellé ») ou créez les comptes un à un. Le numéro est
        définitif ; un compte se désactive, il ne se supprime pas.
      </p>
      <mat-form-field appearance="outline">
        <mat-label>Filtrer par numéro ou libellé</mat-label>
        <input matInput [ngModel]="filter()" (ngModelChange)="filter.set($event)" [ngModelOptions]="{ standalone: true }" />
      </mat-form-field>
      @if (visibleAccounts().length === 0) {
        <p class="muted">
          @if (accounts().length === 0) {
            Aucun compte pour l'instant. Importez votre plan ou créez un premier compte.
          } @else {
            Aucun compte ne correspond à ce filtre.
          }
        </p>
      } @else {
        <table class="table">
          <caption class="sr-only">Plan de comptes</caption>
          <thead>
            <tr>
              <th scope="col">Numéro</th>
              <th scope="col">Libellé</th>
              <th scope="col">État</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (account of visibleAccounts(); track account.id) {
              <tr>
                <td>{{ account.number }}</td>
                <td>{{ account.label }}</td>
                <td>{{ account.active ? 'Actif' : 'Désactivé' }}</td>
                <td class="row-actions">
                  @if (canEdit()) {
                    <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="(account.active ? 'Désactiver ' : 'Réactiver ') + account.number" (click)="toggleAccount(account)">
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
    </section>
  `,
})
export class AccountingPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly canEdit = computed(() => {
    this.auth.permissions();
    return this.auth.can('settings.accounting:admin');
  });
  protected readonly canClose = computed(() => {
    this.auth.permissions();
    return this.auth.can('fiscal-years:close');
  });

  protected readonly projectRequired = signal(true);
  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly journals = signal<JournalInfo[]>([]);
  protected readonly accounts = signal<AccountInfo[]>([]);
  protected readonly filter = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
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

  constructor() {
    void this.load();
  }

  protected statusLabel(status: FiscalYearInfo['status']): string {
    return STATUS_LABELS[status];
  }

  protected journalTypeLabel(type: JournalInfo['type']): string {
    return JOURNAL_TYPES.find((t) => t.value === type)?.label ?? type;
  }

  protected async addYear(): Promise<void> {
    const created = await this.dialogs.open<FiscalYearInfo>(FiscalYearDialog, { size: 'sm' });
    if (!created) return;
    this.notifier.success(`Exercice « ${created.label} » créé.`);
    await this.load();
  }

  protected async addJournal(): Promise<void> {
    const created = await this.dialogs.open<JournalInfo>(JournalDialog, { size: 'sm' });
    if (!created) return;
    this.notifier.success(`Journal ${created.code} créé.`);
    await this.load();
  }

  protected async addAccount(): Promise<void> {
    const created = await this.dialogs.open<AccountInfo>(PlanAccountDialog, { size: 'sm' });
    if (!created) return;
    this.notifier.success(`Compte ${created.number} créé.`);
    await this.load();
  }

  protected async closeYear(year: FiscalYearInfo): Promise<void> {
    // Boîte d'information et d'actions successives : la page se recharge toujours à sa fermeture.
    await this.dialogs.open<boolean, ClosingDialogData>(ClosingDialog, { size: 'md', dismissible: true, data: { year, accounts: this.accounts() } });
    await this.load();
  }

  protected toggleJournal(journal: JournalInfo): Promise<void> {
    return this.run(async () => {
      await this.api.updateJournal(journal.id, { active: !journal.active });
      this.notifier.success(`Journal ${journal.code} ${journal.active ? 'désactivé' : 'réactivé'}.`);
    });
  }

  protected toggleAccount(account: AccountInfo): Promise<void> {
    return this.run(async () => {
      await this.api.updateAccount(account.id, { active: !account.active });
      this.notifier.success(`Compte ${account.number} ${account.active ? 'désactivé' : 'réactivé'}.`);
    });
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.importErrors.set([]);
    if (!file) return;

    const { accounts, errors } = parseAccountCsv(await file.text());
    if (errors.length > 0) {
      this.importErrors.set(
        [`Le fichier n'a pas été importé : corrigez-le puis recommencez. ${errors[0]}`].concat(
          errors.slice(1, 5),
          errors.length > 5 ? [`… et ${errors.length - 5} autre(s) erreur(s).`] : [],
        ),
      );
      return;
    }
    if (accounts.length === 0) {
      this.importErrors.set(["Le fichier ne contient aucun compte. Chaque ligne doit être de la forme « 706;Prestations de services »."]);
      return;
    }
    await this.run(async () => {
      const result = await this.api.importAccounts(accounts);
      this.notifier.success(`${result.created} compte(s) créé(s), ${result.skipped} déjà présent(s) laissé(s) tel(s) quel(s).`);
    });
  }

  protected setProjectRequired(value: boolean): Promise<void> {
    return this.run(async () => {
      await this.api.updateAccountingSettings({ projectRequired: value });
      this.projectRequired.set(value);
      this.notifier.success(value ? 'Le projet est désormais obligatoire.' : "Le projet n'est plus obligatoire.");
    });
  }

  protected async load(): Promise<void> {
    try {
      const [years, journals, accounts, rules] = await Promise.all([
        this.api.listFiscalYears(),
        this.api.listJournals(),
        this.api.listAccounts(),
        this.api.accountingSettings(),
      ]);
      this.projectRequired.set(rules.projectRequired);
      this.years.set(years);
      this.journals.set(journals);
      this.accounts.set(accounts);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la structure comptable.').message);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      await this.load();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'action n'a pas pu aboutir. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
