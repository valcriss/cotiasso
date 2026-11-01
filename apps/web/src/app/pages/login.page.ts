import { Component, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <main class="page">
      <mat-card appearance="outlined" class="card">
        <mat-card-header>
          <h1>Connexion</h1>
        </mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <mat-form-field appearance="outline">
              <mat-label>Adresse email</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="username" required />
              @if (form.controls.email.hasError('required')) {
                <mat-error>Saisissez votre adresse email.</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Mot de passe</mat-label>
              <input matInput type="password" formControlName="password" autocomplete="current-password" required />
              @if (form.controls.password.hasError('required')) {
                <mat-error>Saisissez votre mot de passe.</mat-error>
              }
            </mat-form-field>

            @if (error(); as failure) {
              <p class="error" role="alert">{{ failure.message }}</p>
            }

            <button mat-flat-button type="submit" [disabled]="submitting()">Se connecter</button>
          </form>
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styleUrl: './auth-pages.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });
  private readonly formDirective = viewChild.required(FormGroupDirective);
  protected readonly submitting = signal(false);
  protected readonly error = signal<FormError | null>(null);

  protected async submit(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email, password);
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(describeHttpError(error, 'Connexion impossible. Réessayez.'));
      // Réinitialise l'état « soumis » pour ne pas afficher d'erreur de champ vide juste après un refus.
      this.formDirective().resetForm({ email: this.form.controls.email.value, password: '' });
    } finally {
      this.submitting.set(false);
    }
  }
}
