import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { centsToApi, formatApiAmount, parseAmountToCents } from '../accounting/amount';
import { AdminApiService, type PaymentAllocationInfo, type MembershipInfo, type PaymentCandidateInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { FormDialog } from '../ui/form-dialog';
import { Notifier } from '../ui/notifier.service';

export interface PaymentsDialogData {
  membership: MembershipInfo;
  canManage: boolean;
}

export interface CancelAllocationDialogData {
  allocation: PaymentAllocationInfo;
}

/** Annulation motivée d'une affectation de règlement. Renvoie l'adhésion mise à jour. */
@Component({
  selector: 'app-cancel-allocation-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Annuler cette affectation ?"
        description="La somme redevient disponible sur la transaction, et l'affectation reste dans l'historique avec votre motif. Si l'adhésion était devenue effective grâce à elle, elle repasse en attente."
        submitLabel="Annuler l'affectation"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Motif</mat-label>
          <input matInput formControlName="reason" placeholder="Chèque rejeté, erreur d'affectation…" required />
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class CancelAllocationDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CancelAllocationDialog, MembershipInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<CancelAllocationDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({ reason: [''] });

  protected async save(): Promise<void> {
    const reason = this.form.getRawValue().reason.trim();
    if (reason.length < 3) {
      this.error.set("Indiquez le motif de l'annulation en quelques mots (3 caractères au moins).");
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.cancelAllocation(this.data.allocation.id, reason));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'annulation n'a pas pu être faite. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Règlements d'une adhésion : ce qui est attendu, payé et restant dû, les affectations (annulables), et l'affectation d'une
 * transaction de la banque. Aucune écriture comptable n'est créée ici : la transaction se comptabilise à part.
 */
@Component({
  selector: 'app-payments-dialog',
  imports: [ReactiveFormsModule, RouterLink, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `
    .figures {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 24px;
      margin: 8px 0 12px;
    }
    .alloc {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      justify-content: space-between;
      padding: 4px 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .grow {
      flex: 1;
      min-width: 180px;
    }
  `,
  template: `
    <h2 mat-dialog-title>Règlements de {{ membership().memberName }}</h2>
    <mat-dialog-content>
      <p class="muted">{{ membership().campaignName }} · {{ membership().tariffLabel }}</p>
      <p class="muted">
        Rattacher un règlement dit à quel adhérent correspond l'argent reçu : cela suit qui a payé sa cotisation. L'argent lui-même est enregistré
        dans les comptes à part, avec « J'ai reçu de l'argent » (catégorie « Cotisations des adhérents ») ou depuis la liste des mouvements du compte
        (« Classer et enregistrer »). Tant que ce n'est pas fait, la cotisation est suivie ici mais n'apparaît pas encore dans vos comptes.
      </p>
      <div class="figures">
        <span>Attendu : <strong>{{ amount(membership().expectedAmount) }} €</strong></span>
        <span>Payé : <strong>{{ amount(membership().paid) }} €</strong></span>
        @if (membership().overpaid) {
          <span class="danger-text">Trop-perçu : <strong>{{ amount(overpayment()) }} €</strong> à rembourser ou à imputer</span>
        } @else {
          <span>Reste dû : <strong>{{ amount(membership().balance) }} €</strong></span>
        }
      </div>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }

      <h3>Règlements affectés</h3>
      @for (allocation of allocations(); track allocation.id) {
        <div class="alloc" [class.muted]="allocation.cancelled">
          <span>
            {{ allocation.kind === 'REFUND' ? 'Remboursement' : 'Règlement' }} de {{ amount(allocation.amount) }} € · {{ allocation.transactionDate }} · {{ allocation.accountName }}
            @if (allocation.note) { · {{ allocation.note }} }
            @if (allocation.cancelled) { · annulé : {{ allocation.cancelReason }} }
          </span>
          @if (data.canManage && !allocation.cancelled) {
            <button mat-button type="button" class="danger" [disabled]="busy()" [attr.aria-label]="'Annuler l\\'affectation de ' + allocation.amount + ' euros'" (click)="cancel(allocation)">Annuler</button>
          }
        </div>
      } @empty {
        <p class="muted">Aucun règlement affecté pour l'instant.</p>
      }
      @if (Number(membership().paid) > 0) {
        <p>
          <a mat-button [routerLink]="['/membres/recu', membership().id]" mat-dialog-close>Voir le reçu simple</a>
        </p>
      }

      @if (data.canManage && membership().status !== 'CANCELLED') {
        <h3>Affecter une transaction de la banque</h3>
        <p class="muted">
          Choisissez le mouvement de la banque qui correspond à ce paiement : une même transaction peut être répartie entre plusieurs
          adhésions (paiement groupé), et on peut n'en affecter qu'une partie (paiement partiel).
        </p>
        <form [formGroup]="form" (ngSubmit)="allocate()" novalidate>
          <div class="row">
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Type</mat-label>
              <mat-select formControlName="kind" (selectionChange)="loadCandidates()">
                <mat-option value="PAYMENT">Règlement reçu</mat-option>
                <mat-option value="REFUND">Remboursement versé</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Transaction</mat-label>
              <mat-select formControlName="transactionId" (selectionChange)="suggest()">
                @for (candidate of candidates(); track candidate.id) {
                  <mat-option [value]="candidate.id">{{ candidate.operationDate }} · {{ candidate.label }} · reste {{ amount(candidate.remaining) }} €</mat-option>
                }
              </mat-select>
              @if (candidates().length === 0) {
                <mat-hint>Aucune transaction disponible : importez ou saisissez d'abord le mouvement de la banque.</mat-hint>
              }
            </mat-form-field>
          </div>
          <div class="row">
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Montant affecté (€)</mat-label>
              <input matInput inputmode="decimal" formControlName="amount" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="grow">
              <mat-label>Note (facultatif)</mat-label>
              <input matInput formControlName="note" />
            </mat-form-field>
          </div>
          <button mat-flat-button type="submit" [disabled]="busy()">Affecter</button>
        </form>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" (click)="close()">Fermer</button>
    </mat-dialog-actions>
  `,
})
export class PaymentsDialog {
  private readonly api = inject(AdminApiService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);
  private readonly reference = inject<MatDialogRef<PaymentsDialog, MembershipInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<PaymentsDialogData>(MAT_DIALOG_DATA);
  protected readonly Number = Number;
  protected readonly amount = formatApiAmount;

  protected readonly membership = signal<MembershipInfo>(this.data.membership);
  protected readonly allocations = signal<PaymentAllocationInfo[]>([]);
  protected readonly candidates = signal<PaymentCandidateInfo[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly overpayment = computed(() => this.membership().balance.replace('-', ''));
  protected readonly form = this.fb.group({ kind: ['PAYMENT' as 'PAYMENT' | 'REFUND'], transactionId: [''], amount: [''], note: [''] });

  constructor() {
    void this.reload(true);
  }

  protected async loadCandidates(): Promise<void> {
    this.form.patchValue({ transactionId: '', amount: '' });
    await this.run(async () => this.candidates.set(await this.api.paymentCandidates(this.membership().id, this.form.getRawValue().kind)));
  }

  /** Propose le montant : le reste dû (ou le payé pour un remboursement), sans dépasser ce qui reste sur la transaction. */
  protected suggest(): void {
    const candidate = this.candidates().find((c) => c.id === this.form.getRawValue().transactionId);
    if (!candidate) return;
    const wanted = this.form.getRawValue().kind === 'PAYMENT' ? parseAmountToCents(this.membership().balance) : parseAmountToCents(this.membership().paid);
    const remaining = parseAmountToCents(candidate.remaining) ?? 0;
    const cents = Math.min(remaining, wanted !== null && wanted > 0 ? wanted : remaining);
    this.form.patchValue({ amount: centsToApi(cents).replace('.', ',') });
  }

  protected async allocate(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    if (!raw.transactionId || cents === null || cents <= 0) {
      this.error.set('Choisissez la transaction et indiquez un montant supérieur à zéro, par exemple 30,00.');
      return;
    }
    await this.run(async () => {
      const result = await this.api.allocatePayment(this.membership().id, {
        transactionId: raw.transactionId,
        amount: centsToApi(cents),
        kind: raw.kind,
        ...(raw.note.trim() && { note: raw.note.trim() }),
      });
      this.membership.set(result.membership);
      this.notifier.success(raw.kind === 'REFUND' ? 'Remboursement affecté.' : result.membership.status === 'EFFECTIVE' ? 'Règlement affecté : l’adhésion est effective.' : 'Règlement affecté.');
      this.form.patchValue({ transactionId: '', amount: '', note: '' });
      await this.reload(false);
    });
  }

  protected async cancel(allocation: PaymentAllocationInfo): Promise<void> {
    const updated = await this.dialogs.open<MembershipInfo, CancelAllocationDialogData>(CancelAllocationDialog, { size: 'md', data: { allocation } });
    if (!updated) return;
    this.membership.set(updated);
    this.notifier.success('Affectation annulée.');
    await this.reload(false);
  }

  protected close(): void {
    this.reference.close(this.membership());
  }

  private async reload(first: boolean): Promise<void> {
    await this.run(async () => {
      this.allocations.set(await this.api.listAllocations(this.membership().id));
      if (this.data.canManage) this.candidates.set(await this.api.paymentCandidates(this.membership().id, this.form.getRawValue().kind));
      if (first) return;
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'opération a échoué. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
