import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';
import { BrandingService, type Branding } from '../branding/branding.service';
import { MIN_TEXT_CONTRAST, contrastRatio } from '../branding/contrast';
import { AdminApiService } from './admin-api.service';

interface Identity {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  rna: string;
  siren: string;
}

@Component({
  selector: 'app-association-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styleUrl: './admin-pages.scss',
  template: `
    <h2>Association</h2>
    @if (!canEdit()) {
      <p class="muted">Vous pouvez consulter ces informations, mais pas les modifier.</p>
    }

    <form class="panel" [formGroup]="identityForm" (ngSubmit)="saveIdentity()" novalidate>
      <h3>Identité</h3>
      <mat-form-field appearance="outline">
        <mat-label>Nom de l'association</mat-label>
        <input matInput formControlName="name" required />
        @if (identityForm.controls.name.hasError('required')) {
          <mat-error>Saisissez le nom de l'association.</mat-error>
        }
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Adresse</mat-label>
        <input matInput formControlName="address" />
      </mat-form-field>
      <div class="row">
        <mat-form-field appearance="outline">
          <mat-label>Code postal</mat-label>
          <input matInput formControlName="postalCode" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="grow">
          <mat-label>Ville</mat-label>
          <input matInput formControlName="city" />
        </mat-form-field>
      </div>
      <div class="row">
        <mat-form-field appearance="outline" class="grow">
          <mat-label>Email de contact</mat-label>
          <input matInput type="email" formControlName="email" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Téléphone</mat-label>
          <input matInput formControlName="phone" />
        </mat-form-field>
      </div>
      <div class="row">
        <mat-form-field appearance="outline">
          <mat-label>RNA</mat-label>
          <input matInput formControlName="rna" placeholder="W123456789" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>SIREN</mat-label>
          <input matInput formControlName="siren" placeholder="123456789" />
        </mat-form-field>
      </div>

      @if (identityError(); as failure) {
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
      @if (identityNotice(); as notice) {
        <p class="success" role="status">{{ notice }}</p>
      }
      @if (canEdit()) {
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="saving()">Enregistrer l'identité</button>
        </div>
      }
    </form>

    <form class="panel" [formGroup]="brandingForm" (ngSubmit)="saveBranding()" novalidate>
      <h3>Apparence</h3>
      <p class="muted">Le nom et les couleurs du menu s'appliquent à toute l'interface, y compris la page de connexion.</p>
      <mat-form-field appearance="outline">
        <mat-label>Nom affiché</mat-label>
        <input matInput formControlName="appName" required />
        @if (brandingForm.controls.appName.hasError('required')) {
          <mat-error>Saisissez le nom affiché.</mat-error>
        }
      </mat-form-field>
      <div class="row">
        <div class="color">
          <label for="bg-color">Fond du menu</label>
          <input id="bg-color" type="color" formControlName="sidebarBackground" />
          <code>{{ brandingForm.controls.sidebarBackground.value }}</code>
        </div>
        <div class="color">
          <label for="text-color">Texte du menu</label>
          <input id="text-color" type="color" formControlName="sidebarText" />
          <code>{{ brandingForm.controls.sidebarText.value }}</code>
        </div>
      </div>

      <div
        class="preview"
        aria-label="Aperçu du menu"
        [style.background]="previewColors().background"
        [style.color]="previewColors().text"
      >
        {{ previewName() }} · Vue d'ensemble · Comptes
      </div>
      @if (lowContrast()) {
        <p class="alert" role="alert">
          Contraste insuffisant ({{ ratio() }} sur {{ minContrast }} requis) : le texte serait difficile à lire.
        </p>
      } @else {
        <p class="muted">Contraste : {{ ratio() }} (minimum {{ minContrast }}).</p>
      }

      @if (brandingError(); as failure) {
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
      @if (brandingNotice(); as notice) {
        <p class="success" role="status">{{ notice }}</p>
      }
      @if (canEdit()) {
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="saving() || lowContrast()">Enregistrer l'apparence</button>
        </div>
      }
    </form>
  `,
})
export class AssociationPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly branding = inject(BrandingService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly minContrast = MIN_TEXT_CONTRAST;
  protected readonly canEdit = computed(() => {
    this.auth.permissions();
    return this.auth.can('settings.association:admin');
  });
  protected readonly saving = signal(false);
  protected readonly identityError = signal<FormError | null>(null);
  protected readonly identityNotice = signal<string | null>(null);
  protected readonly brandingError = signal<FormError | null>(null);
  protected readonly brandingNotice = signal<string | null>(null);

  protected readonly identityForm = this.fb.group({
    name: ['', [Validators.required]],
    address: [''],
    postalCode: [''],
    city: [''],
    email: [''],
    phone: [''],
    rna: [''],
    siren: [''],
  });
  protected readonly brandingForm = this.fb.group({
    appName: ['', [Validators.required]],
    sidebarBackground: ['#eaf2fd'],
    sidebarText: ['#0b2a55'],
  });

  private readonly brandingValue = toSignal(this.brandingForm.valueChanges, { initialValue: this.brandingForm.getRawValue() });
  protected readonly previewColors = computed(() => ({
    background: this.brandingValue().sidebarBackground ?? '#eaf2fd',
    text: this.brandingValue().sidebarText ?? '#0b2a55',
  }));
  protected readonly previewName = computed(() => this.brandingValue().appName || 'Nom affiché');
  private readonly rawRatio = computed(() => contrastRatio(this.previewColors().text, this.previewColors().background));
  protected readonly ratio = computed(() => (this.rawRatio() ?? 0).toFixed(1));
  protected readonly lowContrast = computed(() => (this.rawRatio() ?? 0) < MIN_TEXT_CONTRAST);

  constructor() {
    void this.load();
  }

  protected async saveIdentity(): Promise<void> {
    this.identityError.set(null);
    this.identityNotice.set(null);
    if (this.identityForm.invalid) {
      this.identityForm.markAllAsTouched();
      return;
    }
    await this.save(async () => {
      const result = await this.api.updateSettings<Identity>('identity', this.identityForm.getRawValue());
      this.identityForm.reset(result.value);
      this.identityNotice.set(result.changed ? 'Identité enregistrée.' : 'Aucune modification à enregistrer.');
    }, this.identityError);
  }

  protected async saveBranding(): Promise<void> {
    this.brandingError.set(null);
    this.brandingNotice.set(null);
    if (this.brandingForm.invalid) {
      this.brandingForm.markAllAsTouched();
      return;
    }
    await this.save(async () => {
      const result = await this.api.updateSettings<Branding>('branding', this.brandingForm.getRawValue());
      this.brandingForm.reset(result.value);
      this.branding.apply(result.value);
      this.brandingNotice.set(result.changed ? 'Apparence enregistrée.' : 'Aucune modification à enregistrer.');
    }, this.brandingError);
  }

  private async save(action: () => Promise<void>, error: { set(value: FormError | null): void }): Promise<void> {
    this.saving.set(true);
    try {
      await action();
    } catch (failure) {
      error.set(describeHttpError(failure, 'Enregistrement impossible. Réessayez.'));
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const [identity, branding] = await Promise.all([
        this.api.getSettings<Identity>('identity'),
        this.api.getSettings<Branding>('branding'),
      ]);
      this.identityForm.reset(identity);
      this.brandingForm.reset(branding);
    } catch (failure) {
      this.identityError.set(describeHttpError(failure, 'Impossible de charger les paramètres.'));
    }
    if (!this.canEdit()) {
      this.identityForm.disable();
      this.brandingForm.disable();
    }
  }
}
