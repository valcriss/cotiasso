import { AsyncPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AdminApiService, type OverviewInfo, type RecentOperationInfo, type TodoItemInfo } from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { HealthService } from '../health.service';
import { OperationLauncher } from '../treasury/operation-launcher';
import { SetupStatus } from './setup-status.service';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { HelpHint } from '../ui/help-hint';
import { PageHeader } from '../ui/page-header';

const SITUATIONS: Record<RecentOperationInfo['situation'], string> = {
  TO_CLASSIFY: 'à classer',
  CLASSIFIED: 'classée, pas encore enregistrée dans les comptes',
  DRAFT: 'en brouillon',
  BOOKED: 'enregistrée dans les comptes',
  TRANSFER: 'déplacement entre vos comptes',
};

const LEVEL_ICONS: Record<TodoItemInfo['level'], string> = { TODO: 'radio_button_unchecked', WARNING: 'warning', INFO: 'info' };

/**
 * Vue d'ensemble (ADR 0028) : l'argent disponible, ce qui s'est passé ce mois-ci et surtout « ce qu'il reste à faire »,
 * chaque tâche renvoyant à l'écran qui la règle. Les deux gestes du quotidien sont ici, en un clic.
 */
@Component({
  selector: 'app-overview-page',
  imports: [HelpHint, FrDatePipe, AsyncPipe, MatButtonModule, MatIconModule, RouterLink, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .figures {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      margin-bottom: 20px;
    }
    .figure {
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      box-shadow: var(--app-shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 20px 28px;
    }
    .figure .big {
      font: var(--mat-sys-headline-medium);
      font-variant-numeric: tabular-nums;
    }
    .figure .in {
      color: var(--app-success, var(--mat-sys-primary));
    }
    .figure .out {
      color: var(--mat-sys-on-surface);
    }
    ul.recent {
      display: flex;
      flex-direction: column;
      list-style: none;
      margin: 0 0 8px;
      padding: 0;
    }
    ul.recent li {
      align-items: center;
      border-top: 1px solid var(--app-border);
      display: flex;
      gap: 16px;
      padding: 10px 0;
    }
    ul.recent li:first-child {
      border-top: 0;
    }
    ul.recent .date {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    ul.recent .text {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
    ul.recent .amount {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    ul.recent .amount.in {
      color: var(--app-success, var(--mat-sys-primary));
    }
    ul.todo {
      display: flex;
      flex-direction: column;
      gap: 0;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ul.todo li {
      align-items: center;
      border-top: 1px solid var(--app-border);
      display: flex;
      gap: 16px;
      padding: 14px 0;
    }
    ul.todo li:first-child {
      border-top: 0;
    }
    ul.todo .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
    }
    ul.todo .warn {
      color: var(--mat-sys-error);
    }
    .accounts-detail {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 20px;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }
    .health {
      align-items: center;
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
  `,
  template: `
    <app-page-header
      title="Vue d’ensemble"
      icon="dashboard"
      description="Le point de départ : l’argent dont dispose l’association, ce qui s’est passé ce mois-ci et ce qu’il vous reste à faire."
    >
      @if (canRecord()) {
        <button mat-flat-button type="button" (click)="record('IN')">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">south_west</mat-icon> J’ai reçu de l’argent
        </button>
        <button mat-flat-button type="button" (click)="record('OUT')">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">north_east</mat-icon> J’ai dépensé de l’argent
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (overview(); as view) {
      @if (needsStart()) {
        <section class="panel" aria-label="Démarrage">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">rocket_launch</mat-icon><span>Commençons par préparer votre association</span></h3>
          <p>
            Quelques minutes suffisent : la période de votre comptabilité, des catégories prêtes à l’emploi (« cotisation », « assurance »…) et
            votre compte bancaire. Vous n’avez besoin d’aucune connaissance en comptabilité.
          </p>
          <a mat-flat-button routerLink="/demarrage"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">arrow_forward</mat-icon> Démarrer</a>
        </section>
      }

      @if (view.cash || view.month) {
        <div class="figures">
          @if (view.cash; as cash) {
            <section class="figure" aria-label="Argent disponible">
              <span class="muted">Argent disponible <app-help-hint term="solde" /></span>
              <span class="big">{{ amount(cash.total) }} €</span>
              <span class="muted">D’après vos enregistrements, pas forcément le solde de la banque</span>
              @if (cash.accounts.length > 1) {
                <ul class="accounts-detail">
                  @for (account of cash.accounts; track account.id) {
                    <li class="muted">{{ account.name }} : {{ amount(account.balance) }} €</li>
                  }
                </ul>
              }
            </section>
          }
          @if (view.month; as month) {
            <section class="figure" aria-label="Reçu ce mois-ci">
              <span class="muted">Reçu ce mois-ci</span>
              <span class="big in">{{ amount(month.received) }} €</span>
              <span class="muted">Argent entré depuis le début du mois</span>
            </section>
            <section class="figure" aria-label="Dépensé ce mois-ci">
              <span class="muted">Dépensé ce mois-ci</span>
              <span class="big out">{{ amount(month.spent) }} €</span>
              <span class="muted">Argent sorti depuis le début du mois</span>
            </section>
          }
        </div>
      }

      @if (view.recent && view.recent.length > 0) {
        <section class="panel" aria-label="Dernières opérations">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">history</mat-icon><span>Dernières opérations</span></h3>
          <ul class="recent">
            @for (operation of view.recent; track operation.id) {
              <li>
                <span class="date">{{ operation.date | frDate }}</span>
                <span class="text">
                  <strong>{{ operation.label }}</strong>
                  <span class="muted">{{ operation.accountName }} · {{ situation(operation) }}</span>
                </span>
                <span class="amount" [class.in]="!operation.amount.startsWith('-')">{{ amount(operation.amount) }} €</span>
              </li>
            }
          </ul>
          <a mat-button routerLink="/comptes">Voir tous les mouvements</a>
        </section>
      }

      <section class="panel" aria-label="À faire">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">checklist</mat-icon><span>À faire</span></h3>
        @if (view.todo.length === 0) {
          <p class="muted">
            Rien à faire pour le moment : tout est à jour. Quand vous recevrez ou dépenserez de l’argent, enregistrez-le avec les boutons
            ci-dessus.
          </p>
        } @else {
          <ul class="todo">
            @for (item of view.todo; track item.code) {
              <li>
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true" [class.warn]="item.level === 'WARNING'">{{ icon(item) }}</mat-icon>
                <span class="text">
                  <strong>{{ item.title }}</strong>
                  <span class="muted">{{ item.detail }}</span>
                </span>
                <a mat-stroked-button [routerLink]="item.link" [queryParams]="item.query" [attr.aria-label]="item.actionLabel + ' : ' + item.title">{{ item.actionLabel }}</a>
              </li>
            }
          </ul>
        }
      </section>
    } @else if (!error()) {
      <p class="muted">Chargement…</p>
    }

    <p class="health muted">
      @switch (status$ | async) {
        @case ('up') {
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">check_circle</mat-icon>
          <span>Serveur et base de données opérationnels</span>
        }
        @case ('degraded') {
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">warning</mat-icon>
          <span>Serveur joignable, base de données indisponible</span>
        }
        @case ('unreachable') {
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">error</mat-icon>
          <span>Serveur injoignable</span>
        }
        @default {
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">hourglass_empty</mat-icon>
          <span>Vérification en cours…</span>
        }
      }
    </p>
  `,
})
export class OverviewPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly launcher = inject(OperationLauncher);
  private readonly setupStatus = inject(SetupStatus);

  protected readonly status$ = inject(HealthService).check();
  protected readonly overview = signal<OverviewInfo | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly canRecord = computed(() => {
    this.auth.permissions();
    return this.auth.can('transactions:manage') && this.auth.can('entries:create');
  });
  /** L'installation n'est pas terminée et la personne a le droit de la terminer. */
  protected readonly needsStart = computed(() => {
    const view = this.overview();
    this.auth.permissions();
    return !!view && this.auth.can('settings.accounting:admin') && Object.values(view.setup).some((done) => !done);
  });

  constructor() {
    void this.load();
  }

  protected amount(value: string): string {
    return formatApiAmount(value);
  }

  /** Où en est l'opération, en mots courants. */
  protected situation(operation: RecentOperationInfo): string {
    return SITUATIONS[operation.situation];
  }

  protected icon(item: TodoItemInfo): string {
    return LEVEL_ICONS[item.level];
  }

  protected async record(direction: 'IN' | 'OUT'): Promise<void> {
    if (await this.launcher.open(direction)) await this.load();
  }

  private async load(): Promise<void> {
    try {
      const overview = await this.api.overview();
      this.overview.set(overview);
      this.setupStatus.set(overview.setup);
      this.error.set(null);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "La vue d'ensemble n'a pas pu être chargée. Rechargez la page dans un instant.").message);
    }
  }
}
