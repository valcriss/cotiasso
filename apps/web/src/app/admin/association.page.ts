import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';
import { BrandingService, DEFAULT_ACCENT, type Branding } from '../branding/branding.service';
import { MIN_TEXT_CONTRAST, contrastRatio } from '../branding/contrast';
import { ActionBar } from '../ui/action-bar';
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
  imports: [ActionBar, MatIconModule, MatRadioModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styleUrl: './admin-pages.scss',
  styles: [`
    .identity-form {
      gap: 12px;
    }
    .logo-zone {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .logo-preview {
      align-items: center;
      background: var(--app-bg);
      border: 1px dashed var(--app-border);
      border-radius: 4px;
      display: flex;
      justify-content: center;
      min-height: 96px;
      min-width: 160px;
      padding: 12px;

      img {
        max-height: 80px;
        max-width: 240px;
        object-fit: contain;
      }
    }
  `],
  template: `
    <app-action-bar
      label="Association"
      [description]="
        canEdit()
          ? 'Le nom, les coordonnées et les couleurs de votre association : ils apparaissent dans l’application et sur vos documents.'
          : 'Le nom, les coordonnées et les couleurs de votre association. Vous pouvez les consulter, mais pas les modifier.'
      "
    />

    <form class="panel identity-form" [formGroup]="identityForm" (ngSubmit)="saveIdentity()" novalidate>
      <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">badge</mat-icon><span>Identité</span></h3>
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
          <button mat-flat-button type="submit" [disabled]="saving()"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">save</mat-icon> Enregistrer l'identité</button>
        </div>
      }
    </form>

    <section class="panel" aria-labelledby="logo-title">
      <h3 id="logo-title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">image</mat-icon><span>Logo</span></h3>
      <p class="muted">
        Votre logo s'affiche en haut du menu, sur la page de connexion et sur les reçus de cotisation. Choisissez une image
        PNG, JPEG ou SVG (1 Mo au plus) ; un logo carré ou large sur fond transparent donne le meilleur résultat.
      </p>
      <div class="logo-zone">
        <div class="logo-preview" aria-label="Aperçu du logo">
          @if (logoUrl(); as url) {
            <img [src]="url" alt="Logo actuel de l'association" />
          } @else {
            <span class="muted">Aucun logo pour l'instant : le nom de l'association est affiché seul.</span>
          }
        </div>
        @if (canEdit()) {
          <div class="actions">
            <input #logoInput class="sr-only" type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" (change)="chooseLogo(logoInput)" aria-label="Choisir un logo" />
            <button mat-flat-button type="button" [disabled]="saving()" (click)="logoInput.click()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">upload</mat-icon> {{ logoUrl() ? 'Remplacer le logo' : 'Ajouter un logo' }}
            </button>
            @if (logoUrl()) {
              <button mat-stroked-button type="button" [disabled]="saving()" (click)="removeLogo()">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">delete</mat-icon> Retirer le logo
              </button>
            }
          </div>
        }
      </div>
      @if (logoUrl()) {
        <fieldset class="group">
          <legend>Affichage dans le menu</legend>
          <mat-radio-group aria-label="Affichage du logo dans le menu" [value]="showName()" [disabled]="!canEdit() || saving()" (change)="chooseDisplay($event.value)">
            <mat-radio-button [value]="true">Logo et nom de l'association</mat-radio-button>
            <mat-radio-button [value]="false">Logo seul</mat-radio-button>
          </mat-radio-group>
          <p class="muted">Choisissez « Logo seul » si votre logo contient déjà le nom de l'association : il ne sera pas répété à côté.</p>
        </fieldset>
      }
      @if (logoError(); as failure) {
        <div class="alert" role="alert"><p>{{ failure.message }}</p></div>
      }
      @if (logoNotice(); as notice) {
        <p class="success" role="status">{{ notice }}</p>
      }
    </section>

    <form class="panel" [formGroup]="brandingForm" (ngSubmit)="saveBranding()" novalidate>
      <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">palette</mat-icon><span>Apparence</span></h3>
      <p class="muted">Le nom, les couleurs du menu et l'accent s'appliquent à toute l'interface, y compris la page de connexion.</p>
      <mat-form-field appearance="outline">
        <mat-label>Nom affiché</mat-label>
        <input matInput formControlName="appName" required />
        @if (brandingForm.controls.appName.hasError('required')) {
          <mat-error>Saisissez le nom affiché.</mat-error>
        }
      </mat-form-field>

      <fieldset class="group">
        <legend>Menu</legend>
        <div class="color-grid">
          <div class="color-field">
            <label for="bg-color">Fond du menu</label>
            <div class="color-control">
              <input id="bg-color" type="color" formControlName="sidebarBackground" />
              <code>{{ brandingForm.controls.sidebarBackground.value }}</code>
            </div>
          </div>
          <div class="color-field">
            <label for="text-color">Texte du menu</label>
            <div class="color-control">
              <input id="text-color" type="color" formControlName="sidebarText" />
              <code>{{ brandingForm.controls.sidebarText.value }}</code>
            </div>
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
      </fieldset>

      <fieldset class="group">
        <legend>Accent</legend>
        <div class="color-grid">
          <div class="color-field">
            <label for="accent-color">Couleur d'accent</label>
            <div class="color-control">
              <input id="accent-color" type="color" formControlName="accentColor" />
              <code>{{ brandingForm.controls.accentColor.value }}</code>
              <button mat-button type="button" (click)="resetAccent()">Par défaut</button>
            </div>
          </div>
          <div class="color-field">
            <span class="field-label">Aperçu</span>
            <span class="accent-sample" [style.background]="accent()">Boutons et liens</span>
          </div>
        </div>
        @if (lowAccentContrast()) {
          <p class="alert" role="alert">
            Accent trop clair ({{ accentRatio() }} sur {{ minContrast }} requis) : le texte blanc des boutons serait illisible.
          </p>
        } @else {
          <p class="muted">Contraste du texte blanc sur l'accent : {{ accentRatio() }} (minimum {{ minContrast }}).</p>
        }
      </fieldset>

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
          <button mat-flat-button type="submit" [disabled]="saving() || lowContrast() || lowAccentContrast()"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">save</mat-icon> Enregistrer l'apparence</button>
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
  protected readonly logoError = signal<FormError | null>(null);
  protected readonly logoNotice = signal<string | null>(null);
  protected readonly logoUrl = this.branding.logoUrl;
  protected readonly showName = computed(() => this.branding.branding().logoShowsName !== false);

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
    accentColor: [DEFAULT_ACCENT],
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

  protected readonly accent = computed(() => this.brandingValue().accentColor ?? DEFAULT_ACCENT);
  private readonly rawAccentRatio = computed(() => contrastRatio('#ffffff', this.accent()));
  protected readonly accentRatio = computed(() => (this.rawAccentRatio() ?? 0).toFixed(1));
  protected readonly lowAccentContrast = computed(() => (this.rawAccentRatio() ?? 0) < MIN_TEXT_CONTRAST);

  constructor() {
    void this.load();
  }

  protected async chooseLogo(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.logoError.set(null);
    this.logoNotice.set(null);
    await this.save(async () => {
      const result = await this.api.uploadLogo(file);
      this.branding.setLogoHash(result.logoHash);
      this.logoNotice.set('Logo enregistré. Il apparaît déjà dans le menu.');
    }, this.logoError);
  }

  protected async chooseDisplay(showName: boolean): Promise<void> {
    this.logoError.set(null);
    this.logoNotice.set(null);
    await this.save(async () => {
      await this.api.setLogoDisplay(showName);
      this.branding.setLogoShowsName(showName);
      this.logoNotice.set(showName ? 'Le menu affiche le logo et le nom de l’association.' : 'Le menu affiche le logo seul.');
    }, this.logoError);
  }

  protected async removeLogo(): Promise<void> {
    this.logoError.set(null);
    this.logoNotice.set(null);
    await this.save(async () => {
      await this.api.removeLogo();
      this.branding.setLogoHash(null);
      this.logoNotice.set('Logo retiré. Vous pourrez en ajouter un autre quand vous voudrez.');
    }, this.logoError);
  }

  protected resetAccent(): void {
    this.brandingForm.controls.accentColor.setValue(DEFAULT_ACCENT);
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
