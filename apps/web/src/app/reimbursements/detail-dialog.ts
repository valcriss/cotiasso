import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { Notifier } from '../ui/notifier.service';
import { CircuitSteps } from './circuit-steps';
import { DecisionDialog, type DecisionDialogData } from './decision-dialog';
import { PayDialog, type PayDialogData } from './pay-dialog';
import { decisionText, euros, STATUS_LABELS } from './reimbursement-labels';
import { RequestDialog, type RequestDialogData } from './request-dialog';
import { ReimbursementsApi, type ReceiptInfo, type ReimbursementInfo } from './reimbursements-api';

export interface DetailDialogData {
  id: string;
}

/**
 * Fiche d'une demande : ce qui est demandé, où elle en est (schéma des étapes), les justificatifs, l'historique, et les
 * gestes possibles pour la personne qui la regarde. Renvoie `true` si quelque chose a changé (la liste se recharge).
 */
@Component({
  selector: 'app-reimbursement-detail-dialog',
  imports: [CircuitSteps, FrDatePipe, MatButtonModule, MatDialogModule, MatIconModule],
  styles: `
    dl {
      display: grid;
      gap: 6px 16px;
      grid-template-columns: max-content 1fr;
      margin: 0 0 16px;
    }
    dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dd {
      margin: 0;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 20px 0 8px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
    }
    .status {
      font-weight: 500;
    }
  `,
  template: `
    <h2 mat-dialog-title>Demande de remboursement n° {{ request()?.number }}</h2>
    <mat-dialog-content>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (request(); as r) {
        <dl>
          <dt>Demandeur</dt>
          <dd>{{ r.requesterName }}</dd>
          <dt>Montant</dt>
          <dd>{{ amount() }}</dd>
          <dt>Date de la dépense</dt>
          <dd>{{ r.expenseDate | frDate }}</dd>
          <dt>Pour</dt>
          <dd>{{ r.reason }}</dd>
          <dt>Projet</dt>
          <dd>{{ r.projectName ?? 'Fonctionnement de l’association' }}</dd>
          <dt>Où en est-elle ?</dt>
          <dd class="status">{{ statusText() }}</dd>
        </dl>

        @if (r.lastMessage; as message) {
          <p class="alert" role="status">{{ r.status === 'REFUSED' ? 'Motif du refus' : 'À corriger' }} : {{ message }}</p>
        }
        @if (r.instance; as instance) {
          <app-circuit-steps [steps]="instance.steps" [status]="r.status" />
        }

        <h3>Justificatifs</h3>
        @if (receipts().length === 0) {
          <p class="muted">Aucun justificatif joint.</p>
        } @else {
          <ul>
            @for (receipt of receipts(); track receipt.id) {
              <li><a [href]="downloadUrl(receipt)" target="_blank" rel="noopener">{{ receipt.title }}</a> <span class="muted">({{ receipt.latest.originalName }})</span></li>
            }
          </ul>
        }

        @if (history().length > 0) {
          <h3>Historique</h3>
          <ul aria-label="Historique de la demande">
            @for (line of history(); track $index) {
              <li>
                {{ line.text }}
                @if (line.message) {
                  <br /><span class="muted">« {{ line.message }} »</span>
                }
              </li>
            }
          </ul>
        }
      } @else if (!error()) {
        <p class="muted">Chargement…</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (request(); as r) {
        @if (r.can.delete) {
          <button mat-button type="button" [disabled]="busy()" (click)="removeDraft()">Supprimer le brouillon</button>
        }
        @if (r.can.cancel) {
          <button mat-button type="button" [disabled]="busy()" (click)="decision('CANCEL')">Annuler ma demande</button>
        }
        @if (r.can.decide) {
          <button mat-button type="button" [disabled]="busy()" (click)="decision('RETURN')">Renvoyer pour correction</button>
          @if (r.can.stepType === 'APPROVAL') {
            <button mat-button type="button" [disabled]="busy()" (click)="decision('REFUSE')">Refuser</button>
            <button mat-flat-button type="button" [disabled]="busy()" (click)="approve()">Donner mon accord</button>
          }
        }
        @if (r.can.process) {
          <button mat-flat-button type="button" [disabled]="busy()" (click)="pay()">Rembourser</button>
        }
        @if (r.can.edit) {
          <button mat-flat-button type="button" [disabled]="busy()" (click)="edit()">{{ r.status === 'RETURNED' ? 'Corriger et redéposer' : 'Modifier et déposer' }}</button>
        }
      }
      <button mat-button type="button" (click)="close()">Fermer</button>
    </mat-dialog-actions>
  `,
})
export class DetailDialog {
  private readonly api = inject(ReimbursementsApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);
  private readonly reference = inject<MatDialogRef<DetailDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<DetailDialogData>(MAT_DIALOG_DATA);

