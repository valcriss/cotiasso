import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type CorrectOperationBody, type GuidedOperationResult, type OperationCategoryInfo, type ProjectInfo, type TransactionInfo } from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { FrDatePipe } from '../ui/fr-date.pipe';

export interface CorrectDialogData {
  transaction: TransactionInfo;
  accountName: string;
  categories: OperationCategoryInfo[];
  projects: ProjectInfo[];
}

/**
 * « Corriger » une opération déjà enregistrée dans les comptes : catégorie, projet ou description. Le logiciel annule l'opération
 * (une opération inverse est ajoutée, rien n'est effacé) puis en enregistre une nouvelle, d'un seul bloc. Le montant et la date
 * ne se corrigent pas ici : ils sont figés une fois l'opération enregistrée.
 */
@Component({
  selector: 'app-correct-dialog',
  imports: [FrDatePipe, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Corriger cette opération"
        description="Changez la catégorie, le projet ou la description. L’opération actuelle est annulée (une opération inverse est ajoutée, rien n’est effacé) puis remplacée par une nouvelle, d’un seul geste : tout est fait ou rien n’est modifié."
        submitLabel="Corriger l’opération"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <p class="summary">
          <strong>{{ data.transaction.label }}</strong><br />
          <span class="muted">{{ data.transaction.operationDate | frDate }} · {{ amount(data.transaction.amount) }} € · {{ data.accountName }}</span>
        </p>
        <mat-form-field appearance="outline">
          <mat-label>{{ incoming ? 'D’où vient cet argent ?' : 'À quoi a servi cet argent ?' }}</mat-label>
          <mat-select formControlName="categoryId">
            @for (category of choices; track category.id) {
              <mat-option [value]="category.id">{{ category.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Pour quel projet ?</mat-label>
          <mat-select formControlName="projectId">
            <mat-option value="">Fonctionnement général (par défaut)</mat-option>
            @for (project of data.projects; track project.id) {
              <mat-option [value]="project.id">{{ project.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <input matInput formControlName="label" autocomplete="off" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Décrivez l’opération en quelques mots.</mat-error>
          }
        </mat-form-field>
        <p class="muted">
          Le montant et la date ne se corrigent pas ici : ils sont définitifs une fois l’opération enregistrée. Si l’erreur porte sur le montant ou
          la date, signalez-le à la personne qui administre la comptabilité.
        </p>
      </app-form-dialog>
    </form>
  `,
})
export class CorrectDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CorrectDialog, GuidedOperationResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<CorrectDialogData>(MAT_DIALOG_DATA);
  protected readonly amount = formatApiAmount;

  protected readonly incoming = !this.data.transaction.amount.startsWith('-');
  protected readonly choices = this.data.categories.filter((c) => c.active && c.direction === (this.incoming ? 'IN' : 'OUT'));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  private readonly initial = {
    categoryId: this.choices.find((c) => c.account.id === this.data.transaction.counterpartAccountId)?.id ?? '',
    projectId: this.data.transaction.projectId ?? '',
    label: this.data.transaction.label,
  };
  protected readonly form = this.fb.group({
    categoryId: [this.initial.categoryId],
    projectId: [this.initial.projectId],
    label: [this.initial.label, [Validators.required]],
  });

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    if (this.form.invalid || raw.label.trim() === '') {
      this.form.markAllAsTouched();
      this.error.set('Décrivez l’opération en quelques mots, puis validez de nouveau.');
      return;
    }
    // On n'envoie que ce qui change : le serveur refuse une correction qui ne change rien.
    const body: CorrectOperationBody = {
      ...(raw.categoryId && raw.categoryId !== this.initial.categoryId && { categoryId: raw.categoryId }),
      ...(raw.projectId !== this.initial.projectId && { projectId: raw.projectId || null }),
      ...(raw.label.trim() !== this.initial.label && { label: raw.label.trim() }),
    };
    if (Object.keys(body).length === 0) {
      this.error.set('Rien n’a changé : choisissez une autre catégorie, un autre projet ou une autre description.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.correctOperation(this.data.transaction.id, body));
    } catch (failure) {
      const described = describeHttpError(failure, "L'opération n'a pas pu être corrigée. Rien n'a été modifié : réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
