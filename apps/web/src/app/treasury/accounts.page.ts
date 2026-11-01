import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  AdminApiService,
  type AccountInfo,
  type FinancialAccountInfo,
  type ProjectInfo,
} from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { PageHeader } from '../ui/page-header';
import { FinancialAccountDialog, type AccountDialogData } from './account-dialog';
import { StatementDialog, type StatementDialogData } from './statement-dialog';
import { TransactionsPanel } from './transactions-panel';

/** Comptes : banques et caisses avec leurs soldes (ouverture, calculé, comptable, relevé) et leurs transactions. */
@Component({
  selector: 'app-accounts-page',
  imports: [MatButtonModule, MatIconModule, PageHeader, TransactionsPanel],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .accounts {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
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
      gap: 10px;
      padding: 24px 28px;
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
    <app-page-header
      title="Comptes"
      icon="account_balance"
      description="Vos comptes bancaires et votre caisse : combien il y a dessus et quels mouvements restent à enregistrer."
    >
      @if (canAdmin()) {
        <button mat-flat-button type="button" (click)="create()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau compte
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (accounts().length === 0) {
      <section class="panel">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">savings</mat-icon><span>Commençons par votre compte bancaire</span></h3>
        <p>
          Aucun compte n'est encore enregistré. Ajoutez votre compte bancaire (ou votre caisse) pour pouvoir y saisir ou y
          importer des mouvements.
        </p>
        @if (!canAdmin()) {
          <p class="muted">Demandez à la personne qui administre la comptabilité de le créer.</p>
        }
      </section>
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
                <button mat-button type="button" [attr.aria-label]="'Relevé de ' + account.name" (click)="statement(account)">Solde de relevé</button>
              }
              @if (canAdmin() && !account.archivedOn) {
                <button mat-button type="button" [attr.aria-label]="'Archiver ' + account.name" [disabled]="busy()" (click)="archive(account)">Archiver</button>
              }
            </div>
          </li>
        }
      </ul>
    }

    @if (selected(); as account) {
      <app-transactions-panel [account]="account" [accounts]="chart()" [projects]="activeProjects()" (changed)="load()" />
    }
  `,
})
export class AccountsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly accounts = signal<FinancialAccountInfo[]>([]);
  protected readonly chart = signal<AccountInfo[]>([]);
  private readonly projects = signal<ProjectInfo[]>([]);
  protected readonly activeProjects = computed(() => this.projects().filter((p) => p.status !== 'ARCHIVED'));
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.accounts().find((a) => a.id === this.selectedId()) ?? null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
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
  private readonly freeAccounts = computed(() => {
    const used = new Set(this.accounts().map((a) => a.accountId));
    return this.chart().filter((a) => a.active && a.number.startsWith('5') && !used.has(a.id));
  });

  constructor() {
    void this.init();
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected async create(): Promise<void> {
    const created = await this.dialogs.open<FinancialAccountInfo, AccountDialogData>(FinancialAccountDialog, {
      size: 'md',
      data: { freeAccounts: this.freeAccounts() },
    });
    if (!created) return;
    this.notifier.success(`Compte « ${created.name} » créé avec le journal ${created.journalCode}.`);
    await this.load();
  }

  protected async statement(account: FinancialAccountInfo): Promise<void> {
    const saved = await this.dialogs.open<boolean, StatementDialogData>(StatementDialog, { size: 'sm', data: { account } });
    if (!saved) return;
    this.notifier.success('Solde de relevé enregistré.');
    await this.load();
  }

  protected async archive(account: FinancialAccountInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Archiver « ${account.name} » ?`,
      message:
        "Le compte n'acceptera plus de nouvelles transactions, mais son historique reste consultable.\nUn compte archivé ne peut pas être réactivé.",
      confirmLabel: 'Archiver',
      danger: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.archiveFinancialAccount(account.id);
      this.notifier.success(`Compte « ${account.name} » archivé.`);
      await this.load();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le compte n'a pas pu être archivé. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
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
}
