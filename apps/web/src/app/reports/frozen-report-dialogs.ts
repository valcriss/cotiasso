import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AdminApiService, type FrozenReportSummaryInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { DateField } from '../ui/date-field';

export interface FreezeDialogData {
  yearId: string;
  yearLabel: string;
  /** Il existe déjà des rapports figés pour cet exercice : un motif est alors demandé. */
  hasVersions: boolean;
  provisional: boolean;
}

/** Figer les rapports d'un exercice à l'instant : une photographie qui ne change plus, ajoutée à l'historique. */
@Component({
  selector: 'app-freeze-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Figer les rapports"
        [description]="description"
        submitLabel="Figer maintenant"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom de cette version (facultatif)</mat-label>
          <input matInput formControlName="label" autocomplete="off" />
          <mat-hint>Par exemple : « Avant l’assemblée générale ».</mat-hint>
        </mat-form-field>
        @if (data.hasVersions) {
          <mat-form-field appearance="outline">
            <mat-label>Pourquoi une nouvelle version ?</mat-label>
            <input matInput formControlName="reason" autocomplete="off" required />
            <mat-hint>Quelques mots : « une facture avait été oubliée ». L’ancienne version reste consultable.</mat-hint>
            @if (form.controls.reason.touched && form.controls.reason.hasError('minlength')) {
              <mat-error>Écrivez au moins 5 caractères.</mat-error>
            }
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class FreezeDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<FreezeDialog, FrozenReportSummaryInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<FreezeDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly description = `Le compte de résultat, le bilan et l’état de trésorerie de l’exercice ${this.data.yearLabel} sont enregistrés tels qu’ils sont aujourd’hui, avec l’exercice précédent. Rien ne s’efface : si vous corrigez vos comptes plus tard, vous pourrez figer une nouvelle version, et l’ancienne restera consultable. ${
    this.data.provisional ? 'L’exercice n’est pas clôturé : ces rapports seront marqués « provisoires ».' : 'L’exercice est clôturé : ces rapports sont définitifs.'
  }`;

  protected readonly form = this.fb.group({
    label: ['', [Validators.maxLength(120)]],
    reason: ['', this.data.hasVersions ? [Validators.required, Validators.minLength(5), Validators.maxLength(300)] : [Validators.maxLength(300)]],
  });

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set(this.data.hasVersions ? 'Dites en quelques mots pourquoi vous figez une nouvelle version (5 caractères au moins).' : 'Vérifiez le nom de la version.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    const { label, reason } = this.form.getRawValue();
    try {
      this.reference.close(await this.api.freezeReports(this.data.yearId, { ...(label.trim() && { label: label.trim() }), ...(reason.trim() && { reason: reason.trim() }) }));
    } catch (failure) {
      const described = describeHttpError(failure, "Les rapports n'ont pas pu être figés. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface ApproveDialogData {
  report: FrozenReportSummaryInfo;
  yearLabel: string;
}

/** Approbation des comptes par l'assemblée générale : la date et une note ; le procès-verbal se dépose ensuite comme document. */
@Component({
  selector: 'app-approve-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Approuver les comptes"
        [description]="'L’assemblée générale approuve les comptes de l’exercice ' + data.yearLabel + ' (rapports figés, version ' + data.report.number + '). Cette étape est facultative et ne change rien à vos écritures ; elle garde la trace de la date et ne se corrige pas. Vous déposerez ensuite le procès-verbal.'"
        submitLabel="Enregistrer l’approbation"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <app-date-field label="Date de l’assemblée générale" formControlName="meetingDate" errorText="Indiquez la date de l’assemblée." required />
        <mat-form-field appearance="outline">
          <mat-label>Note (facultatif)</mat-label>
          <input matInput formControlName="note" autocomplete="off" />
          <mat-hint>Par exemple : « Approuvés à l’unanimité ».</mat-hint>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class ApproveDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<ApproveDialog, FrozenReportSummaryInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<ApproveDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    meetingDate: ['', [Validators.required]],
    note: ['', [Validators.maxLength(300)]],
  });

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('Indiquez la date de l’assemblée générale.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    const { meetingDate, note } = this.form.getRawValue();
    try {
      this.reference.close(await this.api.approveFrozenReport(this.data.report.id, { meetingDate, ...(note.trim() && { note: note.trim() }) }));
    } catch (failure) {
      const described = describeHttpError(failure, "L'approbation n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
