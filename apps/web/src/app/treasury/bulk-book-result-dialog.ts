import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import type { BulkBookInfo } from '../admin/admin-api.service';
import { FrDatePipe } from '../ui/fr-date.pipe';

export interface BulkBookResultData {
  result: BulkBookInfo;
}

/**
 * Compte rendu d'un enregistrement en masse (ADR 0028) : ce qui est passé, et pour chaque mouvement laissé de côté la raison
 * et ce qu'il faut faire. Rien n'est perdu : un mouvement ignoré reste tel quel, à reprendre après correction.
 */
@Component({
  selector: 'app-bulk-book-result-dialog',
  imports: [FrDatePipe, MatDialogModule, MatButtonModule, MatIconModule],
  styles: `
    .summary {
      margin: 0 0 12px;
    }
    ul.ignored {
      display: flex;
      flex-direction: column;
      gap: 8px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ul.ignored li {
      border-top: 1px solid var(--app-border);
      padding-top: 8px;
    }
  `,
  template: `
    <h2 mat-dialog-title>
      @if (data.result.ignored.length === 0) {
        Tout est enregistré
      } @else {
        Enregistrement terminé, avec {{ data.result.ignored.length }} mouvement(s) à regarder
      }
    </h2>
    <mat-dialog-content>
      <p class="summary">
        <strong>{{ data.result.booked }}</strong> mouvement(s) enregistré(s) dans les comptes
        @if (data.result.drafts > 0) {
          ({{ data.result.drafts }} en brouillon, à relire : vous n'avez pas le droit d'enregistrer définitivement)
        }
        @if (data.result.booked === 0) {
          — rien n'a été modifié.
        }
      </p>
      @if (data.result.ignored.length > 0) {
        <p class="muted">
          Ces mouvements n'ont pas été enregistrés. Ils restent tels quels : corrigez ce qui est indiqué, puis relancez l'enregistrement, il
          reprendra seulement ce qui reste.
        </p>
        <ul class="ignored" aria-label="Mouvements non enregistrés">
          @for (item of data.result.ignored; track item.transactionId) {
            <li>
              <strong>{{ item.label }}</strong> <span class="muted">· {{ item.date | frDate }}</span>
              <div>{{ item.reason }}</div>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" [mat-dialog-close]="true" cdkFocusInitial>Fermer</button>
    </mat-dialog-actions>
  `,
})
export class BulkBookResultDialog {
  protected readonly data = inject<BulkBookResultData>(MAT_DIALOG_DATA);
}
