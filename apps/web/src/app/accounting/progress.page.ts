import { formatEuroAmount } from './amount';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AdminApiService, type ProgressAccount, type ProgressAnomaly, type ProgressAnomalyLevel, type ProgressYear, type RecoveryProgressInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';

const LEVELS: Record<ProgressAnomalyLevel, { label: string; icon: string }> = {
  BLOCKING: { label: 'Bloquant', icon: 'block' },
  TODO: { label: 'À faire', icon: 'pending_actions' },
  WARNING: { label: 'À vérifier', icon: 'warning' },
  INFO: { label: 'Pour information', icon: 'info' },
};
const LEVEL_ORDER: ProgressAnomalyLevel[] = ['BLOCKING', 'TODO', 'WARNING', 'INFO'];
const YEAR_STATUS = { OPEN: 'Ouvert', CLOSING: 'Fermé à la saisie', CLOSED: 'Clôturé' } as const;
const OPENING_LABELS = {
  NOT_NEEDED: 'Aucun (compte ouvert à zéro)',
  TO_PREPARE: 'À expliquer',
  DRAFT: 'Brouillon à comptabiliser',
  POSTED: 'Comptabilisé',
  REVERSED: 'Contrepassé',
} as const;

/**
 * Tableau de progression de la reprise (ADR 0027) : où en est-on, exercice par exercice et compte par compte, de la
 * chaîne mouvement → qualifié → brouillon → comptabilisé → rapproché, et que reste-t-il à régler. Lecture seule.
 */
