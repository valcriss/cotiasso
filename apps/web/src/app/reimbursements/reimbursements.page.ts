import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { Notifier } from '../ui/notifier.service';
import { PageHeader } from '../ui/page-header';
import { Skeleton } from '../ui/skeleton';
import { TabsMenu } from '../ui/tabs-menu';
import { DetailDialog, type DetailDialogData } from './detail-dialog';
import { euros, STATUS_LABELS } from './reimbursement-labels';
import { RequestDialog, type RequestDialogData } from './request-dialog';
import { ReimbursementsApi, type ReimbursementInfo, type ReimbursementListItem, type ReimbursementStatusInfo } from './reimbursements-api';

type Tab = 'mes-demandes' | 'a-traiter' | 'toutes';

/** Remboursements de frais : je demande à être remboursé·e, je donne mon accord, ou je rembourse (ADR 0035). */
@Component({
  selector: 'app-reimbursements-page',
  imports: [FrDatePipe, MatButtonModule, MatIconModule, PageHeader, Skeleton, TabsMenu],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
  `,
  template: `
    <app-page-header
      title="Remboursements de frais"
      icon="receipt_long"
      description="Vous avez avancé de l’argent pour l’association ? Demandez ici à être remboursé·e : joignez le ticket, le bureau donne son accord, puis le trésorier vous rembourse."
    >
      @if (status()?.canRequest) {
        <button mat-flat-button type="button" (click)="create()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouvelle demande
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @if (status(); as info) {
      @if (info.reason) {
        <p class="alert" role="status">{{ info.reason }}</p>
      }
    }

    <nav class="tabs" appTabsMenu aria-label="Remboursements de frais">
      @if (canRequest()) {
        <a href="#" [class.active]="tab() === 'mes-demandes'" (click)="select('mes-demandes', $event)"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">person</mat-icon><span>Mes demandes</span></a>
      }
      @if (toDecide().length > 0 || !canRequest()) {
        <a href="#" [class.active]="tab() === 'a-traiter'" (click)="select('a-traiter', $event)"
          ><mat-icon fontSet="material-icons-outlined" aria-hidden="true">fact_check</mat-icon><span>À traiter ({{ toDecide().length }})</span></a
        >
      }
      @if (canViewAll()) {
        <a href="#" [class.active]="tab() === 'toutes'" (click)="select('toutes', $event)"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">list_alt</mat-icon><span>Toutes les demandes</span></a>
      }
    </nav>

    @if (loading()) {
      <app-skeleton variant="cards" />
    } @else if (rows().length === 0) {
      <section class="panel">
        <p class="muted">{{ emptyText() }}</p>
      </section>
    } @else {
      <table class="table">
        <caption class="sr-only">{{ tabTitle() }}</caption>
        <thead>
          <tr>
            <th scope="col">N°</th>
            @if (tab() !== 'mes-demandes') {
              <th scope="col">Demandeur</th>
            }
            <th scope="col">Pour</th>
            <th scope="col">Date</th>
            <th scope="col" class="amount">Montant</th>
            <th scope="col">Où en est-elle ?</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.id) {
            <tr>
              <td>{{ row.number }}</td>
              @if (tab() !== 'mes-demandes') {
                <td>{{ row.requesterName }}</td>
              }
              <td>{{ row.reason }}</td>
              <td>{{ row.expenseDate | frDate }}</td>
              <td class="amount">{{ euros(row.amount) }}</td>
              <td>{{ situation(row) }}</td>
              <td class="row-actions">
                <button mat-button type="button" [attr.aria-label]="'Ouvrir la demande n° ' + row.number" (click)="open(row)">{{ tab() === 'a-traiter' ? (row.stepType === 'PROCESSING' ? 'Rembourser' : 'Examiner') : 'Ouvrir' }}</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export class ReimbursementsPage {
  private readonly api = inject(ReimbursementsApi);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);
  private readonly route = inject(ActivatedRoute);

  protected readonly euros = euros;
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<ReimbursementStatusInfo | null>(null);
  protected readonly mine = signal<ReimbursementListItem[]>([]);
  protected readonly toDecide = signal<ReimbursementListItem[]>([]);
  protected readonly all = signal<ReimbursementListItem[]>([]);
  protected readonly tab = signal<Tab>('mes-demandes');

  protected readonly canRequest = computed(() => this.auth.can('reimbursements:create'));
  protected readonly canViewAll = computed(() => this.auth.can('reimbursements:view'));
  protected readonly rows = computed(() => (this.tab() === 'mes-demandes' ? this.mine() : this.tab() === 'a-traiter' ? this.toDecide() : this.all()));
  protected readonly tabTitle = computed(() => ({ 'mes-demandes': 'Mes demandes', 'a-traiter': 'Demandes à traiter', toutes: 'Toutes les demandes' })[this.tab()]);
  protected readonly emptyText = computed(() => {
    if (this.tab() === 'a-traiter') return 'Rien à traiter pour l’instant : aucune demande n’attend votre accord ou votre remboursement.';
    if (this.tab() === 'toutes') return 'Aucune demande n’a encore été déposée.';
    return this.status()?.canRequest ? 'Vous n’avez pas encore fait de demande. Cliquez sur « Nouvelle demande » : ayez votre ticket ou votre facture sous la main (une photo suffit).' : 'Vous n’avez pas encore fait de demande.';
  });

  constructor() {
    const wanted = this.route.snapshot.queryParamMap.get('onglet');
    void this.init(wanted);
  }

  protected select(tab: Tab, event: Event): void {
    event.preventDefault();
    this.tab.set(tab);
  }

  protected situation(row: ReimbursementListItem): string {
    return row.status === 'IN_CIRCUIT' && row.awaitingLabel ? `En attente : ${row.awaitingLabel}` : STATUS_LABELS[row.status];
  }

  protected async create(): Promise<void> {
    const projects = await this.api.projects().catch(() => []);
    const done = await this.dialogs.open<ReimbursementInfo, RequestDialogData>(RequestDialog, { size: 'md', data: { request: null, projects } });
    // Fermée sans avoir déposé : un brouillon a peut-être été créé, la liste le montre.
    await this.reload();
    if (done) {
      this.tab.set('mes-demandes');
      this.notifier.success('Votre demande est déposée. Vous serez prévenu·e quand elle avancera.');
    }
  }

  protected async open(row: ReimbursementListItem): Promise<void> {
    await this.dialogs.open<boolean, DetailDialogData>(DetailDialog, { size: 'lg', dismissible: true, data: { id: row.id } });
    await this.reload();
  }

  private async init(wanted: string | null): Promise<void> {
    await this.reload();
    const available: Tab[] = [...(this.canRequest() ? (['mes-demandes'] as const) : []), ...(this.toDecide().length > 0 || !this.canRequest() ? (['a-traiter'] as const) : []), ...(this.canViewAll() ? (['toutes'] as const) : [])];
    // Une personne qui a quelque chose à décider arrive d'abord sur ce qui l'attend.
    const first: Tab = wanted === 'a-traiter' || (wanted === null && this.toDecide().length > 0 && !this.canRequest()) ? 'a-traiter' : (available[0] ?? 'a-traiter');
    this.tab.set(available.includes(first) ? first : (available[0] ?? 'a-traiter'));
  }

  private async reload(): Promise<void> {
    try {
      const [status, mine, toDecide, all] = await Promise.all([
        this.api.status(),
        this.canRequest() ? this.api.mine().catch(() => []) : [],
        this.api.toDecide().catch(() => []),
        this.canViewAll() ? this.api.all().catch(() => []) : [],
      ]);
      this.status.set(status);
      this.mine.set(mine);
      this.toDecide.set(toDecide);
      this.all.set(all);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Les demandes n’ont pas pu être chargées. Rechargez la page.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
