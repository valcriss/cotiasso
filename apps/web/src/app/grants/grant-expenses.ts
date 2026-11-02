import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type GrantExpenseInfo, type GrantExpensesInfo, type GrantInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { GrantExpenseCancelDialog, GrantExpenseDialog } from './grant-expense-dialogs';

/**
 * Dépenses affectées à une subvention : les dépenses déjà comptabilisées que la subvention prend en charge. C'est un suivi pour
 * le compte rendu, pas de la comptabilité. Un dépassement du montant accordé ou une dépense hors période est signalé, pas bloqué.
 */
@Component({
  selector: 'app-grant-expenses',
  imports: [MatButtonModule, MatIconModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .note {
      display: block;
      font-size: 0.85em;
      color: var(--mat-sys-on-surface-variant);
    }
    .figures {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 32px;
      margin: 8px 0 16px;
      font-variant-numeric: tabular-nums;
    }
    .figures div {
      display: flex;
      flex-direction: column;
    }
    .figures dt {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85em;
    }
    .figures dd {
      margin: 0;
      font-size: 1.15em;
      font-weight: 500;
    }
    .warnings {
      margin: 8px 0;
      padding-left: 20px;
    }
    tr.cancelled td {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    tr.cancelled td.row-actions {
      text-decoration: none;
    }
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Dépenses affectées à ' + grant().title">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">receipt</mat-icon><span>Dépenses affectées</span></h3>
        <div class="actions">
          @if (editable()) {
            <button mat-flat-button type="button" (click)="attach()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Affecter une dépense
            </button>
          }
        </div>
      </div>
      <p class="muted">
        Les dépenses payées avec cette subvention : vous affectez une part d'une dépense <strong>déjà comptabilisée</strong>, d'un des
        projets financés. Cela sert au compte rendu pour le financeur et ne crée aucune écriture.
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (data(); as info) {
        <dl class="figures">
          <div><dt>Accordé</dt><dd>{{ amount(info.granted) }} €</dd></div>
          <div><dt>Dépenses affectées</dt><dd>{{ amount(info.spent) }} €</dd></div>
          <div>
            <dt>{{ info.overGranted ? 'Au-delà du montant accordé' : 'Encore affectable' }}</dt>
            <dd>{{ info.overGranted ? amount(info.overBy) : amount(left(info)) }} €</dd>
          </div>
        </dl>
        @if (info.warnings.length > 0) {
          <ul class="warnings" aria-label="À savoir">
            @for (warning of info.warnings; track warning) {
              <li>{{ warning }}</li>
            }
          </ul>
        }
        <table class="table">
          <caption class="sr-only">Dépenses affectées</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Dépense</th>
              <th scope="col">Projet</th>
              <th scope="col" class="amount">Part affectée</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (expense of info.expenses; track expense.id) {
              <tr [class.cancelled]="expense.cancelled || expense.reversed">
                <td>{{ expense.entry.date }}</td>
                <td>
                  {{ expense.entry.label ?? 'Écriture ' + expense.entry.journalCode + (expense.entry.number === null ? '' : ' n° ' + expense.entry.number) }}
                  <span class="note">{{ expense.account.number }} — {{ expense.account.label }}</span>
                  @if (expense.coFinancingReason) {
                    <span class="note">Cofinancement : {{ expense.coFinancingReason }}</span>
                  }
                  @if (expense.cancelled) {
                    <span class="note">Annulée : {{ expense.cancelReason }}</span>
                  }
                  @if (expense.counted && expense.outOfPeriod) {
                    <span class="chip">Hors période financée</span>
                  }
                  @if (expense.reversed && !expense.cancelled) {
                    <span class="chip">Écriture annulée : ne compte plus</span>
                  }
                </td>
                <td>{{ expense.project.code }}</td>
                <td class="amount">{{ amount(expense.amount) }}</td>
                <td class="row-actions">
                  @if (editable() && !expense.cancelled) {
                    <button mat-button type="button" [attr.aria-label]="'Annuler l\\'affectation du ' + expense.entry.date" (click)="cancel(expense)">Annuler</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">
                  @if (editable()) {
                    Aucune dépense affectée pour l'instant. Cliquez sur « Affecter une dépense » pour rattacher une dépense déjà comptabilisée.
                  } @else {
                    Aucune dépense n'est affectée à cette subvention.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class GrantExpenses {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  readonly grant = input.required<GrantInfo>();
  readonly canManage = input(false);
  /** Émis quand une affectation change : le compte rendu se recharge. */
  readonly changed = output<void>();

  protected readonly data = signal<GrantExpensesInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = (value: string | null) => (value === null ? '—' : formatApiAmount(value));
  /** Affecter une dépense lit des écritures comptables : il faut aussi pouvoir les consulter. */
  protected readonly editable = computed(() => {
    this.auth.permissions();
    return this.canManage() && this.grant().status === 'GRANTED' && this.auth.can('entries:view');
  });

  constructor() {
    effect(() => {
      const id = this.grant().id;
      untracked(() => void this.load(id));
    });
  }

  protected left(info: GrantExpensesInfo): string | null {
    if (info.granted === null) return null;
    const cents = Math.max(0, Math.round(Number(info.granted) * 100) - Math.round(Number(info.spent) * 100));
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  }

  protected async attach(): Promise<void> {
    const saved = await this.dialogs.open<GrantExpensesInfo>(GrantExpenseDialog, { size: 'lg', data: { grant: this.grant() } });
    if (saved) this.done(saved, 'Dépense affectée.');
  }

  protected async cancel(expense: GrantExpenseInfo): Promise<void> {
    const saved = await this.dialogs.open<GrantExpensesInfo>(GrantExpenseCancelDialog, { size: 'md', data: { expenseId: expense.id } });
    if (saved) this.done(saved, 'Affectation annulée.');
  }

  private done(info: GrantExpensesInfo, message: string): void {
    this.data.set(info);
    this.notifier.success(message);
    this.changed.emit();
  }

  private async load(grantId: string): Promise<void> {
    this.error.set(null);
    try {
      this.data.set(await this.api.grantExpenses(grantId));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les dépenses affectées.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
