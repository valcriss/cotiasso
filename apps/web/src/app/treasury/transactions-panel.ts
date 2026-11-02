import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import {
  AdminApiService,
  type AccountInfo,
  type FinancialAccountInfo,
  type ProjectInfo,
  type TransactionInfo,
} from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { LinkEntryDialog, type LinkEntryDialogData } from './link-entry-dialog';
import { QualifyDialog, type QualifyDialogData } from './qualify-dialog';
import { TransactionDialog, type TransactionDialogData, type TransactionDialogResult } from './transaction-dialog';

/** Transactions d'un compte : liste filtrable, saisie (boîte de dialogue) et accès à l'import d'un relevé. */
@Component({
  selector: 'app-transactions-panel',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .negative {
      color: var(--mat-sys-error);
    }
    .date {
      white-space: nowrap;
    }
    /* Plusieurs actions par ligne : elles passent à la ligne plutôt que d'élargir le tableau. */
    .row-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 4px;
      justify-content: flex-end;
      min-width: 280px;
    }
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Transactions de ' + account().name">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">swap_horiz</mat-icon><span>Transactions de {{ account().name }}</span></h3>
        <div class="actions">
          @if (canImport() && !account().archivedOn) {
            <a mat-stroked-button [routerLink]="['/comptes', account().id, 'import']">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">upload_file</mat-icon> Importer un relevé OFX
            </a>
          }
          @if (canManage() && selectedIds().length > 0) {
            <button mat-stroked-button type="button" (click)="qualifySelection()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">label</mat-icon> Qualifier la sélection ({{ selectedIds().length }})
            </button>
          }
          @if (canManage() && !account().archivedOn) {
            <button mat-flat-button type="button" (click)="open(null)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une transaction
            </button>
          }
        </div>
      </div>

      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }

      <form class="filters" [formGroup]="filters" (ngSubmit)="search()">
        <mat-form-field appearance="outline">
          <mat-label>Du</mat-label>
          <input matInput type="date" formControlName="from" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Au</mat-label>
          <input matInput type="date" formControlName="to" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Libellé ou référence</mat-label>
          <input matInput formControlName="q" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Qualification</mat-label>
          <mat-select formControlName="qualified">
            <mat-option value="">Toutes</mat-option>
            <mat-option value="true">Qualifiées</mat-option>
            <mat-option value="false">À qualifier</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Comptabilisation</mat-label>
          <mat-select formControlName="accounting">
            <mat-option value="">Toutes</mat-option>
            <mat-option value="NONE">À comptabiliser</mat-option>
            <mat-option value="IN_PROGRESS">En cours</mat-option>
            <mat-option value="POSTED">Comptabilisées</mat-option>
          </mat-select>
        </mat-form-field>
        <div class="actions">
          <button mat-flat-button type="submit">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">filter_alt</mat-icon> Filtrer
          </button>
        </div>
      </form>

      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (transactions().length === 0) {
        <p class="muted">
          Aucune transaction pour ces critères.
          @if (canManage() && !account().archivedOn) {
            Ajoutez un mouvement à la main ou importez le relevé de votre banque.
          }
        </p>
      } @else {
        <p class="muted">« Comptabilisée » veut dire qu'une écriture validée enregistre ce mouvement dans les comptes de l'association.</p>
        <table class="table">
          <caption class="sr-only">Transactions</caption>
          <thead>
            <tr>
              @if (canManage()) {
                <th scope="col"><span class="sr-only">Sélection</span></th>
              }
              <th scope="col">Date</th>
              <th scope="col">Libellé</th>
              <th scope="col">Projet</th>
              <th scope="col">Contrepartie</th>
              <th scope="col">Comptabilisation</th>
              <th scope="col" class="amount">Montant</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (item of transactions(); track item.id) {
              <tr>
                @if (canManage()) {
                  <td>
                    <mat-checkbox
                      [checked]="selection().has(item.id)"
                      [attr.aria-label]="'Sélectionner ' + item.label"
                      (change)="select(item.id, $event.checked)"
                    />
                  </td>
                }
                <td class="date">{{ item.operationDate }}</td>
                <td>
                  {{ item.label }}
                  @if (item.bankIdentified) {
                    <span class="chip">{{ item.origin === 'IMPORT' ? 'Importée' : 'Rapprochée du relevé' }}</span>
                  }
                  @if (item.reference) {
                    <div class="muted">Réf. {{ item.reference }}</div>
                  }
                </td>
                <td>{{ item.projectCode ?? '—' }}</td>
                <td>{{ item.counterpartAccountNumber ?? 'À qualifier' }}</td>
                <td>
                  @switch (item.accounting) {
                    @case ('POSTED') {
                      <span class="status ok"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">check_circle</mat-icon> Comptabilisée</span>
                      <div class="muted">{{ item.entry?.journalCode }} n° {{ item.entry?.number }}</div>
                    }
                    @case ('IN_PROGRESS') {
                      <span class="chip">En cours de comptabilisation</span>
                      <div class="muted">Écriture en brouillon</div>
                    }
                    @default {
                      <span class="muted">À comptabiliser</span>
                    }
                  }
                  @if (item.reconciliation?.status === 'VALIDATED') {
                    <div><span class="status ok"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">verified</mat-icon> Rapprochée</span></div>
                  } @else if (item.reconciliation) {
                    <div class="muted">Pointée (rapprochement en cours)</div>
                  }
                  @if (item.transfer; as transfer) {
                    <div class="muted">
                      Virement {{ transfer.direction === 'OUT' ? 'vers' : 'depuis' }} {{ transfer.otherAccountName }}
                    </div>
                  }
                </td>
                <td class="amount" [class.negative]="item.amount.startsWith('-')">{{ amount(item.amount) }}</td>
                <td class="row-actions"><div class="row-buttons">
                  @if (canLink() && item.accounting === 'NONE' && !item.transfer && !account().archivedOn) {
                    <button mat-button type="button" [attr.aria-label]="'Comptabiliser ' + item.label" [disabled]="busy()" (click)="prepare(item)">Comptabiliser</button>
                  }
                  @if (canLink() && item.accounting === 'NONE') {
                    <button mat-button type="button" [attr.aria-label]="'Associer ' + item.label + ' à une écriture'" (click)="link(item)">Associer à une écriture</button>
                  }
                  @if (item.entry && canViewEntries()) {
                    <a mat-button [attr.aria-label]="'Voir l’écriture de ' + item.label" [routerLink]="['/comptabilite/ecritures', item.entry.id]">Voir l'écriture</a>
                  }
                  @if (canCancelOperation() && item.accounting === 'POSTED' && item.entry && !item.transfer && item.reconciliation?.status !== 'VALIDATED') {
                    <button mat-button class="danger" type="button" [attr.aria-label]="'Annuler l’opération ' + item.label" [disabled]="busy()" (click)="cancelOperation(item)">Annuler l’opération</button>
                  }
                  @if (canLink() && item.accounting === 'IN_PROGRESS') {
                    <button mat-button type="button" [attr.aria-label]="'Dissocier ' + item.label" [disabled]="busy()" (click)="unlink(item)">Dissocier</button>
                  }
                  @if (canManage() && item.financialLock === 'TRANSFER' && item.transfer) {
                    <button mat-button class="danger" type="button" [attr.aria-label]="'Annuler le virement ' + item.label" [disabled]="busy()" (click)="cancelTransfer(item)">Annuler le virement</button>
                  }
                  @if (canManage()) {
                    <button mat-button type="button" [attr.aria-label]="'Modifier ' + item.label" (click)="open(item)">Modifier</button>
                  }
                </div></td>
              </tr>
            }
          </tbody>
        </table>
        @if (next()) {
          <div class="more">
            <button mat-stroked-button type="button" [disabled]="loadingMore()" (click)="more()">Charger la suite</button>
          </div>
        }
      }
    </section>
  `,
})
export class TransactionsPanel {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);

  readonly account = input.required<FinancialAccountInfo>();
  readonly accounts = input<AccountInfo[]>([]);
  readonly projects = input<ProjectInfo[]>([]);
  /** Incrémenté par la page quand la liste doit être rechargée de l'extérieur (nouveau virement). */
  readonly reloadKey = input(0);
  /** Émis après toute écriture : les soldes du compte ont changé. */
  readonly changed = output<void>();

  protected readonly transactions = signal<TransactionInfo[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;

  protected readonly canManage = computed(() => {
    this.auth.permissions();
    return this.auth.can('transactions:manage');
  });
  /** Lier une transaction à une écriture demande aussi le droit de saisir des écritures. */
  protected readonly canLink = computed(() => {
    this.auth.permissions();
    return this.auth.can('transactions:manage') && this.auth.can('entries:create');
  });
  /** Annuler une opération enregistrée = contrepasser son écriture : réservé à qui peut comptabiliser. */
  protected readonly canCancelOperation = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:post');
  });
  protected readonly canViewEntries = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:view');
  });
  protected readonly canImport = computed(() => {
    this.auth.permissions();
    return this.auth.can('imports:post');
  });

  protected readonly filters = this.fb.group({ from: [''], to: [''], q: [''], qualified: [''], accounting: [''] });

  /** Identifiant seul : recharger les soldes du compte ne doit pas relancer la liste ni perdre les filtres. */
  private readonly accountId = computed(() => this.account().id);

  constructor() {
    effect(() => {
      this.accountId();
      this.reloadKey();
      // La requête lit d'autres signaux (compte, filtres) : hors suivi, seul le changement de compte relance l'effet.
      untracked(() => void this.search());
    });
  }

  protected async open(item: TransactionInfo | null): Promise<void> {
    const result = await this.dialogs.open<TransactionDialogResult, TransactionDialogData>(TransactionDialog, {
      size: 'md',
      data: { account: this.account(), accounts: this.accounts(), projects: this.projects(), transaction: item },
    });
    if (!result) return;
    this.notifier.success(
      result.kind === 'deleted' ? 'Transaction supprimée.' : item ? 'Transaction enregistrée.' : 'Transaction ajoutée.',
    );
    this.changed.emit();
    await this.search();
  }

  protected readonly busy = signal(false);
  /** Transactions cochées pour une qualification en masse. */
  protected readonly selection = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedIds = computed(() => [...this.selection()]);

  protected select(id: string, checked: boolean): void {
    this.selection.update((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Applique un compte de contrepartie et/ou un projet à toutes les transactions cochées. */
  protected async qualifySelection(): Promise<void> {
    const result = await this.dialogs.open<{ updated: number }, QualifyDialogData>(QualifyDialog, {
      size: 'md',
      data: { account: this.account(), accounts: this.accounts(), projects: this.projects(), transactionIds: this.selectedIds() },
    });
    if (!result) return;
    this.notifier.success(`${result.updated} transaction(s) qualifiée(s).`);
    this.selection.set(new Set());
    await this.search();
  }

  /** Prépare le brouillon d'écriture de la transaction, puis l'ouvre pour qu'on le relise. */
  protected async prepare(item: TransactionInfo): Promise<void> {
    await this.run(async () => {
      const { entryId } = await this.api.prepareTransactionEntry(item.id);
      this.notifier.success("Brouillon d'écriture préparé : relisez-le, puis comptabilisez-le.");
      await this.router.navigate(['/comptabilite/ecritures', entryId]);
    }, "Le brouillon n'a pas pu être préparé.");
  }

  /** « Annuler l'opération » : contrepasse l'écriture, après avoir dit ce que cela change et que l'historique est conservé. */
  protected async cancelOperation(item: TransactionInfo): Promise<void> {
    if (!item.entry) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Annuler cette opération ?',
      message: `« ${item.label} » ne comptera plus dans vos comptes : une opération inverse est ajoutée et rien n'est effacé, l'historique reste lisible. Le mouvement d'argent reste sur le compte et redevient « à comptabiliser » : vous pourrez le classer de nouveau correctement.`,
      confirmLabel: 'Annuler l’opération',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.reverseEntry(item.entry!.id);
      this.notifier.success("Opération annulée : l'écriture inverse a été ajoutée.");
      await this.search();
      this.changed.emit();
    }, "L'opération n'a pas pu être annulée.");
  }

  protected async link(item: TransactionInfo): Promise<void> {
    const linked = await this.dialogs.open<TransactionInfo, LinkEntryDialogData>(LinkEntryDialog, { size: 'md', data: { transaction: item } });
    if (!linked) return;
    this.notifier.success('Transaction associée à l’écriture.');
    await this.search();
  }

  protected async unlink(item: TransactionInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Dissocier cette transaction de son écriture ?',
      message: `« ${item.label} » redevient « à comptabiliser ». L'écriture en brouillon n'est pas supprimée : vous pourrez la modifier, la supprimer ou la réassocier.`,
      confirmLabel: 'Dissocier',
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.unlinkTransactionEntry(item.id);
      this.notifier.success('Transaction dissociée.');
      await this.search();
    }, "La transaction n'a pas pu être dissociée.");
  }

  protected async cancelTransfer(item: TransactionInfo): Promise<void> {
    if (!item.transfer) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Annuler ce virement ?',
      message: `Les deux mouvements du virement (ici et sur ${item.transfer.otherAccountName}) seront supprimés. Vous pourrez refaire le virement si vous vous êtes trompé.`,
      confirmLabel: 'Annuler le virement',
      cancelLabel: 'Garder',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.cancelTransfer(item.transfer!.id);
      this.notifier.success('Virement annulé.');
      this.changed.emit();
      await this.search();
    }, "Le virement n'a pas pu être annulé.");
  }

  private async run(action: () => Promise<void>, fallback: string): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      this.error.set(describeHttpError(failure, fallback).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async search(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.listTransactions(this.account().id, this.query());
      this.transactions.set(page.transactions);
      this.next.set(page.next);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les transactions.').message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async more(): Promise<void> {
    const after = this.next();
    if (!after) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.listTransactions(this.account().id, { ...this.query(), after });
      this.transactions.update((current) => [...current, ...page.transactions]);
      this.next.set(page.next);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la suite.').message);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private query() {
    const { from, to, q, qualified, accounting } = this.filters.getRawValue();
    return {
      ...(from && { from }),
      ...(to && { to }),
      ...(q && { q }),
      ...(qualified && { qualified: qualified as 'true' | 'false' }),
      ...(accounting && { accounting: accounting as 'NONE' | 'IN_PROGRESS' | 'POSTED' }),
    };
  }
}
