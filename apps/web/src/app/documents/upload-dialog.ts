import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type DocumentOptions, type DocumentUploadResult } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FileDropzone } from '../ui/file-dropzone';
import { FormDialog } from '../ui/form-dialog';
import { titleFromFilename } from './format';

export interface UploadDialogData {
  options: DocumentOptions;
  canSeeRestricted: boolean;
  /** Objets auxquels le document est lié dès le dépôt (ex. le projet depuis sa fiche). */
  links?: { objectType: string; objectId: string }[];
}

/** Dépôt d'un document, en boîte de dialogue. Renvoie le résultat du dépôt (document et doublons éventuels). */
@Component({
  selector: 'app-upload-dialog',
  imports: [FileDropzone, ReactiveFormsModule, FormDialog, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  styles: `
    .file-input {
      margin: 0 0 16px;
    }
    .file-input label {
      display: block;
      font: var(--mat-sys-label-large);
      margin: 0 0 6px;
    }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Déposer un document"
        description="Ajoutez une facture, un devis, un procès-verbal… Le fichier est conservé tel quel et ne peut pas être supprimé : en cas d’erreur, vous pourrez déposer une nouvelle version."
        submitLabel="Déposer"
        [dirty]="form.dirty || file() !== null"
        [busy]="busy()"
        [error]="error()"
      >
        <div class="file-input">
          <label for="upload-file">Fichier</label>
          <app-file-dropzone inputId="upload-file" label="Fichier à déposer" [accept]="accept()" [formats]="extensions()" [fileName]="file()?.name ?? ''" (picked)="pickFile($event)" />
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Titre</mat-label>
          <input matInput formControlName="title" required />
          @if (form.controls.title.hasError('required')) {
            <mat-error>Donnez un titre au document : il servira à le retrouver.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Catégorie</mat-label>
          <mat-select formControlName="category" required>
            @for (category of data.options.categories; track category.key) {
              <mat-option [value]="category.key">{{ category.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Commentaire (facultatif)</mat-label>
          <input matInput formControlName="comment" />
        </mat-form-field>
        @if (data.canSeeRestricted) {
          <mat-checkbox formControlName="restricted">Document restreint (visible des seuls rôles autorisés)</mat-checkbox>
        }
      </app-form-dialog>
    </form>
  `,
})
export class UploadDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<UploadDialog, DocumentUploadResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<UploadDialogData>(MAT_DIALOG_DATA);

  protected readonly file = signal<File | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly accept = computed(() => this.data.options.allowedExtensions.map((e) => `.${e}`).join(','));
  protected readonly extensions = computed(() => this.data.options.allowedExtensions.join(', '));
  protected readonly form = this.fb.group({
    title: ['', [Validators.required]],
    category: ['facture', [Validators.required]],
    comment: '',
    restricted: false,
  });

  protected pickFile(file: File): void {
    this.file.set(file);
    if (file && !this.form.controls.title.value) this.form.controls.title.setValue(titleFromFilename(file.name));
  }

  protected async save(): Promise<void> {
    const file = this.file();
    if (!file) {
      this.error.set('Choisissez un fichier à déposer : utilisez le champ « Fichier » ci-dessus.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis déposez de nouveau.');
      return;
    }
    const { title, category, comment, restricted } = this.form.getRawValue();
    const body = new FormData();
    body.append('title', title);
    body.append('category', category);
    if (comment) body.append('comment', comment);
    if (restricted) body.append('restricted', 'true');
    if (this.data.links && this.data.links.length > 0) body.append('links', JSON.stringify(this.data.links));
    body.append('file', file);

    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.uploadDocument(body));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le document n'a pas pu être déposé. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
