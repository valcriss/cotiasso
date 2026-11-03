import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type DocumentDetail, type DocumentOptions } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

export interface DocumentCategoryDialogData {
  document: DocumentDetail;
  categories: DocumentOptions['categories'];
}

@Component({
  selector: 'app-document-category-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatSelectModule],
  template: `
    <form (submit)="$event.preventDefault(); save()" novalidate>
      <app-form-dialog title="Changer la catégorie"
        [description]="'Choisissez comment classer « ' + data.document.title + ' » pour le retrouver dans Documents.'"
        [dirty]="category.value !== data.document.category" [busy]="busy()" [error]="error()"
        [submitDisabled]="category.value === data.document.category">
        <mat-form-field appearance="outline">
          <mat-label>Catégorie</mat-label>
          <mat-select [formControl]="category" required>
            @for (option of data.categories; track option.key) {
              <mat-option [value]="option.key">{{ option.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class DocumentCategoryDialog {
  protected readonly data = inject<DocumentCategoryDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(AdminApiService);
  private readonly dialog = inject(MatDialogRef<DocumentCategoryDialog, DocumentDetail>);
  protected readonly category = new FormControl(this.data.document.category, { nonNullable: true });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    const category = this.category.value;
    if (this.busy() || category === this.data.document.category) return;
    this.busy.set(true);
    this.error.set(null);
    this.category.disable();
    try {
      this.dialog.close(await this.api.updateDocument(this.data.document.id, { category }));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'La catégorie n’a pas pu être enregistrée. Réessayez.').message);
    } finally {
      this.category.enable();
      this.busy.set(false);
    }
  }
}
