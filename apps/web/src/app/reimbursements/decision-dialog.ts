import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { ReimbursementsApi, type ReimbursementInfo } from './reimbursements-api';

export type DecisionKind = 'REFUSE' | 'RETURN' | 'CANCEL';

export interface DecisionDialogData {
  id: string;
  number: number;
  kind: DecisionKind;
}

const TEXTS: Record<DecisionKind, { title: string; help: string; label: string; hint: string; submit: string }> = {
  REFUSE: {
    title: 'Refuser la demande',
    help: 'La personne verra votre message. Une demande refusée ne peut plus être modifiée : elle pourra en déposer une nouvelle si besoin.',
    label: 'Pourquoi refusez-vous cette demande ?',
    hint: 'Quelques mots suffisent, par exemple « pas prévu au budget ».',
    submit: 'Refuser la demande',
  },
  RETURN: {
    title: 'Renvoyer pour correction',
    help: 'La personne pourra modifier sa demande puis la redéposer. Les accords déjà donnés restent valables, sauf si elle change le montant, la date ou le projet : dans ce cas, tout le monde se prononce de nouveau.',
    label: 'Que faut-il corriger ?',
    hint: 'Par exemple « le ticket est illisible, merci de le reprendre en photo ».',
    submit: 'Renvoyer la demande',
  },
  CANCEL: {
    title: 'Annuler ma demande',
    help: 'Votre demande sera arrêtée et ne pourra plus être modifiée. Vous pourrez en déposer une nouvelle si besoin.',
    label: 'Pourquoi annulez-vous ?',
    hint: 'Par exemple « j’ai été remboursé autrement ».',
    submit: 'Annuler la demande',
  },
};

/** Demande un message avant un refus, un renvoi pour correction ou une annulation. Renvoie la demande à jour. */
@Component({
  selector: 'app-decision-dialog',
  imports: [FormDialog, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog [title]="text.title + ' n° ' + data.number" [description]="text.help" [submitLabel]="text.submit" [dirty]="form.dirty" [busy]="busy()" [error]="error()">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.label }}</mat-label>
          <textarea matInput formControlName="message" rows="3" required></textarea>
          <mat-hint>{{ text.hint }}</mat-hint>
          @if (form.controls.message.invalid) {
            <mat-error>Écrivez quelques mots (3 caractères au moins).</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class DecisionDialog {
  private readonly api = inject(ReimbursementsApi);
  private readonly reference = inject<MatDialogRef<DecisionDialog, ReimbursementInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<DecisionDialogData>(MAT_DIALOG_DATA);
  protected readonly text = TEXTS[this.data.kind];
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({ message: ['', [Validators.required, Validators.minLength(3)]] });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis validez de nouveau.');
      return;
    }
    const message = this.form.getRawValue().message.trim();
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(this.data.kind === 'CANCEL' ? await this.api.cancel(this.data.id, message) : await this.api.decide(this.data.id, this.data.kind, message));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'La décision n’a pas pu être enregistrée. Réessayez dans un instant.').message);
    } finally {
      this.busy.set(false);
    }
  }
}
