import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type GrantInfo, type GrantReportInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { ExportLink } from '../reports/export-link';
import { formatDate } from '../ui/dates';
import { FrDatePipe } from '../ui/fr-date.pipe';

/**
 * Compte rendu pour le financeur : dépenses affectées regroupées par poste, versements reçus et reliquat, sur une période.
 * Un modèle générique, imprimable et exportable en CSV ; les modèles propres à chaque financeur viendront avec des conventions
 * réelles. Le reliquat (reçu − dépenses affectées) est un suivi : aucune écriture comptable.
 */
@Component({
  selector: 'app-grant-report',
  imports: [FrDatePipe, ExportLink, MatIconModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .periods {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: end;
      margin: 8px 0 16px;
    }
    .periods label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.9em;
    }
    .periods input {
      font: inherit;
      padding: 8px;
      border: 1px solid var(--app-border);
      border-radius: 4px;
      background: var(--app-surface);
      color: inherit;
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
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Compte rendu de ' + grant().title">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">summarize</mat-icon><span>Compte rendu pour le financeur</span></h3>
        <div class="actions">
          @if (report()) {
            <app-export-link [base]="'/api/grants/' + grant().id + '/report/csv'" [params]="{ from: from(), to: to() }" [print]="true" />
          }
        </div>
      </div>
      <p class="muted">
        Ce que le financeur demande en général : les dépenses payées avec la subvention, par poste, les sommes reçues et ce qu'il reste. Choisissez la
        période du compte rendu, puis imprimez-le ou exportez-le.
      </p>
      <div class="periods">
        <label>
          Du
          <input type="date" [value]="from()" (change)="setFrom($any($event.target).value)" aria-label="Début de la période" />
        </label>
        <label>
          Au
          <input type="date" [value]="to()" (change)="setTo($any($event.target).value)" aria-label="Fin de la période" />
        </label>
      </div>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (report(); as data) {
        <p class="muted">
          {{ data.grant.title }} — {{ data.grant.funder }}{{ data.grant.reference ? ' (réf. ' + data.grant.reference + ')' : '' }}.
          Période financée : {{ financed(data) }}.
        </p>
        <dl class="figures">
          <div><dt>Montant accordé</dt><dd>{{ amount(data.granted) }} €</dd></div>
          <div><dt>Dépenses affectées</dt><dd>{{ amount(data.spent) }} €</dd></div>
          <div><dt>Versements reçus</dt><dd>{{ amount(data.received) }} €</dd></div>
          <div><dt>Reliquat (reçu − dépenses)</dt><dd>{{ amount(data.residual) }} €</dd></div>
        </dl>
        @if (data.warnings.length > 0) {
          <ul class="warnings" aria-label="À savoir">
            @for (warning of data.warnings; track warning) {
              <li>{{ warning }}</li>
            }
          </ul>
        }
        @if (data.coFinancingReasons.length > 0) {
          <p class="muted"><strong>Cofinancement :</strong> {{ data.coFinancingReasons.join(' · ') }}</p>
        }
        <table class="table">
          <caption class="sr-only">Dépenses affectées par poste</caption>
          <thead>
            <tr>
              <th scope="col">Poste de dépense</th>
              <th scope="col" class="amount">Dépenses</th>
              <th scope="col" class="amount">Montant</th>
            </tr>
          </thead>
          <tbody>
            @for (group of data.groups; track group.accountNumber) {
              <tr>
                <td>{{ group.accountNumber }} — {{ group.accountLabel }}</td>
                <td class="amount">{{ group.count }}</td>
                <td class="amount">{{ amount(group.amount) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="muted">Aucune dépense affectée sur cette période.</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td>Total des dépenses affectées</td>
              <td></td>
              <td class="amount">{{ amount(data.spent) }}</td>
            </tr>
          </tfoot>
        </table>
        <table class="table">
          <caption class="sr-only">Versements reçus</caption>
          <thead>
            <tr>
              <th scope="col">Versement reçu le</th>
              <th scope="col" class="amount">Montant</th>
            </tr>
          </thead>
          <tbody>
            @for (payment of data.payments; track $index) {
              <tr>
                <td>{{ payment.operationDate | frDate }}</td>
                <td class="amount">{{ amount(payment.amount) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="2" class="muted">Aucun versement reçu sur cette période.</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td>Total reçu</td>
              <td class="amount">{{ amount(data.received) }}</td>
            </tr>
          </tfoot>
        </table>
      }
    </section>
  `,
})
export class GrantReport {
  private readonly api = inject(AdminApiService);

  readonly grant = input.required<GrantInfo>();
  /** Change quand une affectation ou un versement change : le compte rendu se recharge. */
  readonly refreshKey = input(0);

  protected readonly report = signal<GrantReportInfo | null>(null);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = (value: string | null) => (value === null ? '—' : formatApiAmount(value));

  constructor() {
    effect(() => {
      const grant = this.grant();
      this.refreshKey();
      untracked(() => {
        // La période du compte rendu part de la période financée ; l'utilisateur peut la changer.
        if (this.from() === '' && this.to() === '') {
          this.from.set(grant.periodStart ?? '');
          this.to.set(grant.periodEnd ?? '');
        }
        void this.load(grant.id);
      });
    });
  }

  protected financed(data: GrantReportInfo): string {
    const { periodStart, periodEnd } = data.grant;
    return periodStart || periodEnd ? `du ${periodStart ? formatDate(periodStart) : '…'} au ${periodEnd ? formatDate(periodEnd) : '…'}` : 'non précisée';
  }

  protected setFrom(value: string): void {
    this.from.set(value);
    void this.load(this.grant().id);
  }

  protected setTo(value: string): void {
    this.to.set(value);
    void this.load(this.grant().id);
  }

  private async load(grantId: string): Promise<void> {
    this.error.set(null);
    try {
      this.report.set(await this.api.grantReport(grantId, { from: this.from(), to: this.to() }));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger le compte rendu.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
