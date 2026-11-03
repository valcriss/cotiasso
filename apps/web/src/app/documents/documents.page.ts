import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type DocumentDetail,
  type DocumentOptions,
  type DocumentSummary,
  type DocumentUploadResult,
} from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { FileDropzone } from '../ui/file-dropzone';
import { PageHeader } from '../ui/page-header';
import { formatSize, objectTypeLabel } from './format';
import { UploadDialog, type UploadDialogData } from './upload-dialog';
import { Skeleton } from '../ui/skeleton';

@Component({
  selector: 'app-documents-page',
  imports: [FileDropzone, Skeleton, PageHeader, DatePipe, ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .file-input {
      margin: 0 0 12px;
    }
    .lock {
      font-size: 16px;
      height: 16px;
      vertical-align: -3px;
      width: 16px;
    }
    tr.selected td {
      background: var(--mat-sys-surface-container-low);
    }
    .versions li {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 4px 0;
    }
    .versions,
    .links {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
  `,
  template: `
    <app-page-header
      title="Documents"
      icon="description"
      description="Factures, devis, procès-verbaux… Tous vos justificatifs au même endroit, conservés sans pouvoir être supprimés, avec l’historique de leurs versions."
    >
      @if (canCreate()) {
        <button mat-flat-button type="button" (click)="openUpload()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">upload_file</mat-icon>
          Déposer un document
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    <form class="panel filters" [formGroup]="filters" (ngSubmit)="search()">
      <mat-form-field appearance="outline">
        <mat-label>Rechercher un titre</mat-label>
        <input matInput formControlName="q" />
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Catégorie</mat-label>
        <mat-select formControlName="category">
          <mat-option value="">Toutes</mat-option>
          @for (category of options()?.categories ?? []; track category.key) {
            <mat-option [value]="category.key">{{ category.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-checkbox formControlName="includeArchived">Inclure les archivés</mat-checkbox>
      <div class="actions">
        <button mat-flat-button type="submit"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">filter_alt</mat-icon> Filtrer</button>
      </div>
    </form>

    @if (selected(); as doc) {
      <section class="panel" aria-label="Détail du document">
        <div class="head">
          <h3>
            @if (doc.restricted) {
              <mat-icon class="lock" fontSet="material-icons-outlined" aria-label="Document restreint">lock</mat-icon>
            }
            {{ doc.title }}
          </h3>
          <button mat-button type="button" (click)="close()">Fermer</button>
        </div>
        <p class="muted">
          {{ categoryLabel(doc.category) }} · {{ doc.versionCount }} version(s)
          @if (doc.archivedAt) {
            · <strong>Archivé</strong>
          }
        </p>

        <div class="actions">
          <a mat-flat-button [href]="downloadUrl(doc.id)">Télécharger la dernière version</a>
          @if (canCreate()) {
            @if (doc.archivedAt) {
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="setArchived(doc, false)">Réactiver</button>
            } @else {
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="setArchived(doc, true)">Archiver</button>
            }
          }
        </div>

        <h4>Versions</h4>
        <ul class="versions">
          @for (version of doc.versions; track version.number) {
            <li>
              <span>
                <strong>v{{ version.number }}</strong> · {{ version.originalName }} · {{ size(version.size) }} ·
                {{ version.uploadedAt | date: 'dd/MM/yyyy HH:mm' }}
                @if (version.comment) {
                  <span class="muted"> · {{ version.comment }}</span>
                }
              </span>
              <a mat-button [href]="downloadUrl(doc.id, version.number)">Télécharger</a>
            </li>
          }
        </ul>
        @if (canCreate() && !doc.archivedAt) {
          <div class="file-input">
            <label for="version-file">Ajouter une version</label>
            <app-file-dropzone inputId="version-file" label="Nouvelle version du fichier" [accept]="accept()" [fileName]="versionFile()?.name ?? ''" (picked)="pickFile($event)" />
            <button mat-stroked-button type="button" [disabled]="busy() || !versionFile()" (click)="addVersion(doc)">
              Déposer cette version
            </button>
          </div>
        }

        <h4>Liens</h4>
        <ul class="links">
          @for (link of doc.links; track link.id) {
            <li>
              {{ objectLabel(link.objectType) }} · <code>{{ link.objectId }}</code>
              @if (canCreate() && !doc.archivedAt) {
                <button mat-button type="button" [disabled]="busy()" (click)="removeLink(doc, link.id)">Retirer</button>
              }
            </li>
          } @empty {
            <li class="muted">Aucun lien.</li>
          }
        </ul>
        @if (canCreate() && !doc.archivedAt) {
          <form class="actions" [formGroup]="linkForm" (ngSubmit)="addLink(doc)" novalidate>
            <mat-form-field appearance="outline" class="inline">
              <mat-label>Type d'objet</mat-label>
              <mat-select formControlName="objectType">
                @for (type of options()?.objectTypes ?? []; track type) {
                  <mat-option [value]="type">{{ objectLabel(type) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="inline">
              <mat-label>Identifiant</mat-label>
              <input matInput formControlName="objectId" />
            </mat-form-field>
            <button mat-stroked-button type="submit" [disabled]="busy()">Lier</button>
          </form>
        }
      </section>
    }

    @if (loading()) {
      <app-skeleton variant="table" />
    } @else if (documents().length === 0) {
      <p class="muted">Aucun document ne correspond à ces critères.@if (canCreate()) { Utilisez « Déposer un document » pour ajouter le premier. }</p>
    } @else {
      <table class="table">
        <caption class="sr-only">Documents</caption>
        <thead>
          <tr>
            <th scope="col">Titre</th>
            <th scope="col">Catégorie</th>
            <th scope="col">Dernier fichier</th>
            <th scope="col">Mis à jour</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (doc of documents(); track doc.id) {
            <tr [class.selected]="selected()?.id === doc.id" [class.disabled]="doc.archivedAt">
              <td>
                @if (doc.restricted) {
                  <mat-icon class="lock" fontSet="material-icons-outlined" aria-label="Document restreint">lock</mat-icon>
                }
                <strong>{{ doc.title }}</strong>
                @if (doc.archivedAt) {
                  <span class="muted"> (archivé)</span>
                }
              </td>
              <td>{{ categoryLabel(doc.category) }}</td>
              <td>
                {{ doc.latest.originalName }}
                <div class="muted">{{ size(doc.latest.size) }} · v{{ doc.latest.number }}</div>
              </td>
              <td>{{ doc.updatedAt | date: 'dd/MM/yyyy' }}</td>
              <td class="row-actions">
                <button mat-button type="button" (click)="open(doc)">Ouvrir</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (total() > documents().length) {
        <p class="muted">{{ documents().length }} document(s) affiché(s) sur {{ total() }}.</p>
        <div class="actions more">
          <button mat-stroked-button type="button" (click)="loadMore()">Charger plus</button>
        </div>
      }
    }
  `,
})
export class DocumentsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly canCreate = computed(() => {
    this.auth.permissions();
    return this.auth.can('documents:create');
  });
  protected readonly canSeeRestricted = computed(() => {
    this.auth.permissions();
    return this.auth.can('documents.restricted:view');
  });

  protected readonly options = signal<DocumentOptions | null>(null);
  protected readonly documents = signal<DocumentSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly selected = signal<DocumentDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly versionFile = signal<File | null>(null);
  private page = 1;

  protected readonly accept = computed(() => (this.options()?.allowedExtensions ?? []).map((e) => `.${e}`).join(','));
  protected readonly extensions = computed(() => (this.options()?.allowedExtensions ?? []).join(', '));

  protected readonly filters = this.fb.group({ q: '', category: '', includeArchived: false });
  protected readonly linkForm = this.fb.group({ objectType: ['project'], objectId: [''] });

  protected readonly size = formatSize;
  protected readonly objectLabel = objectTypeLabel;
  protected categoryLabel = (key: string) => this.options()?.categories.find((c) => c.key === key)?.label ?? key;
  protected downloadUrl = (id: string, version?: number) => this.api.documentDownloadUrl(id, version);

  constructor() {
    void this.init();
  }

  protected async openUpload(): Promise<void> {
    const options = this.options();
    if (!options) return;
    const result = await this.dialogs.open<DocumentUploadResult, UploadDialogData>(UploadDialog, {
      size: 'md',
      data: { options, canSeeRestricted: this.canSeeRestricted() },
    });
    if (!result) return;
    this.announce(result.duplicates, 'Document déposé.');
    this.selected.set(result.document);
    await this.search();
  }

  protected pickFile(file: File): void {
    this.versionFile.set(file);
  }

  protected async search(): Promise<void> {
    this.page = 1;
    this.documents.set([]);
    await this.fetch();
  }

  protected async loadMore(): Promise<void> {
    this.page += 1;
    await this.fetch();
  }

  protected async open(doc: DocumentSummary): Promise<void> {
    await this.run(async () => this.selected.set(await this.api.getDocument(doc.id)));
  }

  protected close(): void {
    this.selected.set(null);
    this.versionFile.set(null);
  }

  protected async addVersion(doc: DocumentDetail): Promise<void> {
    const file = this.versionFile();
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await this.run(async () => {
      const result = await this.api.addDocumentVersion(doc.id, form);
      this.announce(result.duplicates, 'Nouvelle version déposée.');
      this.selected.set(result.document);
      this.versionFile.set(null);
      await this.search();
    });
  }

  protected setArchived(doc: DocumentDetail, archived: boolean): Promise<void> {
    return this.run(async () => {
      this.selected.set(await this.api.setDocumentArchived(doc.id, archived));
      await this.search();
    });
  }

  protected addLink(doc: DocumentDetail): Promise<void> {
    const { objectType, objectId } = this.linkForm.getRawValue();
    if (!objectId.trim()) {
      this.error.set("Saisissez l'identifiant de l'objet à lier.");
      return Promise.resolve();
    }
    return this.run(async () => {
      this.selected.set(await this.api.addDocumentLink(doc.id, objectType, objectId.trim()));
      this.linkForm.controls.objectId.setValue('');
    });
  }

  protected removeLink(doc: DocumentDetail, linkId: string): Promise<void> {
    return this.run(async () => this.selected.set(await this.api.removeDocumentLink(doc.id, linkId)));
  }

  /** Confirme le dépôt ; un fichier identique à un document existant est signalé sans être bloqué. */
  private announce(duplicates: { title: string }[], base: string): void {
    if (duplicates.length === 0) this.notifier.success(base);
    else this.notifier.notice(`${base} Attention : ce fichier est identique à un document déjà déposé (${duplicates.map((d) => d.title).join(', ')}).`);
  }

  private async init(): Promise<void> {
    try {
      this.options.set(await this.api.documentOptions());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les options.').message);
    }
    await this.fetch();
  }

  private async fetch(): Promise<void> {
    this.loading.set(this.page === 1);
    try {
      const { q, category, includeArchived } = this.filters.getRawValue();
      const result = await this.api.listDocuments({ q, category, includeArchived, page: this.page });
      this.documents.update((current) => (this.page === 1 ? result.items : [...current, ...result.items]));
      this.total.set(result.total);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les documents.').message);
    } finally {
      this.loading.set(false);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Action impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
  }
}
