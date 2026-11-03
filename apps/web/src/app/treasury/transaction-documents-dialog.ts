import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { formatApiAmount } from '../accounting/amount';
import { LinkedDocuments } from '../documents/linked-documents';
import type { TransactionInfo } from '../admin/admin-api.service';

export interface TransactionDocumentsDialogData {
  transaction: TransactionInfo;
  /** Droit de déposer un document (`documents:create`). */
  canDeposit: boolean;
}

/**
 * Justificatifs d'un mouvement : les factures, tickets et pièces qui le justifient. Un document déposé ici est relié au
 * mouvement dès le dépôt ; il est conservé tel quel et ne se supprime pas (une erreur se corrige par une nouvelle version).
 */
@Component({
  selector: 'app-transaction-documents-dialog',
  imports: [MatDialogModule, MatButtonModule, LinkedDocuments],
  template: `
    <h2 mat-dialog-title>Justificatifs de ce mouvement</h2>
    <mat-dialog-content>
      <p class="help">
        <strong>{{ data.transaction.label }}</strong><br />
        <span class="muted">{{ data.transaction.operationDate }} · {{ amount(data.transaction.amount) }} €</span>
      </p>
      <app-linked-documents objectType="transaction" [objectId]="data.transaction.id" [name]="data.transaction.label" [canDeposit]="data.canDeposit" />
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Fermer</button>
    </mat-dialog-actions>
  `,
})
export class TransactionDocumentsDialog {
  protected readonly data = inject<TransactionDocumentsDialogData>(MAT_DIALOG_DATA);
  protected readonly amount = formatApiAmount;
}
