import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';

const MIN_PASSWORD_LENGTH = 12;

function matchesPassword(control: AbstractControl): ValidationErrors | null {
  const password = control.parent?.get('password')?.value as string | undefined;
  return password === undefined || control.value === password ? null : { mismatch: true };
}

/**
 * Définition d'un mot de passe via un lien d'invitation ou de réinitialisation. Le jeton est lu dans le
 * fragment de l'URL (`#token=...`), qui n'est jamais envoyé au serveur, puis retiré de la barre d'adresse.
 */
@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <main class="page">
      <mat-card appearance="outlined" class="card">
        <mat-card-header>
          <h1>Nouveau mot de passe</h1>
        </mat-card-header>
        <mat-card-content>
          @if (done()) {
            <p class="intro">Votre mot de passe est défini. Vous pouvez maintenant vous connecter.</p>
            <a mat-flat-button routerLink="/connexion">Se connecter</a>
          } @else if (!token) {
            <p class="intro">
              Ce lien est incomplet. Demandez à un administrateur de vous envoyer un nouveau lien.
            </p>
            <a mat-stroked-button routerLink="/connexion">Retour à la connexion</a>
          } @else {
            <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
              <mat-form-field appearance="outline">
                <mat-label>Mot de passe</mat-label>
                <input matInput type="password" formControlName="password" autocomplete="new-password" required />
                <mat-hint>{{ minLength }} caractères minimum, une phrase de passe convient.</mat-hint>
                @if (form.controls.password.hasError('required')) {
                  <mat-error>Choisissez un mot de passe.</mat-error>
                } @else if (form.controls.password.hasError('minlength')) {
                  <mat-error>Le mot de passe doit comporter au moins {{ minLength }} caractères.</mat-error>
                }
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Confirmer le mot de passe</mat-label>
                <input matInput type="password" formControlName="confirmation" autocomplete="new-password" required />
                @if (form.controls.confirmation.hasError('mismatch')) {
                  <mat-error>Les mots de passe ne correspondent pas.</mat-error>
                }
              </mat-form-field>

              @if (error(); as failure) {
                <div class="error" role="alert">
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

              <button mat-flat-button type="submit" [disabled]="submitting()">Enregistrer le mot de passe</button>
            </form>
          }
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styleUrl: './auth-pages.scss',
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly token: string | null;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirmation: ['', [Validators.required, matchesPassword]],
  });
  protected readonly submitting = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<FormError | null>(null);

  constructor() {
    const fragment = inject(ActivatedRoute).snapshot.fragment ?? '';
    this.token = new URLSearchParams(fragment).get('token');
    if (this.token) {
      // Le jeton ne doit pas rester dans la barre d'adresse ni dans l'historique du navigateur.
      void this.router.navigate([], { fragment: undefined, replaceUrl: true });
    }
    this.form.controls.password.valueChanges.subscribe(() => this.form.controls.confirmation.updateValueAndValidity());
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid || !this.token) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    try {
      await this.auth.resetPassword(this.token, this.form.getRawValue().password);
      this.done.set(true);
    } catch (error) {
      this.error.set(describeHttpError(error, 'Impossible de définir le mot de passe. Réessayez.'));
    } finally {
      this.submitting.set(false);
    }
  }
}
