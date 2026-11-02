import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { AuthService, type EnrollmentStart } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';

/** Regroupe un secret en blocs de 4 caractères pour la saisie manuelle. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** Texte téléchargeable des codes de secours. */
export function recoveryCodesText(codes: string[]): string {
  return ['Codes de secours cotiasso', 'Chaque code ne sert qu\'une seule fois. Conservez-les en lieu sûr.', '', ...codes, ''].join('\n');
}

/**
 * Activation du second facteur : le QR code est généré dans le navigateur (le secret ne quitte jamais cette page),
 * puis les codes de secours sont montrés une seule fois.
 */
@Component({
  selector: 'app-mfa-enroll-page',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <main class="page">
      <mat-card appearance="outlined" class="card wide">
        <mat-card-header>
          <h1>Activer la vérification en deux étapes</h1>
        </mat-card-header>
        <mat-card-content>
          @if (recoveryCodes(); as codes) {
            <p class="intro">
              Votre vérification en deux étapes est active. Conservez ces codes de secours : ils permettent de vous
              connecter si vous perdez votre appareil. Ils ne seront plus affichés : copiez-les ou téléchargez-les, et rangez-les ailleurs que sur
              ce téléphone (par exemple imprimés, avec les papiers de l'association).
            </p>
            <ul class="codes" aria-label="Codes de secours">
              @for (code of codes; track code) {
                <li>{{ code }}</li>
              }
            </ul>
            <div class="actions">
              <button mat-stroked-button type="button" (click)="copy(codes)">Copier</button>
              <button mat-stroked-button type="button" (click)="download(codes)">Télécharger</button>
              <button mat-flat-button type="button" (click)="finish()">J'ai conservé mes codes</button>
            </div>
          } @else if (loadError(); as failure) {
            <p class="error" role="alert">{{ failure.message }}</p>
            <a mat-stroked-button routerLink="/compte">Retour</a>
          } @else if (enrollment(); as start) {
            @if (required()) {
              <p class="intro">Votre rôle exige la vérification en deux étapes avant de continuer.</p>
            }
            <p class="intro">
              Les comptes d'une association contiennent de l'argent : en plus de votre mot de passe, on vous demandera un petit code à 6 chiffres
              qui change toutes les 30 secondes. Ce code s'affiche dans une application gratuite sur votre téléphone ; vous n'avez à la
              configurer qu'une seule fois, ça prend deux minutes.
            </p>
            <ol class="steps">
              <li>Sur votre téléphone, installez une application d'authentification, gratuite (par exemple FreeOTP, Aegis ou Google Authenticator), depuis la boutique d'applications.</li>
              <li>Dans l'application, choisissez « Ajouter un compte » puis scannez ce QR code avec l'appareil photo. Si vous ne pouvez pas scanner, saisissez la clé écrite sous le QR code.</li>
              <li>L'application affiche alors un code à 6 chiffres : saisissez-le ci-dessous pour confirmer. Vous recevrez ensuite des codes de secours à garder en lieu sûr.</li>
            </ol>
            @if (qr(); as image) {
              <img class="qr" [src]="image" alt="QR code à scanner avec votre application d'authentification" />
            }
            <p class="secret">Clé : <code>{{ grouped(start.secret) }}</code></p>

            <form [formGroup]="form" (ngSubmit)="confirm()" novalidate>
              <mat-form-field appearance="outline">
                <mat-label>Code à 6 chiffres</mat-label>
                <input matInput formControlName="code" inputmode="numeric" autocomplete="one-time-code" required />
                @if (form.controls.code.hasError('required')) {
                  <mat-error>Saisissez le code affiché.</mat-error>
                } @else if (form.controls.code.hasError('pattern')) {
                  <mat-error>Le code comporte 6 chiffres.</mat-error>
                }
              </mat-form-field>

              @if (error(); as failure) {
                <p class="error" role="alert">{{ failure.message }}</p>
              }

              <button mat-flat-button type="submit" [disabled]="submitting()">Activer</button>
              @if (required()) {
                <button mat-button type="button" (click)="logout()">Se déconnecter</button>
              } @else {
                <a mat-button routerLink="/compte">Annuler</a>
              }
            </form>
          } @else {
            <p class="intro">Préparation…</p>
          }
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styleUrl: './auth-pages.scss',
})
export class MfaEnrollPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly grouped = groupSecret;
  protected readonly required = () => this.auth.mfa().required;
  protected readonly enrollment = signal<EnrollmentStart | null>(null);
  protected readonly qr = signal<string | null>(null);
  protected readonly recoveryCodes = signal<string[] | null>(null);
  protected readonly loadError = signal<FormError | null>(null);
  protected readonly error = signal<FormError | null>(null);
  protected readonly submitting = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\s*\d{3}\s?\d{3}\s*$/)]],
  });

  constructor() {
    void this.start();
  }

  protected async confirm(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    try {
      this.recoveryCodes.set(await this.auth.confirmMfaEnrollment(this.form.getRawValue().code.replace(/\s/g, '')));
      this.enrollment.set(null);
    } catch (error) {
      this.error.set(describeHttpError(error, 'Activation impossible. Réessayez.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async copy(codes: string[]): Promise<void> {
    try {
      await navigator.clipboard.writeText(recoveryCodesText(codes));
    } catch {
      // La liste reste affichée et sélectionnable : la copie manuelle reste possible.
    }
  }

  protected download(codes: string[]): void {
    const url = URL.createObjectURL(new Blob([recoveryCodesText(codes)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'codes-de-secours-cotiasso.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  protected finish(): Promise<boolean> {
    this.recoveryCodes.set(null);
    return this.router.navigateByUrl('/');
  }

  protected async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigateByUrl('/connexion');
    }
  }

  private async start(): Promise<void> {
    try {
      const start = await this.auth.startMfaEnrollment();
      this.qr.set(await QRCode.toDataURL(start.otpauthUri, { margin: 1, width: 192 }));
      this.enrollment.set(start);
    } catch (error) {
      this.loadError.set(describeHttpError(error, "Impossible de préparer l'activation. Réessayez."));
    }
  }
}
