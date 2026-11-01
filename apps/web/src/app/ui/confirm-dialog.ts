import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmOptions {
  title: string;
  /** Ce qui va se passer, et ce qui ne sera plus possible ensuite (design.md §1, principe 6). */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructrice ou irréversible : le bouton de confirmation est mis en garde. */
  danger?: boolean;
}

/** Confirmation avant une action irréversible, ou avant d'abandonner une saisie. Ouvert par `Dialogs.confirm`. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  styles: `
    .message {
      margin: 0;
      white-space: pre-line;
    }
  `,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false" cdkFocusInitial>{{ data.cancelLabel ?? 'Annuler' }}</button>
      <button mat-flat-button type="button" [class.danger]="data.danger" [mat-dialog-close]="true">
        {{ data.confirmLabel ?? 'Confirmer' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmOptions>(MAT_DIALOG_DATA);
}
