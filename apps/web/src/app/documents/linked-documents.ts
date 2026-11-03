import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminApiService, type DocumentSummary } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { formatSize } from './format';
import { UploadDialog } from './upload-dialog';

export type LinkedObjectType = 'project' | 'grant' | 'frozen-report' | 'transaction';

/**
 * Documents liés à un projet ou à une subvention, depuis sa fiche (ADR 0024, tranche 4.5) : liste, téléchargement et dépôt. Le
 * serveur ne renvoie que les documents que la personne a le droit de voir ; elle peut aussi les consulter sans accéder à la page
 * Documents générale, réservée aux droits globaux.
 */
@Component({
  selector: 'app-linked-documents',
  imports: [DatePipe, MatButtonModule, MatIconModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .size {
      white-space: nowrap;
      text-align: right;
    }
    .note {
      display: block;
      font-size: 0.85em;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Documents de ' + name()">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">folder</mat-icon><span>Documents</span></h3>
        <div class="actions">
          @if (canDeposit()) {
            <button mat-stroked-button type="button" (click)="deposit()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">upload_file</mat-icon> Déposer un document
            </button>
          }
        </div>
      </div>
      <p class="muted">
        {{ intro() }} Un document déposé ici est conservé tel quel et ne se supprime pas : en cas d'erreur, déposez une nouvelle version.
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (documents().length === 0) {
        <p class="muted">
          @if (canDeposit()) {
            Aucun document pour l'instant. Cliquez sur « Déposer un document » pour ajouter une facture, un ticket ou un devis.
          } @else {
            Aucun document n'est disponible ici.
          }
        </p>
      } @else {
        <table class="table">
          <caption class="sr-only">Documents</caption>
          <thead>
            <tr>
              <th scope="col">Titre</th>
              <th scope="col">Fichier</th>
              <th scope="col">Mis à jour</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (document of documents(); track document.id) {
              <tr>
                <td>
                  {{ document.title }}
                  <span class="note">{{ category(document.category) }}{{ document.versionCount > 1 ? ' · ' + document.versionCount + ' versions' : '' }}</span>
                </td>
                <td>
                  {{ document.latest.originalName }}
                  <span class="note">{{ size(document.latest.size) }}</span>
                </td>
                <td>{{ document.updatedAt | date: 'dd/MM/yyyy' }}</td>
                <td class="row-actions">
                  <a mat-button [href]="downloadUrl(document.id)" [attr.aria-label]="'Télécharger ' + document.title">Télécharger</a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class LinkedDocuments {
  private readonly api = inject(AdminApiService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  /** `project`, `grant`, `transaction` ou `frozen-report` : le type d'objet auquel les documents sont liés. */
  readonly objectType = input.required<LinkedObjectType>();
  readonly objectId = input.required<string>();
  /** Nom de l'objet, pour l'accessibilité. */
  readonly name = input('');
  /** Droit de déposer : `documents:create` global, ou sur ce projet. */
  readonly canDeposit = input(false);

  protected readonly documents = signal<DocumentSummary[]>([]);
  protected readonly categories = signal<Record<string, string>>({});
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly size = formatSize;
  protected readonly downloadUrl = (id: string) => this.api.documentDownloadUrl(id);

  constructor() {
    effect(() => {
      const type = this.objectType();
      const id = this.objectId();
      untracked(() => void this.load(type, id));
    });
  }

  protected intro(): string {
    switch (this.objectType()) {
      case 'frozen-report':
        return "Le procès-verbal de l'assemblée générale et les pièces de ces rapports.";
      case 'transaction':
        return 'Les factures, tickets et autres pièces qui justifient ce mouvement.';
      case 'grant':
        return 'Les devis, factures et conventions de cette subvention.';
      default:
        return 'Les devis, factures et conventions de ce projet.';
    }
  }

  protected category(key: string): string {
    return this.categories()[key] ?? key;
  }

  protected async deposit(): Promise<void> {
    let options;
    try {
      options = await this.api.documentOptions();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Impossible de préparer le dépôt d'un document.").message);
      return;
    }
    const result = await this.dialogs.open<{ document: { title: string }; duplicates: { title: string }[] }>(UploadDialog, {
      size: 'md',
      data: { options, canSeeRestricted: false, links: [{ objectType: this.objectType(), objectId: this.objectId() }] },
    });
    if (!result) return;
    this.notifier.success(`Document « ${result.document.title} » déposé.`);
    await this.load(this.objectType(), this.objectId());
  }

  private async load(type: LinkedObjectType, id: string): Promise<void> {
    this.error.set(null);
    try {
      const [page, options] = await Promise.all([
        this.api.listDocuments({ objectType: type, objectId: id }),
        this.api.documentOptions().catch(() => null),
      ]);
      this.documents.set(page.items);
      if (options) this.categories.set(Object.fromEntries(options.categories.map((c) => [c.key, c.label])));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les documents.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
