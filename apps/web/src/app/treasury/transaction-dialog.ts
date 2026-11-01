import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type AccountInfo,
  type FinancialAccountInfo,
  type ProjectInfo,
  type TransactionBody,
  type TransactionInfo,
} from '../admin/admin-api.service';
import { centsToApi, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { FormDialog } from '../ui/form-dialog';

export interface TransactionDialogData {
  account: FinancialAccountInfo;
  /** Comptes du plan comptable proposés comme contrepartie. */
  accounts: AccountInfo[];
  projects: ProjectInfo[];
  /** Transaction à modifier, ou `null` pour en saisir une nouvelle. */
  transaction: TransactionInfo | null;
}

const LOCK_DESCRIPTIONS = {
  RECONCILED: "Cette transaction a été rapprochée de votre relevé bancaire : son montant et sa date ne changent plus. Pour les corriger, annulez d'abord le rapprochement (page Rapprochement du compte).",
  NONE: "Une transaction est un mouvement d'argent sur ce compte. Vous pourrez la transformer ensuite en écriture comptable.",
  BANK: 'Cette transaction vient de votre relevé bancaire : son montant et sa date ne changent pas, vous pouvez compléter le reste.',
  ENTRY: "Cette transaction est liée à une écriture comptable : son montant et sa date ne changent plus. Pour les corriger, contrepassez l'écriture (l'annuler par une écriture inverse).",
  TRANSFER: "Cette transaction fait partie d'un virement interne : son montant et sa date ne changent pas. Pour les corriger, annulez le virement puis refaites-le.",
} as const;

export type TransactionDialogResult = { kind: 'saved'; transaction: TransactionInfo } | { kind: 'deleted' };

/** Saisie et modification d'une transaction (un mouvement sur le compte), en boîte de dialogue. */
@Component({
  selector: 'app-transaction-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="transaction ? 'Modifier la transaction' : 'Nouvelle transaction'"
        [description]="description"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Mouvement</mat-label>
            <mat-select formControlName="direction" [disabled]="frozen()">
              <mat-option value="in">Argent reçu (encaissement)</mat-option>
              <mat-option value="out">Argent dépensé (décaissement)</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Montant (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" placeholder="12,50" required />
            <mat-hint>Toujours positif : le sens est choisi à gauche.</mat-hint>
            @if (form.controls.amount.hasError('required')) {
              <mat-error>Indiquez le montant, par exemple 12,50.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="operationDate" required />
            @if (form.controls.operationDate.hasError('required')) {
              <mat-error>Indiquez la date de l'opération.</mat-error>
            }
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Libellé</mat-label>
          <input matInput formControlName="label" placeholder="Location de salle, cotisation de Léa…" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Décrivez en quelques mots de quoi il s'agit.</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Référence (facultatif)</mat-label>
            <input matInput formControlName="reference" placeholder="N° de facture, de chèque…" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Projet (facultatif)</mat-label>
            <mat-select formControlName="projectId">
              <mat-option value="">Aucun</mat-option>
              @for (project of data.projects; track project.id) {
                <mat-option [value]="project.id">{{ project.code }} — {{ project.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>D'où vient / où va cet argent ? (facultatif)</mat-label>
          <mat-select formControlName="counterpartAccountId">
            <mat-option value="">Je ne sais pas encore</mat-option>
            @for (candidate of counterparts(); track candidate.id) {
              <mat-option [value]="candidate.id">{{ candidate.number }} — {{ candidate.label }}</mat-option>
            }
          </mat-select>
          <mat-hint>Le compte du plan comptable concerné : il servira à préparer l'écriture.</mat-hint>
        </mat-form-field>
        @if (transaction && !frozen() && canDelete) {
          <div>
            <button mat-button class="danger" type="button" [disabled]="busy()" (click)="remove()">Supprimer cette transaction</button>
          </div>
        }
      </app-form-dialog>
    </form>
  `,
})
export class TransactionDialog {
  private readonly api = inject(AdminApiService);
  private readonly dialogs = inject(Dialogs);
  private readonly reference = inject<MatDialogRef<TransactionDialog, TransactionDialogResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<TransactionDialogData>(MAT_DIALOG_DATA);
  protected readonly transaction = this.data.transaction;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly canDelete = this.transaction?.deletable === true;
  /** Une transaction identifiée par la banque, liée à une écriture ou à un virement garde son montant et sa date : seules les informations descriptives changent. */
  protected readonly frozen = signal(!!this.transaction?.financialLock);
  protected readonly counterparts = computed(() => this.data.accounts.filter((a) => a.active && a.id !== this.data.account.accountId));
  protected readonly description = LOCK_DESCRIPTIONS[this.transaction?.financialLock ?? 'NONE'];

  protected readonly form = this.fb.group({
    direction: [this.transaction?.amount.startsWith('-') ? 'out' : 'in'],
    amount: [this.transaction ? this.transaction.amount.replace('-', '').replace('.', ',') : ''],
    operationDate: [this.transaction?.operationDate ?? ''],
    label: [this.transaction?.label ?? ''],
    reference: [this.transaction?.reference ?? ''],
    projectId: [this.transaction?.projectId ?? ''],
    counterpartAccountId: [this.transaction?.counterpartAccountId ?? ''],
  });

  constructor() {
    if (this.frozen()) {
      this.form.controls.amount.disable();
      this.form.controls.operationDate.disable();
    }
  }

  protected async save(): Promise<void> {
    const body = this.body();
    if (!body) return;
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const current = this.transaction;
      const saved = current
        ? await this.api.updateTransaction(
            current.id,
            current.financialLock
              ? { projectId: body.projectId, counterpartAccountId: body.counterpartAccountId, label: body.label, reference: body.reference, version: current.version }
              : { ...body, version: current.version },
          )
        : await this.api.createTransaction(this.data.account.id, body);
      this.reference.close({ kind: 'saved', transaction: saved });
    } catch (failure) {
      this.fail(failure, "La transaction n'a pas pu être enregistrée. Réessayez dans un instant.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const current = this.transaction;
    if (!current) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Supprimer cette transaction ?',
      message: `« ${current.label} » sera supprimée. Vous pourrez la saisir de nouveau si vous vous êtes trompé.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await this.api.deleteTransaction(current.id);
      this.reference.close({ kind: 'deleted' });
    } catch (failure) {
      this.fail(failure, "La transaction n'a pas pu être supprimée. Réessayez dans un instant.");
    } finally {
      this.busy.set(false);
    }
  }

  private fail(failure: unknown, fallback: string): void {
    const described = describeHttpError(failure, fallback);
    this.error.set(described.message);
    this.details.set(described.details);
  }

  /** Corps envoyé à l'API (montant signé selon le sens), ou `null` avec un message si la saisie est invalide. */
  private body(): TransactionBody | null {
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    if (!this.frozen() && (cents === null || cents <= 0)) {
      this.error.set('Saisissez un montant supérieur à zéro, par exemple 12,50, et choisissez s\'il s\'agit d\'argent reçu ou dépensé.');
      this.details.set([]);
      return null;
    }
    if (raw.label.trim() === '' || (!this.frozen() && !raw.operationDate)) {
      this.error.set("Renseignez la date de l'opération et un libellé : quelques mots pour la reconnaître.");
      this.details.set([]);
      return null;
    }
    return {
      operationDate: this.frozen() ? this.transaction!.operationDate : raw.operationDate,
      amount: this.transaction && this.frozen() ? this.transaction.amount : centsToApi(raw.direction === 'out' ? -(cents ?? 0) : (cents ?? 0)),
      label: raw.label.trim(),
      reference: raw.reference.trim() === '' ? null : raw.reference.trim(),
      projectId: raw.projectId || null,
      counterpartAccountId: raw.counterpartAccountId || null,
    };
  }
}
