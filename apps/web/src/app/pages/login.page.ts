import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';
import { describePasskeyError } from '../auth/passkey-errors';
import { PasskeyService, type PasskeyMethods } from '../auth/passkey.service';
import { BrandingService } from '../branding/branding.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <main class="page">
      <mat-card appearance="outlined" class="card">
        <mat-card-header>
          <div>
            @if (logoUrl(); as url) {
              <img class="logo" [src]="url" [alt]="'Logo de ' + associationName()" />
            }
            <h1>Connexion</h1>
          </div>
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

          @if (passkeyOffered()) {
            <div class="alternative">
              <p class="or"><span>ou</span></p>
              <button mat-stroked-button type="button" class="passkey" [disabled]="submitting()" (click)="loginWithKey()">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">vpn_key</mat-icon>
                Se connecter avec une clé d’accès
              </button>
              <p class="hint">
                Utilisez le déverrouillage de votre appareil (empreinte, visage ou code), ou une clé de sécurité.
                @if (!methods().usernameless) {
                  Saisissez d’abord votre adresse email.
                }
              </p>
            </div>
          }
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styleUrl: './auth-pages.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly branding = inject(BrandingService);

  protected readonly logoUrl = this.branding.logoUrl;
  protected readonly associationName = computed(() => this.branding.branding().appName);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });
  private readonly formDirective = viewChild.required(FormGroupDirective);
  protected readonly submitting = signal(false);
  protected readonly error = signal<FormError | null>(null);

  private readonly passkeys = inject(PasskeyService);
  protected readonly methods = signal<PasskeyMethods>({ mode: 'DISABLED', usernameless: false });
  /** Le bouton n'apparaît que si l'association autorise la connexion par clé d'accès et que le navigateur la gère. */
  protected readonly passkeyOffered = computed(() => this.methods().mode === 'FULL' && this.passkeys.supported());

  constructor() {
    void this.passkeys.methods().then((methods) => this.methods.set(methods));
  }

  protected async loginWithKey(): Promise<void> {
    this.error.set(null);
    const email = this.form.controls.email.value.trim();
    if (!this.methods().usernameless && email === '') {
      this.form.controls.email.markAsTouched();
      this.error.set({
        message: 'Saisissez d’abord votre adresse email. L’association demande de l’indiquer avant d’utiliser une clé d’accès. Puis choisissez « Se connecter avec une clé d’accès ».',
        details: [],
      });
      return;
    }
    this.submitting.set(true);
    try {
      await this.passkeys.login(this.methods().usernameless ? null : email);
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(describePasskeyError(error, 'Connexion par clé d’accès impossible. Réessayez, ou utilisez votre mot de passe.'));
    } finally {
      this.submitting.set(false);
    }
  }

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
