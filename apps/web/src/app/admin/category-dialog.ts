import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { AdminApiService, type AccountInfo, type OperationCategoryInfo } from './admin-api.service';

export interface CategoryDialogData {
  /** Catégorie à modifier, ou `null` pour en créer une. */
  category: OperationCategoryInfo | null;
  accounts: AccountInfo[];
}

/** Création et modification d'une catégorie d'opération. Renvoie la catégorie enregistrée. */
@Component({
  selector: 'app-category-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="category ? 'Modifier la catégorie' : 'Nouvelle catégorie'"
        description="Une catégorie est un mot simple (« Assurance », « Dons »…) que l’on choisit en enregistrant de l’argent reçu ou dépensé. Elle renvoie à un compte du plan comptable, que seul l’expert-comptable a besoin de voir."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Type d’opération</mat-label>
          <mat-select formControlName="direction">
            <mat-option value="IN">Argent reçu (recette)</mat-option>
            <mat-option value="OUT">Argent dépensé (dépense)</mat-option>
          </mat-select>
          @if (category) {
            <mat-hint>Le type d’une catégorie ne se change pas.</mat-hint>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Nom de la catégorie</mat-label>
          <input matInput formControlName="label" placeholder="Abonnement logiciel" autocomplete="off" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Donnez un nom à la catégorie.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Aide (facultatif)</mat-label>
          <input matInput formControlName="hint" placeholder="Outils en ligne payés chaque mois" autocomplete="off" />
          <mat-hint>Une phrase affichée à la personne qui choisit cette catégorie.</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Compte comptable correspondant</mat-label>
          <mat-select formControlName="accountId" required>
            @for (account of choices(); track account.id) {
              <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
            }
          </mat-select>
          <mat-hint>{{ direction() === 'IN' ? 'Un compte de produits (numéro en 7).' : 'Un compte de charges (numéro en 6).' }} Dans le doute, demandez à votre expert-comptable.</mat-hint>
          @if (form.controls.accountId.hasError('required')) {
            <mat-error>Choisissez le compte correspondant.</mat-error>
          }
        </mat-form-field>
        @if (direction() === 'IN') {
          <mat-form-field appearance="outline">
            <mat-label>Rôle particulier (facultatif)</mat-label>
            <mat-select formControlName="usage">
              <mat-option value="">Aucun</mat-option>
              <mat-option value="MEMBERSHIP">Cotisations des adhérents</mat-option>
              <mat-option value="GRANT">Subventions</mat-option>
            </mat-select>
            <mat-hint>La catégorie proposée d’office quand on enregistre un règlement de cotisation ou un versement de subvention. Une seule par rôle.</mat-hint>
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class CategoryDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CategoryDialog, OperationCategoryInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly data = inject<CategoryDialogData>(MAT_DIALOG_DATA);
  protected readonly category = this.data.category;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    direction: [this.category?.direction ?? ('OUT' as 'IN' | 'OUT')],
    label: [this.category?.label ?? '', [Validators.required]],
    hint: [this.category?.hint ?? ''],
    accountId: [this.category?.account.id ?? '', [Validators.required]],
    usage: [this.category?.usage ?? ''],
  });
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly direction = computed(() => this.values().direction ?? 'OUT');
  protected readonly choices = computed(() => this.data.accounts.filter((a) => a.active && a.number.startsWith(this.direction() === 'IN' ? '7' : '6')));

  constructor() {
    if (this.category) this.form.controls.direction.disable();
    this.form.controls.direction.valueChanges.subscribe(() => this.form.controls.accountId.setValue(''));
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const value = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const usage = value.usage === '' ? null : (value.usage as 'MEMBERSHIP' | 'GRANT');
      if (this.category) {
        this.reference.close(await this.api.updateOperationCategory(this.category.id, { label: value.label.trim(), hint: value.hint.trim(), accountId: value.accountId, usage }));
      } else {
        const created = await this.api.createOperationCategory({ direction: value.direction, label: value.label.trim(), hint: value.hint.trim(), accountId: value.accountId });
        // Le rôle se pose après la création : s'il est refusé, la catégorie existe déjà et la personne est prévenue.
        this.reference.close(usage ? await this.api.updateOperationCategory(created.id, { usage }) : created);
      }
    } catch (failure) {
      const described = describeHttpError(failure, "La catégorie n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
