import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
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
  type TransactionBody,
  type TransactionInfo,
} from '../admin/admin-api.service';
import { centsToApi, formatApiAmount, parseAmountToCents } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';

/** Transactions d'un compte : liste filtrable, saisie manuelle et qualification (projet, compte de contrepartie). */
@Component({
  selector: 'app-transactions-panel',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
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
    tr.selected td {
      background: var(--app-surface-muted);
    }
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Transactions de ' + account().name">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">swap_horiz</mat-icon><span>Transactions de {{ account().name }}</span></h3>
        @if (canManage() && !account().archivedOn) {
          <button mat-flat-button type="button" (click)="startNew()">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une transaction
          </button>
        }
      </div>

      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (notice(); as message) {
        <p class="success" role="status">{{ message }}</p>
      }

      @if (editing(); as mode) {
        <form class="panel" [formGroup]="form" (ngSubmit)="save()" novalidate>
          <h3>{{ mode === 'new' ? 'Nouvelle transaction' : 'Modifier la transaction' }}</h3>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Sens</mat-label>
              <mat-select formControlName="direction" [attr.aria-label]="'Sens du mouvement'">
                <mat-option value="in">Encaissement</mat-option>
                <mat-option value="out">Décaissement</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Montant</mat-label>
              <input matInput inputmode="decimal" formControlName="amount" required />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Date d'opération</mat-label>
              <input matInput type="date" formControlName="operationDate" required />
            </mat-form-field>
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Libellé</mat-label>
              <input matInput formControlName="label" required />
            </mat-form-field>
          </div>
          <div class="row">
            <mat-form-field appearance="outline">
              <mat-label>Référence</mat-label>
              <input matInput formControlName="reference" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Projet</mat-label>
              <mat-select formControlName="projectId">
                <mat-option value="">Aucun</mat-option>
                @for (project of projects(); track project.id) {
                  <mat-option [value]="project.id">{{ project.code }} — {{ project.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Compte de contrepartie</mat-label>
              <mat-select formControlName="counterpartAccountId">
                <mat-option value="">À qualifier</mat-option>
                @for (candidate of counterparts(); track candidate.id) {
                  <mat-option [value]="candidate.id">{{ candidate.number }} — {{ candidate.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="busy()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">save</mat-icon> Enregistrer
            </button>
            <button mat-button type="button" (click)="editing.set(null)">Annuler</button>
            @if (mode === 'edit' && selectedManual()) {
              <button mat-button class="danger" type="button" [disabled]="busy()" (click)="remove()">Supprimer</button>
            }
          </div>
        </form>
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
        <p class="muted">Aucune transaction pour ces critères.</p>
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
              <tr [class.selected]="item.id === selectedId()">
                <td>{{ item.operationDate }}</td>
                <td>
                  {{ item.label }}
                  @if (item.origin === 'IMPORT') {
                    <span class="chip">Importée</span>
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
                    <button mat-button type="button" [attr.aria-label]="'Modifier ' + item.label" (click)="edit(item)">Modifier</button>
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

  readonly account = input.required<FinancialAccountInfo>();
  readonly accounts = input<AccountInfo[]>([]);
  readonly projects = input<ProjectInfo[]>([]);
  /** Émis après toute écriture : les soldes du compte ont changé. */
  readonly changed = output<void>();

  protected readonly transactions = signal<TransactionInfo[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly editing = signal<'new' | 'edit' | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly amount = formatApiAmount;

  protected readonly canManage = computed(() => {
    this.auth.permissions();
    return this.auth.can('transactions:manage');
  });
  /** Comptes de contrepartie proposés : tous les comptes actifs sauf le compte de trésorerie lui-même. */
  protected readonly counterparts = computed(() =>
    this.accounts().filter((a) => a.active && a.id !== this.account().accountId),
  );
  protected readonly selectedManual = computed(
    () => this.transactions().find((t) => t.id === this.selectedId())?.origin === 'MANUAL',
  );

  protected readonly filters = this.fb.group({ from: [''], to: [''], q: [''], qualified: [''] });
  protected readonly form = this.fb.group({
    direction: ['in'],
    amount: [''],
    operationDate: [''],
    label: [''],
    reference: [''],
    projectId: [''],
    counterpartAccountId: [''],
  });

  /** Identifiant seul : recharger les soldes du compte ne doit ni vider la liste ni fermer le formulaire en cours. */
  private readonly accountId = computed(() => this.account().id);

  constructor() {
    effect(() => {
      this.accountId();
      // La requête lit d'autres signaux (compte, filtres) : hors suivi, seul le changement de compte relance l'effet.
      untracked(() => {
        this.editing.set(null);
        void this.search();
      });
    });
  }

  protected startNew(): void {
    this.selectedId.set(null);
    this.form.reset({ direction: 'in', amount: '', operationDate: '', label: '', reference: '', projectId: '', counterpartAccountId: '' });
    this.editing.set('new');
  }

  protected edit(item: TransactionInfo): void {
    this.selectedId.set(item.id);
    this.form.reset({
      direction: item.amount.startsWith('-') ? 'out' : 'in',
      amount: item.amount.replace('-', '').replace('.', ','),
      operationDate: item.operationDate,
      label: item.label,
      reference: item.reference ?? '',
      projectId: item.projectId ?? '',
      counterpartAccountId: item.counterpartAccountId ?? '',
    });
    this.editing.set('edit');
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

  protected async save(): Promise<void> {
    const body = this.body();
    if (!body) return;
    const mode = this.editing();
    const current = this.transactions().find((t) => t.id === this.selectedId());
    await this.run(async () => {
      if (mode === 'edit' && current) {
        // Les données financières d'une transaction importée ne changent pas : seule la qualification est envoyée.
        const patch = current.origin === 'IMPORT' ? { projectId: body.projectId, counterpartAccountId: body.counterpartAccountId, label: body.label, reference: body.reference } : body;
        await this.api.updateTransaction(current.id, { ...patch, version: current.version });
        this.notice.set('Transaction enregistrée.');
      } else {
        await this.api.createTransaction(this.account().id, body);
        this.notice.set('Transaction ajoutée.');
      }
      this.editing.set(null);
    });
  }

  protected async remove(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    await this.run(async () => {
      await this.api.deleteTransaction(id);
      this.notice.set('Transaction supprimée.');
      this.editing.set(null);
    });
  }

  /** Corps envoyé à l'API (montant signé selon le sens), ou `null` avec un message si la saisie est invalide. */
  private body(): TransactionBody | null {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    if (cents === null || cents <= 0) {
      this.error.set('Saisissez un montant positif (ex. 12,50) et choisissez le sens du mouvement.');
      return null;
    }
    if (!raw.operationDate || raw.label.trim() === '') {
      this.error.set("Renseignez la date d'opération et le libellé.");
      return null;
    }
    return {
      operationDate: raw.operationDate,
      amount: centsToApi(raw.direction === 'out' ? -cents : cents),
      label: raw.label.trim(),
      reference: raw.reference.trim() === '' ? null : raw.reference.trim(),
      projectId: raw.projectId || null,
      counterpartAccountId: raw.counterpartAccountId || null,
    };
  }

  private query() {
    const { from, to, q, qualified } = this.filters.getRawValue();
    return { ...(from && { from }), ...(to && { to }), ...(q && { q }), ...(qualified && { qualified: qualified as 'true' | 'false' }) };
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      this.changed.emit();
      await this.search();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Opération impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
  }
}
