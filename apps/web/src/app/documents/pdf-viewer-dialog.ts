import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { AdminApiService } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';

export interface PdfViewerDialogData {
  documentId: string;
  /** Numéro de version ; absent = la dernière. */
  version?: number;
  title: string;
  fileName: string;
}

/** Un fichier est affichable dans la visionneuse seulement s'il est un PDF (type détecté par le serveur à l'envoi). */
export function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

/**
 * Visionneuse de PDF dans une boîte de dialogue. Le fichier est lu par la même route que le téléchargement (mêmes droits,
 * même audit pour un document restreint), puis montré par le lecteur PDF du navigateur à partir d'une adresse locale
 * `blob:` : le serveur n'a aucune réponse « en ligne » à servir, et le type est imposé ici, jamais celui d'une réponse.
 */
@Component({
  selector: 'app-pdf-viewer-dialog',
  imports: [MatDialogModule, MatButtonModule],
  styles: `
    .viewer {
      border: 1px solid var(--app-border, currentColor);
      border-radius: 4px;
      height: 70vh;
      width: 100%;
    }
    .state {
      margin: 0;
    }
  `,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (url(); as src) {
        <iframe class="viewer" [src]="src" [title]="'Aperçu de ' + data.fileName"></iframe>
      } @else if (error(); as message) {
        <p class="state" role="alert">{{ message }}</p>
      } @else {
        <p class="state" role="status">Ouverture du document…</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <a mat-button [href]="downloadUrl">Télécharger</a>
      <button mat-flat-button type="button" mat-dialog-close cdkFocusInitial>Fermer</button>
    </mat-dialog-actions>
  `,
})
export class PdfViewerDialog {
  protected readonly data = inject<PdfViewerDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(AdminApiService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly url = signal<SafeResourceUrl | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly downloadUrl = this.api.documentDownloadUrl(this.data.documentId, this.data.version);

  constructor() {
    let objectUrl: string | null = null;
    let destroyed = false;
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
    void (async () => {
      try {
        const bytes = await this.api.documentFile(this.data.documentId, this.data.version);
        // Boîte fermée pendant le chargement : rien à créer, donc rien à libérer.
        if (destroyed) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        this.url.set(this.sanitizer.bypassSecurityTrustResourceUrl(objectUrl));
      } catch (failure) {
        this.error.set(describeHttpError(failure, 'Le document n’a pas pu être ouvert. Vous pouvez le télécharger à la place, ou réessayer dans un instant.').message);
      }
    })();
  }
}
