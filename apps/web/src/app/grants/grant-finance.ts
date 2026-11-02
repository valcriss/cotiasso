import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type GrantFinanceInfo, type GrantInfo, type GrantScheduleInfo, type ScheduleState } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { GrantPaymentCancelDialog, GrantPaymentDialog, ScheduleDialog } from './grant-finance-dialogs';

const STATE_LABELS: Record<ScheduleState, string> = { PENDING: 'Attendu', PARTIAL: 'Partiellement reçu', RECEIVED: 'Reçu' };

/**
 * Échéancier et versements reçus d'une subvention accordée : ce qui est attendu du financeur, et ce qui est réellement arrivé
 * sur le compte. L'attribution et le versement ne se confondent pas. Aucune écriture comptable.
 */
@Component({
  selector: 'app-grant-finance',
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
    tr.cancelled td {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    tr.cancelled td.row-actions {
      text-decoration: none;
    }
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Versements de ' + grant().title">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">savings</mat-icon><span>Échéancier et versements</span></h3>
        <div class="actions">
          @if (editable()) {
            <button mat-stroked-button type="button" (click)="addLine()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">event</mat-icon> Ajouter une échéance
            </button>
            <button mat-flat-button type="button" (click)="addPayment()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add_card</mat-icon> Enregistrer un versement reçu
            </button>
          }
        </div>
      </div>
      <p class="muted">
        Le montant <strong>accordé</strong> est la décision du financeur ; un <strong>versement</strong> est de l'argent arrivé sur votre
        compte. Prévoyez les versements attendus (échéances), puis rattachez chaque encaissement reçu. Rien n'est écrit dans la comptabilité.
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (finance(); as data) {
        <dl class="figures">
          <div><dt>Accordé</dt><dd>{{ amount(data.granted) }} €</dd></div>
          <div><dt>Prévu en échéances</dt><dd>{{ amount(data.planned) }} €</dd></div>
          <div><dt>Reçu</dt><dd>{{ amount(data.received) }} €</dd></div>
          <div>
            <dt>{{ data.overReceived ? 'Reçu en trop' : 'Reste à recevoir' }}</dt>
            <dd>{{ data.overReceived ? amount(over(data)) : amount(data.remaining) }} €</dd>
          </div>
        </dl>
        @if (data.overReceived) {
          <p class="alert" role="alert">
            Le financeur a versé plus que le montant accordé. Vérifiez les versements rattachés : ce trop-perçu est signalé, pas masqué.
          </p>
        }

        <table class="table">
          <caption class="sr-only">Échéances</caption>
          <thead>
            <tr>
              <th scope="col">Date prévue</th>
              <th scope="col">Condition</th>
              <th scope="col" class="amount">Attendu</th>
              <th scope="col" class="amount">Reçu</th>
              <th scope="col">État</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (line of data.schedule; track line.id) {
              <tr>
                <td>{{ line.dueOn }}</td>
                <td>{{ line.condition || '—' }}</td>
                <td class="amount">{{ amount(line.amount) }}</td>
                <td class="amount">{{ amount(line.received) }}</td>
                <td>
                  <span class="chip">{{ stateLabel(line.state) }}</span>
                  @if (line.overdue) {
                    <span class="chip">En retard</span>
                  }
                </td>
                <td class="row-actions">
                  @if (editable()) {
                    <button mat-button type="button" [attr.aria-label]="'Modifier l\\'échéance du ' + line.dueOn" (click)="editLine(line)">Modifier</button>
                    @if (line.state === 'PENDING') {
                      <button mat-button type="button" [attr.aria-label]="'Retirer l\\'échéance du ' + line.dueOn" (click)="removeLine(line)">Retirer</button>
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="muted">
                  @if (editable()) {
                    Aucune échéance prévue. Ajoutez les versements que vous attendez, avec leur date : {{ amount(data.unplanned) }} € restent à planifier.
                  } @else {
                    Aucune échéance n'a été prévue.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        <table class="table">
          <caption class="sr-only">Versements reçus</caption>
          <thead>
            <tr>
              <th scope="col">Date de l'encaissement</th>
              <th scope="col">Échéance réglée</th>
              <th scope="col" class="amount">Montant reçu</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (payment of data.payments; track payment.id) {
              <tr [class.cancelled]="payment.cancelled">
                <td>
                  {{ payment.operationDate }}
                  @if (payment.note) {
                    <span class="note">{{ payment.note }}</span>
                  }
                  @if (payment.cancelled) {
                    <span class="note">Annulé : {{ payment.cancelReason }}</span>
                  }
                </td>
                <td>{{ lineLabel(data.schedule, payment.scheduleId) }}</td>
                <td class="amount">{{ amount(payment.amount) }}</td>
                <td class="row-actions">
                  @if (editable() && !payment.cancelled) {
                    <button mat-button type="button" [attr.aria-label]="'Annuler le versement du ' + payment.operationDate" (click)="cancelPayment(payment.id)">Annuler</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="muted">
                  @if (editable()) {
                    Aucun versement reçu pour l'instant. Quand le financeur verse, cliquez sur « Enregistrer un versement reçu ».
                  } @else {
                    Aucun versement n'a été reçu.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!editable() && grant().status === 'CLOSED') {
          <p class="muted">Cette subvention est clôturée : son échéancier et ses versements ne changent plus.</p>
        }
      }
    </section>
  `,
})
export class GrantFinance {
  private readonly api = inject(AdminApiService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  readonly grant = input.required<GrantInfo>();
  /** Droit de modifier (`grants:manage`) ; l'échéancier ne se modifie en plus que tant que la subvention est accordée. */
  readonly canManage = input(false);
  /** Émis quand un versement ou une échéance change : la liste des subventions se recharge. */
  readonly changed = output<void>();

  protected readonly finance = signal<GrantFinanceInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = (value: string | null) => (value === null ? '—' : formatApiAmount(value));
  protected readonly editable = computed(() => this.canManage() && this.grant().status === 'GRANTED');

  constructor() {
    effect(() => {
      const id = this.grant().id;
      untracked(() => void this.load(id));
    });
  }

  protected stateLabel(state: ScheduleState): string {
    return STATE_LABELS[state];
  }

  protected over(data: GrantFinanceInfo): string {
    return data.remaining?.replace(/^-/, '') ?? '0.00';
  }

  protected lineLabel(schedule: GrantScheduleInfo[], id: string | null): string {
    const line = schedule.find((l) => l.id === id);
    return line ? `${line.dueOn} — ${formatApiAmount(line.amount)} €` : '—';
  }

  protected async addLine(): Promise<void> {
    const saved = await this.dialogs.open<GrantFinanceInfo>(ScheduleDialog, {
      size: 'md',
      data: { grant: this.grant(), line: null, unplanned: this.finance()?.unplanned ?? '0.00' },
    });
    if (saved) await this.done(saved, 'Échéance ajoutée.');
  }

  protected async editLine(line: GrantScheduleInfo): Promise<void> {
    const saved = await this.dialogs.open<GrantFinanceInfo>(ScheduleDialog, {
      size: 'md',
      data: { grant: this.grant(), line, unplanned: this.finance()?.unplanned ?? '0.00' },
    });
    if (saved) await this.done(saved, 'Échéance enregistrée.');
  }

  protected async removeLine(line: GrantScheduleInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: "Retirer cette échéance ?",
      message: `L'échéance du ${line.dueOn} (${formatApiAmount(line.amount)} €) sera retirée du plan. Aucun versement n'y est rattaché, et le montant accordé ne change pas.`,
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.done(await this.api.removeGrantSchedule(line.id), 'Échéance retirée.');
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'échéance n'a pas pu être retirée. Réessayez dans un instant.").message);
    }
  }

  protected async addPayment(): Promise<void> {
    const saved = await this.dialogs.open<GrantFinanceInfo>(GrantPaymentDialog, {
      size: 'md',
      data: { grant: this.grant(), schedule: this.finance()?.schedule ?? [] },
    });
    if (saved) await this.done(saved, 'Versement enregistré.');
  }

  protected async cancelPayment(paymentId: string): Promise<void> {
    const saved = await this.dialogs.open<GrantFinanceInfo>(GrantPaymentCancelDialog, { size: 'md', data: { paymentId } });
    if (saved) await this.done(saved, 'Versement annulé.');
  }

  private async done(finance: GrantFinanceInfo, message: string): Promise<void> {
    this.finance.set(finance);
    this.notifier.success(message);
    this.changed.emit();
  }

  private async load(grantId: string): Promise<void> {
    this.error.set(null);
    try {
      this.finance.set(await this.api.grantFinance(grantId));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Impossible de charger l'échéancier et les versements.").message);
    } finally {
      this.loading.set(false);
    }
  }
}
