import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';

export const MIN_PASSWORD_LENGTH = 12;

/** Posé sur le champ de confirmation (et non sur le groupe) pour que l'erreur s'affiche sous ce champ. */
function matchesPassword(control: AbstractControl): ValidationErrors | null {
  const password = control.parent?.get('password')?.value as string | undefined;
  return password === undefined || control.value === password ? null : { mismatch: true };
}

@Component({
  selector: 'app-setup-page',
  imports: [ReactiveFormsModule, MatCheckboxModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <main class="page">
      <mat-card appearance="outlined" class="card">
        <mat-card-header>
          <h1>Installation</h1>
        </mat-card-header>
        <mat-card-content>
          <p class="intro">
            Créez le premier compte (celui de la personne qui installe l’application). Le jeton d’installation prouve que vous avez accès au
            serveur : il s’affiche dans les journaux de l’application, pas sur ce site.
          </p>
          <details class="token-help">
            <summary>Où trouver le jeton ?</summary>
            <p>
              Sur l’ordinateur ou le serveur où l’application est installée, ouvrez un terminal dans le dossier de l’application et tapez cette
              commande, puis copiez le texte affiché dans la case « Jeton d’installation » :
            </p>
            <p class="command">
              <code>{{ tokenCommand }}</code>
              <button mat-stroked-button type="button" (click)="copyCommand()">{{ copied() ? 'Copié ✓' : 'Copier la commande' }}</button>
            </p>
            <p>
              Aucun jeton n’apparaît ? Patientez une minute que l’application démarre, ou redémarrez-la avec <code>docker compose restart api</code>,
              puis recommencez. Le jeton ne sert qu’une fois. Le guide d’installation (<code>docs/exploitation.md</code>, « Première installation »)
              détaille chaque étape.
            </p>
          </details>
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <mat-form-field appearance="outline">
              <mat-label>Jeton d'installation</mat-label>
              <input matInput formControlName="token" autocomplete="off" spellcheck="false" required />
              @if (form.controls.token.hasError('required')) {
                <mat-error>Saisissez le jeton affiché dans les journaux.</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Nom affiché</mat-label>
              <input matInput formControlName="displayName" autocomplete="name" required />
              @if (form.controls.displayName.hasError('required')) {
                <mat-error>Saisissez votre nom.</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Adresse email</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="username" required />
              @if (form.controls.email.hasError('required')) {
                <mat-error>Saisissez votre adresse email.</mat-error>
              } @else if (form.controls.email.hasError('email')) {
                <mat-error>Cette adresse email n'est pas valide.</mat-error>
              }
            </mat-form-field>

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

            <mat-checkbox formControlName="alsoTreasurer">Je suis aussi le trésorier ou la trésorière de l'association</mat-checkbox>
            <p class="hint">
              Le compte administrateur gère les accès et la sécurité, mais n'a aucun droit sur la comptabilité. Gardez cette case cochée si
              c'est vous qui tiendrez les comptes ; vous pourrez changer les rôles plus tard.
            </p>

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

            <button mat-flat-button type="submit" [disabled]="submitting()">Créer le compte</button>
          </form>
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styleUrl: './auth-pages.scss',
})
export class SetupPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly tokenCommand = './scripts/install-token.sh --env-file .env.prod';
  protected readonly copied = signal(false);

  /** Copie la commande ; si le navigateur refuse (page non sécurisée), elle reste sélectionnable d'un clic. */
  protected async copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.tokenCommand);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 3000);
    } catch {
      this.copied.set(false);
    }
  }
  protected readonly form = inject(FormBuilder).nonNullable.group({
    token: ['', [Validators.required]],
    displayName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirmation: ['', [Validators.required, matchesPassword]],
    alsoTreasurer: [true],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<FormError | null>(null);

  constructor() {
    // La confirmation doit être revalidée quand le mot de passe change.
    this.form.controls.password.valueChanges.subscribe(() => this.form.controls.confirmation.updateValueAndValidity());
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    try {
      const { token, displayName, email, password, alsoTreasurer } = this.form.getRawValue();
      await this.auth.completeSetup({ token: token.trim(), displayName, email, password, alsoTreasurer });
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(describeHttpError(error, 'Installation impossible. Réessayez.'));
    } finally {
      this.submitting.set(false);
    }
  }
}
