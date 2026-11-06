import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';
import { describePasskeyError } from '../auth/passkey-errors';
import { PasskeyService } from '../auth/passkey.service';

/** Second facteur d'une session ouverte avec le mot de passe : code de l'application, ou code de secours. */
@Component({
  selector: 'app-mfa-verify-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <main class="page">
      <mat-card appearance="outlined" class="card">
        <mat-card-header>
          <h1>Vérification en deux étapes</h1>
        </mat-card-header>
        <mat-card-content>
          @if (passkeyOffered() && !recovery()) {
            <div class="passkey-choice">
              <p>Confirmez que c’est bien vous avec votre clé d’accès : déverrouillez votre appareil (empreinte, visage ou code), ou utilisez votre clé de sécurité.</p>
              <button mat-flat-button type="button" [disabled]="submitting()" (click)="verifyWithKey()">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">vpn_key</mat-icon>
                Utiliser ma clé d’accès
              </button>
            </div>
          }
          <p class="intro">
            @if (recovery()) {
              Saisissez l'un de vos codes de secours. Chaque code ne sert qu'une fois.
            } @else {
              Saisissez le code à 6 chiffres affiché par votre application d'authentification.
            }
          </p>
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <mat-form-field appearance="outline">
              <mat-label>{{ recovery() ? 'Code de secours' : 'Code à 6 chiffres' }}</mat-label>
              <input
                matInput
                formControlName="code"
                [attr.inputmode]="recovery() ? 'text' : 'numeric'"
                autocomplete="one-time-code"
                spellcheck="false"
                required
              />
              @if (form.controls.code.hasError('required')) {
                <mat-error>Saisissez le code.</mat-error>
              }
            </mat-form-field>

            @if (error(); as failure) {
              <p class="error" role="alert">{{ failure.message }}</p>
            }

            <button mat-flat-button type="submit" [disabled]="submitting()">Vérifier</button>
            <button mat-button type="button" (click)="toggleRecovery()">
              {{ recovery() ? 'Utiliser le code de mon application' : "J'ai perdu mon appareil : utiliser un code de secours" }}
            </button>
            <button mat-button type="button" (click)="logout()">Se déconnecter</button>
          </form>
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styleUrl: './auth-pages.scss',
})
export class MfaVerifyPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly passkeys = inject(PasskeyService);
  /** Une clé d'accès utilisable est enregistrée (le serveur le dit dans l'état de la session) et le navigateur sait l'utiliser. */
  protected readonly passkeyOffered = computed(() => this.auth.mfa().passkey === true && this.passkeys.supported());
  protected readonly form = inject(FormBuilder).nonNullable.group({ code: ['', [Validators.required]] });
  protected readonly recovery = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal<FormError | null>(null);

  protected toggleRecovery(): void {
    this.recovery.update((value) => !value);
    this.error.set(null);
    this.form.reset({ code: '' });
  }

  protected async verifyWithKey(): Promise<void> {
    this.error.set(null);
    this.submitting.set(true);
    try {
      await this.passkeys.verify();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(describePasskeyError(error, 'Vérification impossible. Réessayez, ou saisissez un code.'));
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
      await this.auth.verifyMfa(this.form.getRawValue().code.trim());
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(describeHttpError(error, 'Vérification impossible. Réessayez.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigateByUrl('/connexion');
    }
  }
}
