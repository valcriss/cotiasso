import { Component, inject, signal, viewChild } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroupDirective,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';
import { AdminApiService } from './admin-api.service';
import { recoveryCodesText } from '../pages/mfa-enroll.page';

const MIN_PASSWORD_LENGTH = 12;

function matchesNewPassword(control: AbstractControl): ValidationErrors | null {
  const value = control.parent?.get('newPassword')?.value as string | undefined;
  return value === undefined || control.value === value ? null : { mismatch: true };
}

@Component({
  selector: 'app-account-page',
  imports: [MatIconModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  styleUrl: './admin-pages.scss',
  template: `
    <h2><mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_circle</mat-icon><span>Mon compte</span></h2>
    <p class="muted">{{ user()?.displayName }} · {{ user()?.email }}</p>

    <form class="panel narrow" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock</mat-icon><span>Changer mon mot de passe</span></h3>
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

    <section class="panel narrow" aria-labelledby="mfa-title">
      <h3 id="mfa-title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">security</mat-icon><span>Vérification en deux étapes</span></h3>
      @if (!mfa().enabled) {
        <p class="muted">
          Ajoutez une protection : un code à usage unique, généré par une application sur votre téléphone, est demandé à chaque connexion.
        </p>
        <div class="actions">
          <a mat-flat-button routerLink="/mfa/activation">Activer</a>
        </div>
      } @else {
        <p class="success" role="status">Vérification en deux étapes activée.</p>
        @if (mfa().required) {
          <p class="muted">Un de vos rôles l'exige : elle ne peut pas être désactivée.</p>
        }
        <mat-form-field appearance="outline">
          <mat-label>Mot de passe actuel</mat-label>
          <input matInput type="password" [formControl]="mfaPassword" autocomplete="current-password" />
          <mat-hint>Requis pour les actions ci-dessous.</mat-hint>
        </mat-form-field>

        @if (mfaError(); as failure) {
          <p class="alert" role="alert">{{ failure }}</p>
        }

        <div class="actions">
          <button mat-stroked-button type="button" [disabled]="mfaBusy()" (click)="regenerate()">
            Régénérer les codes de secours
          </button>
          @if (!mfa().required) {
            <button mat-stroked-button type="button" class="danger-text" [disabled]="mfaBusy()" (click)="disable()">
              Désactiver
            </button>
          }
        </div>

        @if (newCodes(); as codes) {
          <h4>Nouveaux codes de secours</h4>
          <p class="muted">Les anciens codes ne fonctionnent plus. Ces codes ne seront plus affichés.</p>
          <ul class="codes" aria-label="Nouveaux codes de secours">
            @for (code of codes; track code) {
              <li>{{ code }}</li>
            }
          </ul>
          <div class="actions">
            <button mat-stroked-button type="button" (click)="copyCodes(codes)">Copier</button>
          </div>
        }
      }
    </section>
  `,
})
export class AccountPage {
  private readonly api = inject(AdminApiService);
  private readonly formDirective = viewChild.required(FormGroupDirective);

  private readonly auth = inject(AuthService);

  protected readonly user = this.auth.user;
  protected readonly mfa = this.auth.mfa;
  protected readonly mfaPassword = new FormControl('', { nonNullable: true });
  protected readonly mfaBusy = signal(false);
  protected readonly mfaError = signal<string | null>(null);
  protected readonly newCodes = signal<string[] | null>(null);
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

  protected regenerate(): Promise<void> {
    return this.runMfa(async () => {
      this.newCodes.set(await this.auth.regenerateRecoveryCodes(this.mfaPassword.value));
    });
  }

  protected disable(): Promise<void> {
    return this.runMfa(async () => {
      await this.auth.disableMfa(this.mfaPassword.value);
      this.newCodes.set(null);
    });
  }

  protected async copyCodes(codes: string[]): Promise<void> {
    try {
      await navigator.clipboard.writeText(recoveryCodesText(codes));
    } catch {
      // La liste reste affichée : la copie manuelle reste possible.
    }
  }

  private async runMfa(action: () => Promise<void>): Promise<void> {
    this.mfaError.set(null);
    if (this.mfaPassword.value === '') {
      this.mfaError.set('Saisissez votre mot de passe actuel.');
      return;
    }
    this.mfaBusy.set(true);
    try {
      await action();
      this.mfaPassword.reset('');
    } catch (error) {
      this.mfaError.set(describeHttpError(error, 'Action impossible. Réessayez.').message);
    } finally {
      this.mfaBusy.set(false);
    }
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
