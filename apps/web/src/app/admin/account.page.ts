import { Component, inject, signal, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroupDirective, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';
import { AdminApiService } from './admin-api.service';

const MIN_PASSWORD_LENGTH = 12;

function matchesNewPassword(control: AbstractControl): ValidationErrors | null {
  const value = control.parent?.get('newPassword')?.value as string | undefined;
  return value === undefined || control.value === value ? null : { mismatch: true };
}

@Component({
  selector: 'app-account-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styleUrl: './admin-pages.scss',
  template: `
    <h2>Mon compte</h2>
    <p class="muted">{{ user()?.displayName }} · {{ user()?.email }}</p>

    <form class="panel narrow" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h3>Changer mon mot de passe</h3>
      <mat-form-field appearance="outline">
        <mat-label>Mot de passe actuel</mat-label>
        <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" required />
        @if (form.controls.currentPassword.hasError('required')) {
          <mat-error>Saisissez votre mot de passe actuel.</mat-error>
        }
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Nouveau mot de passe</mat-label>
        <input matInput type="password" formControlName="newPassword" autocomplete="new-password" required />
        <mat-hint>{{ minLength }} caractères minimum, une phrase de passe convient.</mat-hint>
        @if (form.controls.newPassword.hasError('required')) {
          <mat-error>Choisissez un nouveau mot de passe.</mat-error>
        } @else if (form.controls.newPassword.hasError('minlength')) {
          <mat-error>Le mot de passe doit comporter au moins {{ minLength }} caractères.</mat-error>
        }
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Confirmer le nouveau mot de passe</mat-label>
        <input matInput type="password" formControlName="confirmation" autocomplete="new-password" required />
        @if (form.controls.confirmation.hasError('mismatch')) {
          <mat-error>Les mots de passe ne correspondent pas.</mat-error>
        }
      </mat-form-field>

      @if (error(); as failure) {
        <div class="alert" role="alert">
          <p>{{ failure.message }}</p>
          @if (failure.details.length > 0) {
            <ul>
              @for (detail of failure.details; track detail) {
                <li>{{ detail }}</li>
              }
            </ul>
          }
        </div>
      }
      @if (done()) {
        <p class="success" role="status">Mot de passe modifié. Vos autres sessions ont été déconnectées.</p>
      }

      <div class="actions">
        <button mat-flat-button type="submit" [disabled]="submitting()">Enregistrer</button>
      </div>
    </form>
  `,
})
export class AccountPage {
  private readonly api = inject(AdminApiService);
  private readonly formDirective = viewChild.required(FormGroupDirective);

  protected readonly user = inject(AuthService).user;
  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirmation: ['', [Validators.required, matchesNewPassword]],
  });
  protected readonly submitting = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<FormError | null>(null);

  constructor() {
    this.form.controls.newPassword.valueChanges.subscribe(() => this.form.controls.confirmation.updateValueAndValidity());
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    this.done.set(false);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    try {
      const { currentPassword, newPassword } = this.form.getRawValue();
      await this.api.changeOwnPassword(currentPassword, newPassword);
      this.formDirective().resetForm({ currentPassword: '', newPassword: '', confirmation: '' });
      this.done.set(true);
    } catch (error) {
      this.error.set(describeHttpError(error, 'Modification impossible. Réessayez.'));
    } finally {
      this.submitting.set(false);
    }
  }
}
