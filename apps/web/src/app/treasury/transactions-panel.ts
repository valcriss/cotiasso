import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
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
import { TransactionDialog, type TransactionDialogData, type TransactionDialogResult } from './transaction-dialog';

/** Transactions d'un compte : liste filtrable, saisie (boîte de dialogue) et accès à l'import d'un relevé. */
@Component({
  selector: 'app-transactions-panel',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
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
        <table class="table">
          <caption class="sr-only">Transactions</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Libellé</th>
              <th scope="col">Projet</th>
              <th scope="col">Contrepartie</th>
              <th scope="col" class="amount">Montant</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (item of transactions(); track item.id) {
              <tr>
                <td>{{ item.operationDate }}</td>
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
                <td class="amount" [class.negative]="item.amount.startsWith('-')">{{ amount(item.amount) }}</td>
                <td class="row-actions">
                  @if (canManage()) {
                    <button mat-button type="button" [attr.aria-label]="'Modifier ' + item.label" (click)="open(item)">Modifier</button>
                  }
                </td>
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

  readonly account = input.required<FinancialAccountInfo>();
  readonly accounts = input<AccountInfo[]>([]);
  readonly projects = input<ProjectInfo[]>([]);
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
  protected readonly canImport = computed(() => {
    this.auth.permissions();
    return this.auth.can('imports:post');
  });

  protected readonly filters = this.fb.group({ from: [''], to: [''], q: [''], qualified: [''] });

  /** Identifiant seul : recharger les soldes du compte ne doit pas relancer la liste ni perdre les filtres. */
  private readonly accountId = computed(() => this.account().id);

  constructor() {
    effect(() => {
      this.accountId();
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
    const { from, to, q, qualified } = this.filters.getRawValue();
    return { ...(from && { from }), ...(to && { to }), ...(q && { q }), ...(qualified && { qualified: qualified as 'true' | 'false' }) };
  }
}
