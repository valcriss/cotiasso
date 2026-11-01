import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Notifier } from '../ui/notifier.service';

export interface LinkDialogData {
  title: string;
  url: string;
  expiresAt: string;
}

/** Affiche une seule fois un lien à transmettre (invitation ou réinitialisation de mot de passe). */
@Component({
  selector: 'app-link-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>
        Transmettez ce lien à la personne concernée : il lui permet de choisir son mot de passe. Pour sa sécurité, il
        <strong>ne sera plus affiché</strong> une fois cette fenêtre fermée, et il expire le {{ data.expiresAt }}.
      </p>
      <div class="link-row">
        <input readonly [value]="data.url" aria-label="Lien à transmettre" (focus)="select($event)" />
        <button mat-stroked-button type="button" (click)="copy()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">content_copy</mat-icon> Copier
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" [mat-dialog-close]="true">J'ai transmis le lien</button>
    </mat-dialog-actions>
  `,
})
export class LinkDialog {
  private readonly notifier = inject(Notifier);
  protected readonly data = inject<LinkDialogData>(MAT_DIALOG_DATA);

  protected select(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.data.url);
      this.notifier.success('Lien copié.');
    } catch {
      // Le champ reste sélectionnable : la copie manuelle reste possible.
      this.notifier.notice('Copie impossible ici : sélectionnez le lien et copiez-le à la main.');
    }
  }
}
