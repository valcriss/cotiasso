import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import {
  AdminApiService,
  type AccountInfo,
  type FinancialAccountInfo,
  type PostReportInfo,
  type PrepareReportInfo,
  type RecoveryBatchInfo,
  type RecoveryItemInfo,
} from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { formatEuroAmount } from './amount';
import {
  BatchDialog,
  OpeningDialog,
  PrepareDialog,
  type OpeningDialogData,
  type PrepareDialogData,
} from './recovery-dialogs';
import { FrDatePipe } from '../ui/fr-date.pipe';

const STATUS_LABELS = { OPEN: 'En préparation', COMPLETED: 'Terminé', ABANDONED: 'Abandonné' } as const;
const ENTRY_STATUS = { DRAFT: 'Brouillon', POSTED: 'Comptabilisée', REVERSED: 'Contrepassée' } as const;

type Report = { kind: 'prepare'; data: PrepareReportInfo } | { kind: 'post'; data: PostReportInfo };

/**
 * Reprise de l'historique (ADR 0019) : des lots de brouillons préparés en masse, relus, puis comptabilisés ensemble ou
 * abandonnés. Ce qui est déjà comptabilisé n'est jamais effacé.
 */
@Component({
  selector: 'app-recovery-page',
  imports: [FrDatePipe, MatButtonModule, MatIconModule, RouterLink, ActionBar],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .report ul {
      margin: 8px 0 0;
      padding-left: 20px;
    }
  `,
  template: `
    <app-action-bar
      label="Actions de la reprise"
      description="Reprenez l'historique de l'association : préparez les écritures en masse dans un lot, relisez-les, puis comptabilisez le lot. Tant qu'il n'est pas comptabilisé, un lot peut être abandonné sans rien perdre de ce qui est déjà validé."
    >
      @if (canWrite()) {
        <button mat-flat-button type="button" (click)="newBatch()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau lot
        </button>
      }
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (batches().length === 0) {
      <section class="panel">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">inventory_2</mat-icon><span>Aucun lot de reprise</span></h3>
        <p>
          Pour reprendre l'historique, créez un lot, reprenez-y les soldes de départ de vos comptes, puis préparez les écritures de
          leurs transactions. Pensez d'abord à importer les relevés et à qualifier les transactions
          (<a routerLink="/comptes">page Comptes</a>).
        </p>
      </section>
    } @else {
      <ul class="cards">
        @for (batch of batches(); track batch.id) {
          <li class="card-item" [class.unavailable]="batch.status === 'ABANDONED'">
            <div>
              <strong>{{ batch.name }}</strong>
              @if (batch.note) {
                <div class="muted">{{ batch.note }}</div>
              }
              <div class="muted">
                {{ statusLabel(batch.status) }} · {{ batch.drafts }} brouillon(s) · {{ batch.posted }} comptabilisée(s)
              </div>
            </div>
            <button mat-stroked-button type="button" [attr.aria-label]="'Ouvrir le lot ' + batch.name" (click)="open(batch.id)">
              {{ selectedId() === batch.id ? 'Ouvert' : 'Ouvrir' }}
            </button>
          </li>
        }
      </ul>
    }

    @if (detail(); as lot) {
      <section class="panel" [attr.aria-label]="'Lot ' + lot.batch.name">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">inventory_2</mat-icon><span>{{ lot.batch.name }}</span></h3>
        @switch (lot.batch.status) {
          @case ('OPEN') {
            <p class="muted">
              {{ statusLabel(lot.batch.status) }}. Les écritures ci-dessous sont des <strong>brouillons</strong> tant que le lot n'est pas
              comptabilisé : relisez-les, corrigez-les dans la comptabilité si besoin.
            </p>
          }
          @case ('COMPLETED') {
            <p class="muted">{{ statusLabel(lot.batch.status) }}. Toutes les écritures de ce lot sont comptabilisées ; il ne change plus.</p>
          }
          @default {
            <p class="muted">
              {{ statusLabel(lot.batch.status) }}. Ses brouillons ont été supprimés ; les écritures déjà comptabilisées, listées
              ci-dessous, sont conservées.
            </p>
          }
        }
        @if (lot.batch.status === 'OPEN' && canWrite()) {
          <div class="actions">
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="opening()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">savings</mat-icon> Reprendre un solde de départ
            </button>
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="prepare()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">playlist_add</mat-icon> Préparer les écritures d'un compte
            </button>
            @if (canPost()) {
              <button mat-flat-button type="button" [disabled]="busy() || lot.batch.drafts === 0" (click)="post()">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">task_alt</mat-icon> Comptabiliser le lot
              </button>
            }
            <button mat-button class="danger" type="button" [disabled]="busy()" (click)="abandon()">Abandonner le lot</button>
          </div>
        }
      </section>

      @if (report(); as current) {
        <section class="panel report" aria-label="Compte rendu">
          @if (current.kind === 'prepare') {
            <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">fact_check</mat-icon><span>Compte rendu de la préparation</span></h3>
            <p>
              <strong>{{ current.data.created }}</strong> brouillon(s) préparé(s).
              @if (current.data.skipped.length > 0) {
                {{ skippedTotal(current.data) }} transaction(s) ignorée(s) : rien n'est perdu, corrigez puis relancez la préparation.
              }
            </p>
            @if (current.data.skipped.length > 0) {
              <ul>
                @for (skipped of current.data.skipped; track skipped.transactionId) {
                  <li>{{ skipped.date | frDate }} · {{ skipped.label }} ({{ amount(skipped.amount) }}) — {{ skipped.message }}</li>
                }
              </ul>
            }
          } @else {
            <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">fact_check</mat-icon><span>Compte rendu de la comptabilisation</span></h3>
            <p>
              <strong>{{ current.data.posted }}</strong> écriture(s) comptabilisée(s).
              @if (current.data.failed.length > 0) {
                {{ current.data.failed.length }} refusée(s), restée(s) en brouillon dans le lot : corrigez-les puis comptabilisez de nouveau.
              } @else if (current.data.completed) {
                Le lot est terminé.
              }
            </p>
            @if (current.data.failed.length > 0) {
              <ul>
                @for (failed of current.data.failed; track failed.entryId) {
                  <li>
                    {{ failed.date | frDate }} · {{ failed.label }} — {{ failed.messages.join(' ') }}
                    <a [routerLink]="['/comptabilite/ecritures', failed.entryId]">Ouvrir l'écriture</a>
                  </li>
                }
              </ul>
            }
          }
        </section>
      }

      <section class="panel" aria-label="Écritures du lot">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">list_alt</mat-icon><span>Écritures du lot</span></h3>
        @if (lot.items.length === 0) {
          <p class="muted">Ce lot est vide. Reprenez un solde de départ ou préparez les écritures d'un compte pour le remplir.</p>
        } @else {
          <table class="table">
            <caption class="sr-only">Écritures du lot</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Libellé</th>
                <th scope="col">Compte</th>
                <th scope="col">État</th>
                <th scope="col" class="amount">Montant</th>
                <th scope="col"><span class="sr-only">Ouvrir</span></th>
              </tr>
            </thead>
            <tbody>
              @for (item of lot.items; track item.entryId) {
                <tr>
                  <td>{{ item.date | frDate }}</td>
                  <td>
                    {{ item.label }}
                    @if (item.kind === 'OPENING') {
                      <span class="chip">Solde de départ</span>
                    }
                  </td>
                  <td>{{ item.financialAccountName }}</td>
                  <td>
                    @if (item.status === 'DRAFT') {
                      <span class="muted">{{ entryStatus(item.status) }}</span>
                    } @else {
                      <span class="status ok">{{ entryStatus(item.status) }}</span>
                      <div class="muted">{{ item.journalCode }} n° {{ item.number }}</div>
                    }
                  </td>
                  <td class="amount">{{ amount(item.amount) }}</td>
                  <td class="row-actions">
                    <a mat-button [routerLink]="['/comptabilite/ecritures', item.entryId]" [attr.aria-label]="'Ouvrir ' + item.label">Ouvrir</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }
  `,
})
export class RecoveryPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly batches = signal<RecoveryBatchInfo[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = signal<{ batch: RecoveryBatchInfo; items: RecoveryItemInfo[] } | null>(null);
  protected readonly report = signal<Report | null>(null);
  private readonly financialAccounts = signal<FinancialAccountInfo[]>([]);
  private readonly chart = signal<AccountInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatEuroAmount;

  protected readonly canWrite = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:create') && this.auth.can('transactions:manage');
  });
  protected readonly canPost = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:post');
  });

  constructor() {
    void this.init();
  }

  protected statusLabel = (status: RecoveryBatchInfo['status']) => STATUS_LABELS[status];
  protected entryStatus = (status: RecoveryItemInfo['status']) => ENTRY_STATUS[status];
  protected skippedTotal = (data: PrepareReportInfo) => Object.values(data.skippedByReason).reduce((sum, n) => sum + (n ?? 0), 0);

  protected async open(id: string): Promise<void> {
    this.selectedId.set(id);
    this.report.set(null);
    await this.run(async () => this.detail.set(await this.api.getRecoveryBatch(id)), 'Impossible de charger le lot.');
  }

  protected async newBatch(): Promise<void> {
    const created = await this.dialogs.open<RecoveryBatchInfo>(BatchDialog, { size: 'md' });
    if (!created) return;
    this.notifier.success(`Lot « ${created.name} » créé : reprenez-y un solde de départ ou préparez des écritures.`);
    await this.reload();
    await this.open(created.id);
  }

  protected async opening(): Promise<void> {
    const lot = this.detail();
    if (!lot) return;
    const accounts = this.financialAccounts().filter((a) => !a.archivedOn && Number(a.balances.opening) !== 0);
    const capitalAccounts = this.chart().filter((a) => a.active && a.number.startsWith('1'));
    const item = await this.dialogs.open<RecoveryItemInfo, OpeningDialogData>(OpeningDialog, {
      size: 'md',
      data: { batchId: lot.batch.id, accounts, capitalAccounts },
    });
    if (!item) return;
    this.notifier.success('Brouillon du solde de départ préparé : relisez-le, puis comptabilisez le lot.');
    await this.refresh();
  }

  protected async prepare(): Promise<void> {
    const lot = this.detail();
    if (!lot) return;
    const result = await this.dialogs.open<PrepareReportInfo, PrepareDialogData>(PrepareDialog, {
      size: 'md',
      data: { batchId: lot.batch.id, accounts: this.financialAccounts().filter((a) => !a.archivedOn) },
    });
    if (!result) return;
    this.report.set({ kind: 'prepare', data: result });
    this.notifier.success(`${result.created} brouillon(s) préparé(s).`);
    await this.refresh();
  }

  protected async post(): Promise<void> {
    const lot = this.detail();
    if (!lot) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Comptabiliser ce lot ?',
      message: `Les ${lot.batch.drafts} brouillons du lot seront comptabilisés dans l'ordre des dates. Une écriture comptabilisée reçoit son numéro et ne peut plus être modifiée ni supprimée (on la corrige par une écriture inverse). Si certaines sont refusées, elles restent en brouillon dans le lot et vous verrez pourquoi : les autres sont comptabilisées quand même.`,
      confirmLabel: 'Comptabiliser le lot',
    });
    if (!confirmed) return;
    await this.run(async () => {
      const result = await this.api.postRecoveryBatch(lot.batch.id);
      this.report.set({ kind: 'post', data: result });
      this.notifier.success(
        result.completed ? `Lot terminé : ${result.posted} écriture(s) comptabilisée(s).` : `${result.posted} écriture(s) comptabilisée(s), ${result.failed.length} refusée(s).`,
      );
      await this.refresh();
    }, "Le lot n'a pas pu être comptabilisé.");
  }

  protected async abandon(): Promise<void> {
    const lot = this.detail();
    if (!lot) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Abandonner ce lot ?',
      message: `Les ${lot.batch.drafts} brouillons du lot seront supprimés et leurs transactions redeviendront « à comptabiliser ». Les écritures déjà comptabilisées (${lot.batch.posted}) ne sont pas touchées. Le lot est conservé dans l'historique, et vous pourrez en créer un autre.`,
      confirmLabel: 'Abandonner le lot',
      cancelLabel: 'Garder',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      const result = await this.api.abandonRecoveryBatch(lot.batch.id);
      this.report.set(null);
      this.notifier.success(`Lot abandonné : ${result.deleted} brouillon(s) supprimé(s), ${result.kept} écriture(s) comptabilisée(s) conservée(s).`);
      await this.refresh();
    }, "Le lot n'a pas pu être abandonné.");
  }

  private async reload(): Promise<void> {
    this.batches.set(await this.api.listRecoveryBatches());
  }

  private async refresh(): Promise<void> {
    await this.reload();
    const id = this.selectedId();
    if (id) this.detail.set(await this.api.getRecoveryBatch(id));
  }

  private async init(): Promise<void> {
    try {
      await this.reload();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les lots de reprise.').message);
    } finally {
      this.loading.set(false);
    }
    // Comptes financiers et plan comptable : nécessaires aux boîtes de dialogue, ignorés sans droit de lecture.
    this.financialAccounts.set(await this.api.listFinancialAccounts().catch(() => []));
    this.chart.set(await this.api.listAccounts().catch(() => []));
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
}
