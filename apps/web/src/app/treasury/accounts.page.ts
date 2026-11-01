import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type AccountInfo,
  type FinancialAccountInfo,
  type ProjectInfo,
} from '../admin/admin-api.service';
import { centsToApi, formatApiAmount, parseAmountToCents } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { TransactionsPanel } from './transactions-panel';

/** Comptes : banques et caisses avec leurs soldes (ouverture, calculé, comptable, relevé) et leurs transactions. */
@Component({
  selector: 'app-accounts-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, TransactionsPanel],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .accounts {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      list-style: none;
      margin: 0 0 20px;
      padding: 0;
    }
    .account-card {
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      box-shadow: var(--app-shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 18px;
    }
    .account-card.current {
      border-color: var(--mat-sys-primary);
    }
    .account-card.archived {
      opacity: 0.7;
    }
    .balances {
      display: grid;
      gap: 2px 12px;
      grid-template-columns: 1fr auto;
      margin: 0;
    }
    .balances dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .balances dd {
      font-variant-numeric: tabular-nums;
      margin: 0;
      text-align: right;
    }
    .big {
      font: var(--mat-sys-headline-small);
    }
  `,
  template: `
    <header class="head">
      <h1 class="title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_balance</mat-icon><span>Comptes</span></h1>
      @if (canAdmin()) {
        <button mat-flat-button type="button" (click)="creating.set(!creating())">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau compte
        </button>
      }
    </header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @if (notice(); as message) {
      <p class="success" role="status">{{ message }}</p>
    }

    @if (creating()) {
      <form class="panel" [formGroup]="form" (ngSubmit)="create()" novalidate>
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">add_card</mat-icon><span>Nouveau compte financier</span></h3>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Nom</mat-label>
            <input matInput formControlName="name" required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type">
              <mat-option value="BANK">Compte bancaire</mat-option>
              <mat-option value="CASH">Caisse</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Compte comptable de trésorerie</mat-label>
            <mat-select formControlName="accountId" required>
              @for (candidate of freeAccounts(); track candidate.id) {
                <mat-option [value]="candidate.id">{{ candidate.number }} — {{ candidate.label }}</mat-option>
              }
            </mat-select>
            <mat-hint>Classe 5, non utilisé par un autre compte</mat-hint>
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Ouvert le</mat-label>
            <input matInput type="date" formControlName="openedOn" required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Solde à l'ouverture</mat-label>
            <input matInput inputmode="decimal" formControlName="openingBalance" />
            <mat-hint>Information : ne crée aucune écriture</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Référence (ex. fin d'IBAN)</mat-label>
            <input matInput formControlName="reference" />
          </mat-form-field>
        </div>
        <p class="muted">Un journal de banque ou de caisse est créé et rattaché automatiquement ; le compte comptable et le journal sont ensuite définitifs.</p>
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="busy() || form.invalid">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">save</mat-icon> Créer le compte
          </button>
          <button mat-button type="button" (click)="creating.set(false)">Annuler</button>
        </div>
      </form>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (accounts().length === 0) {
      <p class="muted">Aucun compte financier. Créez le premier pour saisir des transactions.</p>
    } @else {
      <ul class="accounts">
        @for (account of accounts(); track account.id) {
          <li class="account-card" [class.current]="account.id === selectedId()" [class.archived]="account.archivedOn">
            <div class="head">
              <strong>
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ account.type === 'BANK' ? 'account_balance' : 'payments' }}</mat-icon>
                {{ account.name }}
              </strong>
              @if (account.archivedOn) {
                <span class="chip">Archivé</span>
              }
            </div>
            <div class="muted">{{ account.journalCode }} · compte {{ account.accountNumber }}@if (account.reference) { · {{ account.reference }} }</div>
            <div class="big">{{ amount(account.balances.computed) }} €</div>
            <dl class="balances">
              <dt>Ouverture ({{ account.openedOn }})</dt>
              <dd>{{ amount(account.balances.opening) }}</dd>
              <dt>Solde comptable (écritures)</dt>
              <dd>{{ amount(account.balances.accounting) }}</dd>
              @if (account.balances.lastStatement; as statement) {
                <dt>Relevé au {{ statement.periodEnd }}</dt>
                <dd>{{ amount(statement.closingBalance) }}</dd>
                <dt>Écart relevé − calculé</dt>
                <dd [class.danger-text]="statement.gap !== '0.00'">{{ amount(statement.gap) }}</dd>
              }
            </dl>
            <div class="actions">
              <button mat-stroked-button type="button" [attr.aria-label]="'Ouvrir ' + account.name" (click)="select(account.id)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">list</mat-icon> Transactions
              </button>
              @if (canStatement() && !account.archivedOn) {
                <button mat-button type="button" [attr.aria-label]="'Relevé de ' + account.name" (click)="startStatement(account.id)">Solde de relevé</button>
              }
              @if (canAdmin() && !account.archivedOn) {
                <button mat-button type="button" [attr.aria-label]="'Archiver ' + account.name" [disabled]="busy()" (click)="archive(account)">Archiver</button>
              }
            </div>
          </li>
        }
      </ul>
    }

    @if (statementFor(); as target) {
      <form class="panel" [formGroup]="statementForm" (ngSubmit)="recordStatement(target)" novalidate>
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">receipt_long</mat-icon><span>Solde d'un relevé</span></h3>
        <p class="muted">
          Une preuve datée, en ajout seul : elle ne rapproche pas le compte, elle mesure l'écart avec le solde calculé.
        </p>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Début de période</mat-label>
            <input matInput type="date" formControlName="periodStart" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Fin de période</mat-label>
            <input matInput type="date" formControlName="periodEnd" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Solde de clôture</mat-label>
            <input matInput inputmode="decimal" formControlName="closingBalance" />
          </mat-form-field>
        </div>
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="busy()">Enregistrer le solde</button>
          <button mat-button type="button" (click)="statementFor.set(null)">Annuler</button>
        </div>
      </form>
    }

    @if (selected(); as account) {
      <app-transactions-panel [account]="account" [accounts]="chart()" [projects]="activeProjects()" (changed)="load()" />
    }
  `,
})
export class AccountsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly accounts = signal<FinancialAccountInfo[]>([]);
  protected readonly chart = signal<AccountInfo[]>([]);
  private readonly projects = signal<ProjectInfo[]>([]);
  protected readonly activeProjects = computed(() => this.projects().filter((p) => p.status !== 'ARCHIVED'));
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.accounts().find((a) => a.id === this.selectedId()) ?? null);
  protected readonly creating = signal(false);
  protected readonly statementFor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly amount = formatApiAmount;

  protected readonly canAdmin = computed(() => {
    this.auth.permissions();
    return this.auth.can('settings.accounting:admin');
  });
  protected readonly canStatement = computed(() => {
    this.auth.permissions();
    return this.auth.can('imports:post');
  });
  /** Comptes de classe 5 actifs, pas encore rattachés à un compte financier. */
  protected readonly freeAccounts = computed(() => {
    const used = new Set(this.accounts().map((a) => a.accountId));
    return this.chart().filter((a) => a.active && a.number.startsWith('5') && !used.has(a.id));
  });

  protected readonly form = this.fb.group({
    name: ['', [Validators.required]],
    type: ['BANK' as 'BANK' | 'CASH'],
    accountId: ['', [Validators.required]],
    openedOn: ['', [Validators.required]],
    openingBalance: [''],
    reference: [''],
  });
  protected readonly statementForm = this.fb.group({ periodStart: [''], periodEnd: [''], closingBalance: [''] });

  constructor() {
    void this.init();
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected startStatement(id: string): void {
    this.statementForm.reset({ periodStart: '', periodEnd: '', closingBalance: '' });
    this.statementFor.set(id);
  }

  protected async create(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.openingBalance.replace(/^-/, ''));
    if (cents === null) {
      this.error.set("Solde d'ouverture invalide (ex. 1 250,00).");
      return;
    }
    await this.run(async () => {
      const created = await this.api.createFinancialAccount({
        name: raw.name.trim(),
        type: raw.type,
        reference: raw.reference.trim() === '' ? null : raw.reference.trim(),
        accountId: raw.accountId,
        openedOn: raw.openedOn,
        openingBalance: centsToApi(raw.openingBalance.trim().startsWith('-') ? -cents : cents),
      });
      this.notice.set(`Compte « ${created.name} » créé avec le journal ${created.journalCode}.`);
      this.creating.set(false);
      this.form.reset({ name: '', type: 'BANK', accountId: '', openedOn: '', openingBalance: '', reference: '' });
    });
  }

  protected archive(account: FinancialAccountInfo): Promise<void> {
    return this.run(async () => {
      await this.api.archiveFinancialAccount(account.id);
      this.notice.set(`Compte « ${account.name} » archivé.`);
    });
  }

  protected async recordStatement(id: string): Promise<void> {
    const raw = this.statementForm.getRawValue();
    const negative = raw.closingBalance.trim().startsWith('-');
    const cents = parseAmountToCents(raw.closingBalance.replace(/^-/, ''));
    if (!raw.periodStart || !raw.periodEnd || cents === null || raw.closingBalance.trim() === '') {
      this.error.set('Renseignez la période et le solde de clôture du relevé (ex. 1 250,00).');
      return;
    }
    await this.run(async () => {
      await this.api.recordStatement(id, {
        periodStart: raw.periodStart,
        periodEnd: raw.periodEnd,
        closingBalance: centsToApi(negative ? -cents : cents),
      });
      this.notice.set('Solde de relevé enregistré.');
      this.statementFor.set(null);
    });
  }

  protected async load(): Promise<void> {
    try {
      this.accounts.set(await this.api.listFinancialAccounts());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les comptes.').message);
    } finally {
      this.loading.set(false);
    }
  }

  private async init(): Promise<void> {
    await this.load();
    // Plan de comptes et projets : facultatifs pour consulter, ignorés sans droit.
    this.chart.set(await this.api.listAccounts().catch(() => []));
    this.projects.set(await this.api.listProjects().catch(() => []));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      await this.load();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Opération impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
  }
}
