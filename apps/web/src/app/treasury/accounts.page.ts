import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AdminApiService,
  type AccountInfo,
  type FinancialAccountInfo,
  type ProjectInfo,
  type TransferInfo,
} from '../admin/admin-api.service';
import { formatEuroAmount } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { ThemeService } from '../theme/theme.service';
import { StartAccountDialog, type StartAccountDialogData } from '../pages/start-dialogs';
import { OperationLauncher } from './operation-launcher';
import { PageHeader } from '../ui/page-header';
import { FinancialAccountDialog, type AccountDialogData } from './account-dialog';
import { TransferDialog, type TransferDialogData } from './transfer-dialog';
import { StatementDialog, type StatementDialogData } from './statement-dialog';
import { TransactionsPanel } from './transactions-panel';
import { formatDate } from '../ui/dates';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { HelpHint } from '../ui/help-hint';
import { Skeleton } from '../ui/skeleton';

/** Comptes : banques et caisses avec leurs soldes (ouverture, calculé, comptable, relevé) et leurs transactions. */
@Component({
  selector: 'app-accounts-page',
  imports: [Skeleton, HelpHint, FrDatePipe, MatButtonModule, MatIconModule, MatMenuModule, RouterLink, PageHeader, TransactionsPanel],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .accounts {
      display: grid;
      gap: 20px;
      grid-template-columns: repeat(auto-fill, minmax(min(420px, 100%), 1fr));
      list-style: none;
      margin: 0 0 20px;
      padding: 0;
    }
    .account-card {
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      box-shadow: var(--app-shadow-sm);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: 200px;
      padding: 28px 32px;
      position: relative;
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .account-card:hover {
      box-shadow: var(--app-shadow-md);
    }
    .account-card.current {
      border-color: var(--mat-sys-primary);
      box-shadow: 0 0 0 1px var(--mat-sys-primary), var(--app-shadow-sm);
    }
    .account-card.archived {
      cursor: default;
    }
    .head {
      align-items: flex-start;
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }
    /* Toute la tuile ouvre les transactions : le bouton du titre s'étend sur la carte, le menu et le détail restent au-dessus. */
    .open {
      align-items: center;
      background: none;
      border: 0;
      color: inherit;
      cursor: inherit;
      display: inline-flex;
      font: var(--mat-sys-title-medium);
      gap: 10px;
      padding: 0;
      text-align: left;
    }
    .open::after {
      content: '';
      inset: 0;
      position: absolute;
    }
    .open:focus-visible {
      outline: none;
    }
    .open:focus-visible::after {
      border-radius: var(--app-radius);
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
    .head-tools {
      align-items: center;
      display: flex;
      gap: 8px;
      position: relative;
      z-index: 1;
    }
    .more-link {
      align-items: center;
      color: var(--mat-sys-primary);
      display: inline-flex;
      font: var(--mat-sys-label-large);
      gap: 8px;
      margin-top: auto;
    }
    .more-link mat-icon {
      font-size: 22px;
      height: 22px;
      width: 22px;
    }
    .danger-item {
      color: var(--mat-sys-error);
    }
    .account-card.archived {
      opacity: 0.7;
    }
    .gap {
      align-items: flex-start;
      display: flex;
      font: var(--mat-sys-body-medium);
      gap: 6px;
      margin: 6px 0 0;
    }
    .gap mat-icon {
      flex: none;
      font-size: 20px;
      height: 20px;
      width: 20px;
    }
    .balances {
      display: grid;
      gap: 2px 12px;
      grid-template-columns: 1fr auto;
      margin: 0;
    }
    /* Petit écran : l'intitulé passe au-dessus de sa valeur, pour que les phrases d'explication aient toute la largeur. */
    @media (max-width: 600px) {
      .balances {
        grid-template-columns: 1fr;
      }
      .balances dd {
        text-align: left;
      }
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
      font: var(--mat-sys-headline-medium);
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
      @if (canRecord()) {
        <button mat-flat-button type="button" (click)="record('IN')">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">south_west</mat-icon> J’ai reçu de l’argent
        </button>
        <button mat-flat-button type="button" (click)="record('OUT')">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">north_east</mat-icon> J’ai dépensé de l’argent
        </button>
      }
      @if (canTransfer()) {
        <button mat-stroked-button type="button" (click)="transfer()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">sync_alt</mat-icon> {{ simple() ? 'Déplacer de l’argent entre mes comptes' : 'Nouveau virement interne' }}
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <app-skeleton variant="cards" />
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
              <button type="button" class="open" [attr.aria-label]="'Ouvrir ' + account.name" [attr.aria-expanded]="account.id === selectedId()" (click)="select(account.id)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ account.type === 'BANK' ? 'account_balance' : 'payments' }}</mat-icon>
                {{ account.name }}
              </button>
              <div class="head-tools">
                @if (account.archivedOn) {
                  <span class="chip">Archivé</span>
                }
                @if (hasActions(account)) {
                  <button mat-icon-button type="button" [matMenuTriggerFor]="actions" [attr.aria-label]="'Actions de ' + account.name">
                    <mat-icon fontSet="material-icons-outlined" aria-hidden="true">more_vert</mat-icon>
                  </button>
                  <mat-menu #actions="matMenu" xPosition="before">
                    @if (!account.archivedOn) {
                      <a mat-menu-item [routerLink]="['/comptes', account.id, 'rapprochement']">
                        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">fact_check</mat-icon>
                        <span>{{ simple() ? 'Vérifier avec la banque' : 'Rapprocher' }}</span>
                      </a>
                    }
                    @if (canStatement() && !account.archivedOn) {
                      <button mat-menu-item type="button" (click)="statement(account)">
                        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">receipt_long</mat-icon>
                        <span>{{ simple() ? 'Solde sur mon relevé' : 'Solde de relevé' }}</span>
                      </button>
                    }
                    @if (canAdmin() && !account.archivedOn) {
                      <button mat-menu-item type="button" class="danger-item" [disabled]="busy()" (click)="archive(account)">
                        <mat-icon fontSet="material-icons-outlined" class="danger-item" aria-hidden="true">archive</mat-icon>
                        <span>Archiver</span>
                      </button>
                    }
                  </mat-menu>
                }
              </div>
            </div>
            @if (!simple()) {
              <div class="muted">{{ account.journalCode }} · compte {{ account.accountNumber }}@if (account.reference) { · {{ account.reference }} }</div>
            } @else if (account.reference) {
              <div class="muted">{{ account.reference }}</div>
            }
            <div class="big">{{ amount(account.balances.computed) }}</div>
            @if (simple()) {
              <div class="muted">Solde d’après vos enregistrements <app-help-hint term="solde" /></div>
              @if (account.balances.lastStatement; as statement) {
                <p class="gap" [class.danger-text]="statement.gap !== '0.00'" role="status">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ statement.gap === '0.00' ? 'check_circle' : 'warning' }}</mat-icon>
                  {{ gapSentence(statement) }}
                </p>
              }
              <dl class="balances">
                <dt>Vérifié avec la banque <app-help-hint term="verifie" /></dt>
                <dd>
                  @if (account.balances.reconciled; as reconciled) {
                    Oui, au {{ reconciled.periodEnd | frDate }}
                  } @else {
                    <span class="muted">Pas encore vérifié : vous n’avez pas encore comparé ce compte au relevé de la banque. Cela permet de repérer un oubli ou un doublon.</span>
                  }
                </dd>
              </dl>
            } @else {
              <dl class="balances">
                <dt>Ouverture ({{ account.openedOn | frDate }})</dt>
                <dd>{{ amount(account.balances.opening) }}</dd>
                <dt>Solde comptable (écritures)</dt>
                <dd>{{ amount(account.balances.accounting) }}</dd>
                <dt>Rapprochement</dt>
                <dd>
                  @if (account.balances.reconciled; as reconciled) {
                    Rapproché au {{ reconciled.periodEnd | frDate }}
                  } @else {
                    <span class="muted">Pas encore rapproché</span>
                  }
                </dd>
                @if (account.balances.lastStatement; as statement) {
                  <dt>Relevé au {{ statement.periodEnd | frDate }}</dt>
                  <dd>{{ amount(statement.closingBalance) }}</dd>
                  <dt>Écart relevé − calculé</dt>
                  <dd [class.danger-text]="statement.gap !== '0.00'">{{ amount(statement.gap) }}</dd>
                }
              </dl>
            }
            <span class="more-link" aria-hidden="true">
              <mat-icon fontSet="material-icons-outlined">{{ account.id === selectedId() ? 'expand_less' : 'arrow_forward' }}</mat-icon>
              {{ account.id === selectedId() ? (simple() ? 'Masquer les mouvements' : 'Masquer les transactions') : (simple() ? 'Voir les mouvements' : 'Voir les transactions') }}
            </span>
          </li>
        }
      </ul>
    }

    @if (selected(); as account) {
      <app-transactions-panel [account]="account" [accounts]="chart()" [projects]="activeProjects()" [reloadKey]="reloadKey()" (changed)="load()" />
    }
  `,
})
export class AccountsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);
  private readonly launcher = inject(OperationLauncher);
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');

  protected readonly accounts = signal<FinancialAccountInfo[]>([]);
  protected readonly chart = signal<AccountInfo[]>([]);
  private readonly projects = signal<ProjectInfo[]>([]);
  protected readonly activeProjects = computed(() => this.projects().filter((p) => p.status !== 'ARCHIVED'));
  private readonly route = inject(ActivatedRoute);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.accounts().find((a) => a.id === this.selectedId()) ?? null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatEuroAmount;

  /**
   * L'écart est « relevé − enregistrements » : positif, la banque indique plus que ce qui est enregistré (il manque sans doute des
   * mouvements) ; négatif, elle indique moins (un mouvement est peut-être en trop ou n'a pas encore passé). Dit en phrase, avec le sens.
   */
  protected gapSentence(statement: { gap: string; periodEnd: string }): string {
    const date = formatDate(statement.periodEnd);
    if (statement.gap === '0.00') return `Vos enregistrements correspondent au relevé du ${date}.`;
    const negative = statement.gap.startsWith('-');
    const amount = formatEuroAmount(negative ? statement.gap.slice(1) : statement.gap);
    return negative
      ? `Au ${date}, votre banque indique ${amount} de moins que vos enregistrements : un mouvement est peut-être en trop, ou n’a pas encore été débité.`
      : `Au ${date}, votre banque indique ${amount} de plus que vos enregistrements : il manque sans doute des mouvements.`;
  }

  protected readonly canAdmin = computed(() => {
    this.auth.permissions();
    return this.auth.can('settings.accounting:admin');
  });
  protected readonly reloadKey = signal(0);
  /** Saisie guidée : il faut pouvoir saisir une transaction et préparer son écriture, et avoir un compte actif. */
  protected readonly canRecord = computed(() => {
    this.auth.permissions();
    return this.auth.can('transactions:manage') && this.auth.can('entries:create') && this.activeAccounts().length >= 1;
  });
  /** Un virement relie deux comptes actifs et prépare une écriture : il faut les droits de saisie des deux. */
  protected readonly canTransfer = computed(() => {
    this.auth.permissions();
    return this.auth.can('transactions:manage') && this.auth.can('entries:create') && this.activeAccounts().length >= 2;
  });
  private readonly activeAccounts = computed(() => this.accounts().filter((a) => !a.archivedOn));
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

  /** Une tuile a un menu d'actions tant qu'au moins une action est possible. */
  protected hasActions(account: FinancialAccountInfo): boolean {
    return !account.archivedOn;
  }

  /** Un clic sur la tuile ouvre les transactions du compte ; un second clic les masque. */
  protected select(id: string): void {
    this.selectedId.update((current) => (current === id ? null : id));
  }

  protected async record(direction: 'IN' | 'OUT'): Promise<void> {
    if (!(await this.launcher.open(direction, this.selectedId()))) return;
    await this.load();
    this.reloadKey.update((key) => key + 1);
  }

  protected async create(): Promise<void> {
    if (this.simple()) {
      const added = await this.dialogs.open<FinancialAccountInfo, StartAccountDialogData>(StartAccountDialog, { size: 'md', data: { existing: this.accounts() } });
      if (!added) return;
      this.notifier.success(`Compte « ${added.name} » ajouté.`);
      await this.load();
      return;
    }
    const created = await this.dialogs.open<FinancialAccountInfo, AccountDialogData>(FinancialAccountDialog, {
      size: 'md',
      data: { freeAccounts: this.freeAccounts() },
    });
    if (!created) return;
    this.notifier.success(`Compte « ${created.name} » créé avec le journal ${created.journalCode}.`);
    await this.load();
  }

  protected async transfer(): Promise<void> {
    const created = await this.dialogs.open<TransferInfo, TransferDialogData>(TransferDialog, {
      size: 'md',
      data: { accounts: this.activeAccounts(), fromAccountId: this.selectedId() },
    });
    if (!created) return;
    this.notifier.success(
      created.entryId
        ? 'Virement enregistré. Le brouillon d’écriture est prêt : relisez-le puis comptabilisez-le depuis la liste des transactions.'
        : 'Virement enregistré.',
    );
    await this.load();
    this.reloadKey.update((key) => key + 1);
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
    // Un lien de la vue d'ensemble ouvre directement le compte concerné.
    const wanted = this.route.snapshot.queryParamMap.get('compte');
    if (wanted && this.accounts().some((a) => a.id === wanted)) this.select(wanted);
    // Plan de comptes et projets : facultatifs pour consulter, ignorés sans droit.
    this.chart.set(await this.api.listAccounts().catch(() => []));
    this.projects.set(await this.api.listProjects().catch(() => []));
  }
}
