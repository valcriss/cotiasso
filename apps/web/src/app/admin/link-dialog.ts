import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Notifier } from '../ui/notifier.service';
import type { MailOutcome } from './admin-api.service';

export interface LinkDialogData {
  title: string;
  url: string;
  expiresAt: string;
  /** Ce qu'il est advenu de l'email qui porte ce lien ; absent quand l'envoi n'est pas configuré. */
  mail?: MailOutcome;
}

/** Affiche une seule fois un lien à transmettre (invitation ou réinitialisation de mot de passe). */
@Component({
  selector: 'app-link-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.mail?.status === 'SENT') {
        <p class="success" role="status">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">mark_email_read</mat-icon>
          Un email contenant ce lien a été envoyé à <strong>{{ sentTo() }}</strong>. La personne n'a rien d'autre à attendre de vous.
        </p>
        <p>
          Si l'email n'arrive pas (courrier indésirable, adresse erronée…), vous pouvez aussi lui transmettre ce lien vous-même. Pour sa
          sécurité, il <strong>ne sera plus affiché</strong> une fois cette fenêtre fermée, et il expire le {{ data.expiresAt }}.
        </p>
      } @else if (data.mail?.status === 'FAILED') {
        <div class="alert" role="alert">
          <p>
            L'email n'a pas pu être envoyé à <strong>{{ sentTo() }}</strong> : le serveur de messagerie a refusé le message ou ne répond pas.
            Le compte est bien créé : transmettez simplement le lien ci-dessous vous-même. Si cela se reproduit, vérifiez la configuration d'envoi
            d'emails (voir l'aide d'exploitation).
          </p>
        </div>
        <p>
          Ce lien <strong>ne sera plus affiché</strong> une fois cette fenêtre fermée, et il expire le {{ data.expiresAt }}.
        </p>
      } @else {
        <p>
          Transmettez ce lien à la personne concernée : il lui permet de choisir son mot de passe. Pour sa sécurité, il
          <strong>ne sera plus affiché</strong> une fois cette fenêtre fermée, et il expire le {{ data.expiresAt }}.
        </p>
      }
      <div class="link-row">
        <input readonly [value]="data.url" aria-label="Lien à transmettre" (focus)="select($event)" />
        <button mat-stroked-button type="button" (click)="copy()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">content_copy</mat-icon> Copier
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" [mat-dialog-close]="true">{{ data.mail?.status === 'SENT' ? 'Fermer' : "J'ai transmis le lien" }}</button>
    </mat-dialog-actions>
  `,
})
export class LinkDialog {
  private readonly notifier = inject(Notifier);
  protected readonly data = inject<LinkDialogData>(MAT_DIALOG_DATA);

  protected sentTo(): string {
    return this.data.mail && this.data.mail.status !== 'NOT_CONFIGURED' ? this.data.mail.to : '';
  }

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
