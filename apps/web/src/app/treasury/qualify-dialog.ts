import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type AccountInfo, type FinancialAccountInfo, type ProjectInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

export interface QualifyDialogData {
  account: FinancialAccountInfo;
  accounts: AccountInfo[];
  projects: ProjectInfo[];
  transactionIds: string[];
}

/** Applique un compte de contrepartie et/ou un projet à une sélection de transactions. Renvoie le nombre de transactions modifiées. */
@Component({
  selector: 'app-qualify-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="'Qualifier ' + data.transactionIds.length + ' transaction(s)'"
        description="Choisissez ce qui vaut pour toutes les transactions cochées : d'où vient / où va l'argent, et le projet concerné. Ce que vous laissez sur « Ne pas changer » reste tel quel pour chaque transaction."
        submitLabel="Appliquer à la sélection"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>D'où vient / où va cet argent ?</mat-label>
          <mat-select formControlName="counterpartAccountId">
            <mat-option value="">Ne pas changer</mat-option>
            @for (candidate of counterparts(); track candidate.id) {
              <mat-option [value]="candidate.id">{{ candidate.number }} — {{ candidate.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Projet</mat-label>
          <mat-select formControlName="projectId">
            <mat-option value="">Ne pas changer</mat-option>
            @for (project of data.projects; track project.id) {
              <mat-option [value]="project.id">{{ project.code }} — {{ project.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class QualifyDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<QualifyDialog, { updated: number }>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<QualifyDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly counterparts = computed(() => this.data.accounts.filter((a) => a.active && a.id !== this.data.account.accountId));
  protected readonly form = this.fb.group({ counterpartAccountId: [''], projectId: [''] });

  protected async save(): Promise<void> {
    const { counterpartAccountId, projectId } = this.form.getRawValue();
    if (!counterpartAccountId && !projectId) {
      this.error.set("Choisissez un compte de contrepartie et/ou un projet à appliquer, ou fermez la fenêtre pour ne rien changer.");
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.qualifyTransactions(this.data.account.id, {
          transactionIds: this.data.transactionIds,
          ...(counterpartAccountId && { counterpartAccountId }),
          ...(projectId && { projectId }),
        }),
      );
    } catch (failure) {
      this.error.set(describeHttpError(failure, "La qualification n'a pas pu être appliquée. Rien n'a été modifié.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