@Component({
  selector: 'app-progress-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, RouterLink, ActionBar],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    progress {
      accent-color: var(--mat-sys-primary);
      height: 12px;
      max-width: 360px;
      vertical-align: middle;
      width: 100%;
    }
    .num {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .anomalies {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
    }
    .anomalies li {
      border-top: 1px solid var(--app-border);
      display: grid;
      gap: 4px 12px;
      grid-template-columns: auto 1fr auto;
      padding: 10px 0;
    }
    .anomalies .level {
      align-items: center;
      display: inline-flex;
      gap: 4px;
      white-space: nowrap;
    }
    .anomalies .details {
      grid-column: 2 / -1;
      margin: 0;
      padding-left: 18px;
    }
  `,
  template: `
    <app-action-bar
      label="Actions de la progression"
      description="Où en est la reprise de l'historique, exercice par exercice : mouvements importés, qualifiés, préparés en brouillon, comptabilisés puis rapprochés de la banque. Ce tableau ne modifie rien : il montre l'état actuel et ce qu'il reste à faire."
    >
      <button mat-stroked-button type="button" [disabled]="loading()" (click)="load()">
        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">refresh</mat-icon> Actualiser
      </button>
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading() && !report()) {
      <p class="muted">Chargement…</p>
    } @else if (report(); as data) {
      @if (data.years.length === 0) {
        <section class="panel">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">checklist</mat-icon><span>Aucun exercice</span></h3>
          <p>
            La progression se mesure par exercice. Commencez par créer vos exercices dans Paramètres › Comptabilité, puis
            importez vos relevés depuis la page <a routerLink="/comptes">Comptes</a>.
          </p>
        </section>
      }
      @for (year of data.years; track year.fiscalYear.id) {
        <section class="panel" [attr.aria-label]="'Exercice ' + year.fiscalYear.label">
          <h3>
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">event</mat-icon>
            <span>Exercice {{ year.fiscalYear.label }}</span>
          </h3>
          <p class="muted">
            Du {{ year.fiscalYear.start | date: 'dd/MM/yyyy' }} au {{ year.fiscalYear.end | date: 'dd/MM/yyyy' }} ·
            {{ yearStatus(year.fiscalYear.status) }}
          </p>

          @if (year.accounts.length === 0) {
            <p>
              Aucun compte bancaire ou caisse n'existe pour cet exercice. Créez-en un depuis la page
              <a routerLink="/comptes">Comptes</a> : c'est là que s'importent les relevés.
            </p>
          } @else {
            @if (year.totals.total === 0) {
              <p>
                Aucun mouvement n'est enregistré sur cet exercice pour l'instant. Importez un relevé (fichier OFX) ou saisissez les
                mouvements depuis la page <a routerLink="/comptes">Comptes</a>.
              </p>
            } @else {
              <p>
                <progress [value]="year.totals.posted" [max]="year.totals.total" [attr.aria-label]="'Avancement de l’exercice ' + year.fiscalYear.label"></progress>
                <strong class="num"> {{ year.totals.percent }} %</strong>
                <span class="muted"> · {{ year.totals.posted }} mouvement(s) comptabilisé(s) sur {{ year.totals.total }}</span>
              </p>
            }
            @if (year.complete) {
              <p class="success" role="status">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">check_circle</mat-icon>
                Cet exercice est entièrement repris : plus rien à faire ni à vérifier.
              </p>
            }

            <table class="table">
              <caption class="sr-only">Avancement par compte pour l'exercice {{ year.fiscalYear.label }}</caption>
              <thead>
                <tr>
                  <th scope="col">Compte</th>
                  <th scope="col">Mouvements</th>
                  <th scope="col">Qualifiés <small class="muted">(à quoi ça correspond)</small></th>
                  <th scope="col">Brouillons <small class="muted">(écriture préparée)</small></th>
                  <th scope="col">Comptabilisés <small class="muted">(écriture validée)</small></th>
                  <th scope="col">Rapprochés <small class="muted">(vérifiés avec la banque)</small></th>
                  <th scope="col">Solde d'ouverture</th>
                </tr>
              </thead>
              <tbody>
                @for (account of year.accounts; track account.financialAccountId) {
                  <tr>
                    <th scope="row">{{ account.name }}</th>
                    <td class="num">{{ account.total }}</td>
                    <td class="num">{{ account.qualified }} / {{ account.total }}</td>
                    <td class="num">{{ account.drafted }} / {{ account.total }}</td>
                    <td class="num">
                      {{ account.posted }} / {{ account.total }}
                      @if (account.percent !== null) {
                        <span class="muted"> ({{ account.percent }} %)</span>
                      }
                    </td>
                    <td class="num">
                      {{ account.reconciled }} / {{ account.total }}
                      <div class="muted">{{ bankControl(account) }}</div>
                    </td>
                    <td>{{ openingLabel(account) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }

          @if (year.anomalies.length > 0) {
            <h4>Ce qu'il reste à régler</h4>
            <ul class="anomalies">
              @for (anomaly of sorted(year.anomalies); track $index) {
                <li>
                  <span class="level"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ level(anomaly).icon }}</mat-icon>{{ level(anomaly).label }}</span>
                  <span>{{ anomaly.message }}</span>
                  <span>
                    @if (fixLink(anomaly); as link) {
                      <a mat-stroked-button [routerLink]="link.path">{{ link.label }}</a>
                    }
                  </span>
                  @if (anomaly.details && anomaly.details.length > 0) {
                    <ul class="details">
                      @for (detail of anomaly.details; track detail.entryId) {
                        <li>
                          <a [routerLink]="['/comptabilite/ecritures', detail.entryId]">{{ detail.label }}</a>
                          <span class="muted"> ({{ detail.date | date: 'dd/MM/yyyy' }}) : {{ detail.messages.join(' ') }}</span>
                        </li>
                      }
                    </ul>
                  }
                </li>
              }
            </ul>
            @if (year.draftAnalysisLimited) {
              <p class="muted">Beaucoup de brouillons : seuls les premiers ont été examinés pour trouver ceux qui sont bloqués.</p>
            }
          }
        </section>
      }
    }
  `,
})
export class ProgressPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);

  protected readonly report = signal<RecoveryProgressInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.report.set(await this.api.recoveryProgress());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la progression de la reprise.').message);
    } finally {
      this.loading.set(false);
    }
  }

  protected yearStatus(status: ProgressYear['fiscalYear']['status']): string {
    return YEAR_STATUS[status];
  }

  protected level(anomaly: ProgressAnomaly) {
    return LEVELS[anomaly.level];
  }

  /** Du plus urgent au moins urgent, en gardant l'ordre du serveur à niveau égal. */
  protected sorted(anomalies: ProgressAnomaly[]): ProgressAnomaly[] {
    return [...anomalies].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
  }

  protected openingLabel(account: ProgressAccount): string {
    if (!account.opening) return '—';
    return account.opening.state === 'NOT_NEEDED' ? OPENING_LABELS.NOT_NEEDED : `${OPENING_LABELS[account.opening.state]} (${formatEuroAmount(account.opening.amount)})`;
  }

  protected bankControl(account: ProgressAccount): string {
    const date = (iso: string) => iso.split('-').reverse().join('/');
    if (account.reconciledUntil) return `Rapproché jusqu'au ${date(account.reconciledUntil)}`;
    if (account.statementUntil) return `Relevé saisi jusqu'au ${date(account.statementUntil)}`;
    return 'Aucun relevé saisi';
  }

  /** Lien vers l'écran qui règle l'anomalie, seulement si la personne a le droit d'y aller. */
  protected fixLink(anomaly: ProgressAnomaly): { path: string | string[]; label: string } | null {
    switch (anomaly.fix) {
      case 'TRANSACTIONS':
        return this.auth.can('financial-accounts:view') ? { path: '/comptes', label: 'Voir les mouvements' } : null;
      case 'RECOVERY':
        return { path: '/comptabilite/reprise', label: 'Ouvrir la reprise' };
      case 'RECONCILIATION':
        return anomaly.financialAccountId && this.auth.can('financial-accounts:view')
          ? { path: ['/comptes', anomaly.financialAccountId, 'rapprochement'], label: 'Rapprocher' }
          : null;
      case 'THIRD_PARTIES':
        return { path: '/comptabilite/tiers', label: 'Voir les tiers' };
      case 'DOCUMENTS':
        return this.auth.can('documents:view') ? { path: '/documents', label: 'Ouvrir les documents' } : null;
      default:
        return null; // « ENTRY » : chaque brouillon a son propre lien dans le détail
    }
  }
}