  protected readonly request = signal<ReimbursementInfo | null>(null);
  protected readonly receipts = signal<ReceiptInfo[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private changed = false;

  protected readonly amount = computed(() => euros(this.request()?.amount ?? '0'));
  protected readonly statusText = computed(() => {
    const r = this.request();
    if (!r) return '';
    return r.status === 'IN_CIRCUIT' && r.awaitingLabel ? `En attente : ${r.awaitingLabel}` : STATUS_LABELS[r.status];
  });
  protected readonly history = computed(() => {
    const r = this.request();
    const labels = new Map(r?.instance?.steps.map((s) => [s.nodeId, s.label]) ?? []);
    return (r?.instance?.decisions ?? []).map((d) => ({ text: decisionText(d, labels.get(d.nodeId ?? '') ?? 'étape'), message: d.outcome === 'AUTO_APPROVED' ? null : d.message }));
  });

  constructor() {
    void this.load();
  }

  protected downloadUrl(receipt: ReceiptInfo): string {
    return this.api.receiptUrl(this.data.id, receipt.id);
  }

  protected close(): void {
    this.reference.close(this.changed);
  }

  protected async edit(): Promise<void> {
    const request = this.request();
    if (!request) return;
    const projects = await this.api.projects().catch(() => []);
    const done = await this.dialogs.open<ReimbursementInfo, RequestDialogData>(RequestDialog, { size: 'md', data: { request, projects } });
    if (!done) return;
    this.changed = true;
    this.notifier.success('Votre demande est déposée. Vous serez prévenu·e quand elle avancera.');
    await this.load();
  }

  protected async decision(kind: 'REFUSE' | 'RETURN' | 'CANCEL'): Promise<void> {
    const request = this.request();
    if (!request) return;
    const done = await this.dialogs.open<ReimbursementInfo, DecisionDialogData>(DecisionDialog, { size: 'md', data: { id: request.id, number: request.number, kind } });
    if (!done) return;
    this.changed = true;
    this.notifier.success(kind === 'REFUSE' ? 'Demande refusée.' : kind === 'RETURN' ? 'Demande renvoyée pour correction.' : 'Demande annulée.');
    this.request.set(done);
    await this.loadReceipts();
  }

  protected async approve(): Promise<void> {
    const request = this.request();
    if (!request) return;
    const next = request.instance?.steps.find((s) => s.state === 'PENDING');
    const ok = await this.dialogs.confirm({
      title: 'Donner votre accord ?',
      message: `Votre accord est enregistré avec votre nom et la date.\n${next ? `La demande passera à l’étape suivante : « ${next.label} ».` : 'La demande passera ensuite au remboursement.'}`,
      confirmLabel: 'Donner mon accord',
    });
    if (!ok) return;
    await this.run(async () => {
      this.request.set(await this.api.decide(request.id, 'APPROVE', null));
      this.notifier.success('Votre accord est enregistré.');
    });
  }

  protected async pay(): Promise<void> {
    const request = this.request();
    if (!request) return;
    const done = await this.dialogs.open<ReimbursementInfo, PayDialogData>(PayDialog, { size: 'md', data: { request } });
    if (!done) return;
    this.changed = true;
    this.request.set(done);
    this.notifier.success('Remboursement enregistré : la demande est terminée.');
  }

  protected async removeDraft(): Promise<void> {
    const request = this.request();
    if (!request) return;
    const ok = await this.dialogs.confirm({
      title: 'Supprimer ce brouillon ?',
      message: 'Rien n’a été déposé : le brouillon et ses justificatifs sont simplement mis de côté. Vous pourrez refaire une demande quand vous voulez.',
      confirmLabel: 'Supprimer le brouillon',
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await this.api.remove(request.id);
      this.changed = true;
      this.notifier.success('Brouillon supprimé.');
      this.reference.close(true);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      this.changed = true;
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'L’action n’a pas pu être faite. Réessayez dans un instant.').message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.request.set(await this.api.get(this.data.id));
      await this.loadReceipts();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Cette demande n’a pas pu être ouverte. Elle n’existe plus, ou elle ne vous est pas destinée.').message);
    }
  }

  private async loadReceipts(): Promise<void> {
    this.receipts.set(await this.api.receipts(this.data.id).catch(() => []));
  }
}
