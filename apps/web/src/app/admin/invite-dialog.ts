import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { AdminApiService, type ManagedUser, type PasswordLink, type RoleSummary } from './admin-api.service';

export interface InviteDialogData {
  roles: RoleSummary[];
}

export interface InviteResult {
  user: { displayName: string };
  invitation: PasswordLink;
}

/** Invitation d'un utilisateur, en boîte de dialogue. Renvoie le compte créé et son lien d'invitation (affiché une seule fois). */
@Component({
  selector: 'app-invite-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Inviter un utilisateur"
        description="La personne reçoit un lien (à lui transmettre vous-même) pour choisir son mot de passe. Aucun email n'est envoyé par l'application."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        submitLabel="Créer et obtenir le lien"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom affiché</mat-label>
          <input matInput formControlName="displayName" autocomplete="off" placeholder="Marie Dupont" required />
          @if (form.controls.displayName.hasError('required')) {
            <mat-error>Saisissez le nom de la personne.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Adresse email</mat-label>
          <input matInput type="email" formControlName="email" autocomplete="off" placeholder="marie@association.fr" required />
          @if (form.controls.email.hasError('required')) {
            <mat-error>Saisissez son adresse email : elle servira à se connecter.</mat-error>
          } @else if (form.controls.email.hasError('email')) {
            <mat-error>Cette adresse email n'est pas valide. Exemple : marie@association.fr</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Rôles (facultatif)</mat-label>
          <mat-select formControlName="roleIds" multiple>
            @for (role of data.roles; track role.id) {
              <mat-option [value]="role.id">{{ role.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>Un rôle regroupe des droits (ex. Trésorier). Vous pourrez le modifier plus tard.</mat-hint>
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class InviteDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<InviteDialog, InviteResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<InviteDialogData>(MAT_DIALOG_DATA);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    displayName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    roleIds: [[] as string[]],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const { invitation, user } = await this.api.createUser(this.form.getRawValue());
      this.reference.close({ user: user as Pick<ManagedUser, 'displayName'>, invitation });
    } catch (failure) {
      const described = describeHttpError(failure, "L'invitation n'a pas pu être créée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
