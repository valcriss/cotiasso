import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminApiService, type CommitmentInfo, type CommitmentState, type ProjectInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { formatApiAmount } from './amount';
import { CommitmentCancelDialog, CommitmentDialog, CommitmentSettleDialog } from './commitment-dialogs';
import { FrDatePipe } from '../ui/fr-date.pipe';

const STATE_LABELS: Record<CommitmentState, string> = {
  OPEN: 'Promis',
  SETTLED: 'Soldé',
  REOPENED: 'Promis à nouveau',
  CANCELLED: 'Annulé',
};

/**
 * Engagements d'un projet : des dépenses promises (devis accepté, bon de commande) pas encore payées. Ce n'est pas de la
 * comptabilité. Un engagement se solde par l'écriture de la facture ; il cesse alors de compter comme promis.
 */
@Component({
  selector: 'app-project-commitments',
  imports: [FrDatePipe, MatButtonModule, MatIconModule],
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
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Engagements de ' + project().name">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">pending_actions</mat-icon><span>Engagements</span></h3>
        <div class="actions">
          @if (canWrite()) {
            <button mat-stroked-button type="button" (click)="add()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Enregistrer un engagement
            </button>
          }
        </div>
      </div>
      <p class="muted">
        Une dépense que vous avez <strong>promise mais pas encore payée</strong> : un devis accepté, un bon de commande. Ce n'est pas de
        la comptabilité : cela sert à savoir ce qu'il reste vraiment à dépenser. Quand la facture est enregistrée, « soldez » l'engagement.
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (commitments().length === 0) {
        <p class="muted">
          @if (canWrite()) {
            Aucun engagement. Enregistrez-en un quand vous acceptez un devis ou passez commande, avant de recevoir la facture.
          } @else {
            Aucun engagement n'est enregistré pour ce projet.
          }
        </p>
      } @else {
        <table class="table">
          <caption class="sr-only">Engagements du projet</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Engagement</th>
              <th scope="col" class="amount">Montant promis</th>
              <th scope="col">État</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (commitment of commitments(); track commitment.id) {
              <tr>
                <td>{{ commitment.committedOn | frDate }}</td>
                <td>
                  {{ commitment.label }}
                  @if (commitment.accountNumber) {
                    <span class="note">Compte {{ commitment.accountNumber }} — {{ commitment.accountLabel }}</span>
                  }
                  @if (commitment.note) {
                    <span class="note">{{ commitment.note }}</span>
                  }
                </td>
                <td class="amount">{{ amount(commitment.amount) }}</td>
                <td>
                  <span class="chip">{{ stateLabel(commitment.state) }}</span>
                  @if (commitment.state === 'SETTLED' && commitment.settledEntry; as entry) {
                    <span class="note">Écriture {{ entry.journalCode }}{{ entry.number === null ? '' : ' n° ' + entry.number }} du {{ entry.date | frDate }}</span>
                  }
                  @if (commitment.state === 'REOPENED') {
                    <span class="note">L'écriture qui le soldait a été annulée : il compte de nouveau comme promis.</span>
                  }
                  @if (commitment.state === 'CANCELLED' && commitment.cancelReason) {
                    <span class="note">{{ commitment.cancelReason }}</span>
                  }
                </td>
                <td class="row-actions">
                  @if (canWrite() && commitment.engaged) {
                    @if (commitment.state === 'OPEN') {
                      <button mat-button type="button" [attr.aria-label]="'Modifier ' + commitment.label" (click)="edit(commitment)">Modifier</button>
                    }
                    @if (canSettle()) {
                      <button mat-button type="button" [attr.aria-label]="'Solder ' + commitment.label" (click)="settle(commitment)">Solder</button>
                    }
                    <button mat-button type="button" [attr.aria-label]="'Annuler ' + commitment.label" (click)="cancel(commitment)">Annuler</button>
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
export class ProjectCommitments {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  readonly project = input.required<ProjectInfo>();
  /** Émis quand un engagement change : le suivi du budget se recharge. */
  readonly changed = output<void>();

  protected readonly commitments = signal<CommitmentInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly canWrite = computed(() => {
    this.auth.permissions();
    return this.auth.can('budgets:update') && this.project().status !== 'ARCHIVED';
  });
  protected readonly canSettle = computed(() => {
    this.auth.permissions();
    return this.auth.can('entries:view');
  });

  constructor() {
    effect(() => {
      const id = this.project().id;
      untracked(() => void this.load(id));
    });
  }

  protected amount = formatApiAmount;

  protected stateLabel(state: CommitmentState): string {
    return STATE_LABELS[state];
  }

  protected async add(): Promise<void> {
    const saved = await this.dialogs.open<CommitmentInfo>(CommitmentDialog, { size: 'md', data: { project: this.project(), commitment: null } });
    if (saved) await this.done(`Engagement « ${saved.label} » enregistré.`);
  }

  protected async edit(commitment: CommitmentInfo): Promise<void> {
    const saved = await this.dialogs.open<CommitmentInfo>(CommitmentDialog, { size: 'md', data: { project: this.project(), commitment } });
    if (saved) await this.done(`Engagement « ${saved.label} » enregistré.`);
  }

  protected async settle(commitment: CommitmentInfo): Promise<void> {
    const saved = await this.dialogs.open<CommitmentInfo>(CommitmentSettleDialog, { size: 'md', data: { commitment } });
    if (saved) await this.done(`Engagement « ${saved.label} » soldé : la dépense réelle le remplace dans le suivi.`);
  }

  protected async cancel(commitment: CommitmentInfo): Promise<void> {
    const saved = await this.dialogs.open<CommitmentInfo>(CommitmentCancelDialog, { size: 'md', data: { commitment } });
    if (saved) await this.done(`Engagement « ${saved.label} » annulé.`);
  }

  private async done(message: string): Promise<void> {
    this.notifier.success(message);
    await this.load(this.project().id);
    this.changed.emit();
  }

  private async load(projectId: string): Promise<void> {
    this.error.set(null);
    try {
      this.commitments.set(await this.api.listCommitments(projectId));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les engagements.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
