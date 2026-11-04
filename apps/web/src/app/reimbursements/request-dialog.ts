import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { describeHttpError } from '../auth/error-messages';
import { todayLocalIso } from '../ui/dates';
import { DateField } from '../ui/date-field';
import { FileDropzone } from '../ui/file-dropzone';
import { FormDialog } from '../ui/form-dialog';
import { ReimbursementsApi, type ReceiptInfo, type ReimbursementInfo } from './reimbursements-api';

export interface RequestDialogData {
  /** Brouillon ou demande à corriger ; `null` pour une nouvelle demande. */
  request: ReimbursementInfo | null;
  projects: { id: string; name: string }[];
}

const INVALID = 'Vérifiez les champs signalés en rouge, puis validez de nouveau.';
const RECEIPT_MISSING = 'Ajoutez la facture, le ticket ou le reçu (photo ou PDF) : sans justificatif, la demande ne peut pas être déposée.';

/** Formulaire d'une demande de remboursement : les faits, le justificatif, puis on la dépose. Renvoie la demande déposée. */
@Component({
  selector: 'app-request-dialog',
  imports: [DateField, FileDropzone, FormDialog, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, ReactiveFormsModule],
  styles: `
    .receipts {
      display: flex;
      flex-direction: column;
      gap: 6px;
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
    }
    .receipts li {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .grow {
      flex: 1 1 180px;
    }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="data.request ? 'Demande n° ' + data.request.number : 'Nouvelle demande de remboursement'"
        [description]="
          data.request?.status === 'RETURNED'
            ? 'Corrigez ce qu’on vous a demandé de changer, puis déposez de nouveau votre demande.'
            : 'Vous avez payé quelque chose de votre poche pour l’association ? Dites-nous quoi et joignez le ticket ou la facture : le bureau donne son accord, puis le trésorier vous rembourse.'
        "
        [submitLabel]="data.request?.status === 'RETURNED' ? 'Redéposer ma demande' : 'Déposer ma demande'"
        [dirty]="form.dirty || files().length > 0"
        [busy]="busy()"
        [error]="error()"
      >
        @if (data.request?.lastMessage; as message) {
          <p class="alert" role="status">À corriger : {{ message }}</p>
        }
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Montant payé (€)</mat-label>
            <input matInput formControlName="amount" inputmode="decimal" placeholder="42,50" required />
            <mat-hint>Ce que vous avez payé, en euros.</mat-hint>
            @if (form.controls.amount.hasError('required') || form.controls.amount.hasError('pattern')) {
              <mat-error>Indiquez le montant, par exemple 42,50.</mat-error>
            }
          </mat-form-field>
          <app-date-field class="grow" label="Date de la dépense" formControlName="expenseDate" errorText="Indiquez la date de la dépense." required />
        </div>
        <mat-form-field appearance="outline">
          <mat-label>À quoi correspond cette dépense ?</mat-label>
          <textarea matInput formControlName="reason" rows="3" placeholder="Peinture pour l’atelier du 12 mars" required></textarea>
          @if (form.controls.reason.hasError('required') || form.controls.reason.hasError('minlength')) {
            <mat-error>Dites en quelques mots à quoi servait cette dépense.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Pour quel projet ? (facultatif)</mat-label>
          <mat-select formControlName="projectId">
            <mat-option value="">Fonctionnement de l’association (par défaut)</mat-option>
            @for (project of data.projects; track project.id) {
              <mat-option [value]="project.id">{{ project.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>Si la dépense concerne une action précise (un festival, des ateliers…).</mat-hint>
        </mat-form-field>

        <div>
          <p class="muted"><strong>Justificatif</strong> : la facture, le ticket ou le reçu, en photo ou en PDF.</p>
          <app-file-dropzone inputId="receipt-file" label="Justificatif de la dépense" accept=".pdf,.png,.jpg,.jpeg" formats="PDF, PNG, JPEG" [disabled]="busy()" (picked)="addFile($event)" />
          <ul class="receipts" aria-label="Justificatifs de la demande">
            @for (receipt of receipts(); track receipt.id) {
              <li>
                <span><mat-icon fontSet="material-icons-outlined" aria-hidden="true">attach_file</mat-icon> {{ receipt.title }}</span>
                <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="'Retirer ' + receipt.title" (click)="removeReceipt(receipt)">Retirer</button>
              </li>
            }
            @for (file of files(); track file.name + $index) {
              <li>
                <span><mat-icon fontSet="material-icons-outlined" aria-hidden="true">attach_file</mat-icon> {{ file.name }}</span>
                <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="'Retirer ' + file.name" (click)="removeFile($index)">Retirer</button>
              </li>
            }
          </ul>
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class RequestDialog {
  private readonly api = inject(ReimbursementsApi);
  private readonly reference = inject<MatDialogRef<RequestDialog, ReimbursementInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<RequestDialogData>(MAT_DIALOG_DATA);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly files = signal<File[]>([]);
  protected readonly receipts = signal<ReceiptInfo[]>([]);
  /** Brouillon créé par un premier envoi qui a échoué plus loin : on le reprend au lieu d'en créer un second. */
  private draft: ReimbursementInfo | null = this.data.request;

  protected readonly form = this.fb.group({
    amount: [this.data.request ? this.data.request.amount.replace('.', ',') : '', [Validators.required, Validators.pattern(/^\d{1,12}([.,]\d{1,2})?$/)]],
    expenseDate: [this.data.request?.expenseDate ?? todayLocalIso(), [Validators.required]],
    reason: [this.data.request?.reason ?? '', [Validators.required, Validators.minLength(3)]],
    projectId: [this.data.request?.projectId ?? ''],
  });

  constructor() {
    if (this.data.request) void this.loadReceipts(this.data.request.id);
  }

  protected addFile(file: File): void {
    this.files.update((list) => [...list, file]);
    this.error.set(null);
  }

  protected removeFile(index: number): void {
    this.files.update((list) => list.filter((_, i) => i !== index));
  }

  protected async removeReceipt(receipt: ReceiptInfo): Promise<void> {
    if (!this.draft) return;
    try {
      await this.api.archiveReceipt(this.draft.id, receipt.id);
      this.receipts.update((list) => list.filter((r) => r.id !== receipt.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Le justificatif n’a pas pu être retiré. Réessayez dans un instant.').message);
    }
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    if (this.files().length + this.receipts().length === 0) {
      this.error.set(RECEIPT_MISSING);
      return;
    }
    const raw = this.form.getRawValue();
    const body = { amount: raw.amount.replace(',', '.'), expenseDate: raw.expenseDate, reason: raw.reason.trim(), projectId: raw.projectId || null };
    this.error.set(null);
    this.busy.set(true);
    try {
      this.draft = this.draft ? await this.api.update(this.draft.id, { ...body, version: this.draft.version }) : await this.api.create(body);
      for (const file of [...this.files()]) {
        await this.api.addReceipt(this.draft.id, file);
        this.files.update((list) => list.filter((f) => f !== file));
      }
      this.reference.close(await this.api.submit(this.draft.id));
    } catch (failure) {
      // La saisie est conservée : si le brouillon existe déjà, la prochaine tentative le reprend.
      if (this.draft) this.draft = await this.api.get(this.draft.id).catch(() => this.draft);
      this.error.set(describeHttpError(failure, 'La demande n’a pas pu être déposée. Votre saisie est conservée : réessayez dans un instant.').message);
    } finally {
      this.busy.set(false);
    }
  }

  private async loadReceipts(id: string): Promise<void> {
    this.receipts.set(await this.api.receipts(id).catch(() => []));
  }
}
