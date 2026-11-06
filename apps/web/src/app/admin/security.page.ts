import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { AuthService } from '../auth/auth.service';
import { describeHttpError, type FormError } from '../auth/error-messages';
import { PasskeyService, type PasskeyMode, type PasskeySettings } from '../auth/passkey.service';
import { ActionBar } from '../ui/action-bar';
import { HelpHint } from '../ui/help-hint';

interface ModeChoice {
  value: PasskeyMode;
  label: string;
  description: string;
}

export const MODE_CHOICES: readonly ModeChoice[] = [
  {
    value: 'DISABLED',
    label: 'Désactivées',
    description: 'Personne ne peut utiliser de clé d’accès. La connexion reste le mot de passe, puis le code si votre rôle l’exige : rien ne change.',
  },
  {
    value: 'SECOND_FACTOR',
    label: 'À la place du code',
    description:
      'Après le mot de passe, chacun peut confirmer avec sa clé d’accès (déverrouillage du téléphone) au lieu de saisir un code. Le code reste possible pour qui préfère.',
  },
  {
    value: 'FULL',
    label: 'Connexion complète',
    description:
      'En plus, on peut se connecter avec la clé d’accès seule, sans mot de passe ni code : c’est le plus pratique sur téléphone. Le mot de passe reste toujours possible en secours.',
  },
];

/** Paramètres › Sécurité : usage des clés d'accès par l'association (ADR 0036). */
@Component({
  selector: 'app-security-page',
  imports: [ActionBar, HelpHint, MatIconModule, MatRadioModule, MatCheckboxModule, ReactiveFormsModule, MatButtonModule],
  styleUrl: './admin-pages.scss',
  styles: [
    `
      .choice {
        display: flex;
        flex-direction: column;
        margin: 0 0 8px;
      }
      .choice .muted {
        margin: 0 0 8px 40px;
      }
      .domain {
        margin: 0 0 16px;
      }
    `,
  ],
  template: `
    <app-action-bar
      label="Sécurité"
      [description]="
        canEdit()
          ? 'Choisissez comment les personnes de l’association se connectent : mot de passe, code, ou clé d’accès (déverrouillage du téléphone).'
          : 'Comment les personnes de l’association se connectent. Vous pouvez le consulter, mais pas le modifier.'
      "
    />

    @if (loadError(); as failure) {
      <div class="alert" role="alert"><p>{{ failure.message }}</p></div>
    } @else if (view(); as current) {
      <form class="panel" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h3>
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">vpn_key</mat-icon><span>Clés d’accès</span>
          <app-help-hint term="cleAcces" />
        </h3>
        <p class="muted">
          Une clé d’accès évite de retaper un mot de passe et ne peut pas être volée par un faux site. Elle est <strong>facultative pour chacun</strong> :
          personne n’est obligé d’en créer une.
        </p>

        @if (current.domain.ok) {
          <p class="success domain">
            Les clés d’accès seront liées au nom de domaine <strong>{{ current.domain.rpId }}</strong>. Ne changez pas ce nom de domaine une fois
            les clés créées : elles ne fonctionneraient plus et chacun devrait les refaire (le mot de passe resterait possible).
          </p>
        } @else {
          <div class="alert domain" role="alert"><p>{{ current.domain.message }}</p></div>
        }

        <mat-radio-group formControlName="mode" aria-label="Usage des clés d’accès">
          @for (choice of choices; track choice.value) {
            <div class="choice">
              <mat-radio-button [value]="choice.value" [disabled]="choice.value !== 'DISABLED' && !current.domain.ok">{{ choice.label }}</mat-radio-button>
              <p class="muted">{{ choice.description }}</p>
            </div>
          }
        </mat-radio-group>

        @if (form.controls.mode.value === 'FULL') {
          <mat-checkbox formControlName="usernameless">Ne pas demander l’adresse email avant la clé d’accès</mat-checkbox>
          <p class="muted">
            Coché : l’appareil propose directement le compte, un seul geste suffit. Décoché : la personne saisit d’abord son adresse email.
          </p>
        }

        <p class="muted" aria-live="polite">
          @if (current.usersWithKeys === 0) {
            Personne n’a encore de clé d’accès.
          } @else {
            {{ current.usersWithKeys }} {{ current.usersWithKeys === 1 ? 'personne a' : 'personnes ont' }} au moins une clé d’accès utilisable.
          }
          @if (current.otherDomainKeys > 0) {
            <strong>
              {{ current.otherDomainKeys }} {{ current.otherDomainKeys === 1 ? 'clé a été créée' : 'clés ont été créées' }} sous un autre nom de domaine :
              {{ current.otherDomainKeys === 1 ? 'elle ne fonctionne plus' : 'elles ne fonctionnent plus' }}, il faut {{ current.otherDomainKeys === 1 ? 'la' : 'les' }} refaire
              depuis « Mon compte ».
            </strong>
          }
        </p>

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
        @if (notice(); as text) {
          <p class="success" role="status">{{ text }}</p>
        }
        @if (canEdit()) {
          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="saving()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">save</mat-icon> Enregistrer
            </button>
          </div>
        }
      </form>
    } @else {
      <p class="muted">Chargement…</p>
    }
  `,
})
export class SecurityPage {
  private readonly passkeys = inject(PasskeyService);
  private readonly auth = inject(AuthService);

  protected readonly choices = MODE_CHOICES;
  protected readonly view = signal<PasskeySettings | null>(null);
  protected readonly loadError = signal<FormError | null>(null);
  protected readonly error = signal<FormError | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly canEdit = computed(() => this.auth.can('settings.association:admin'));
  protected readonly form = inject(FormBuilder).nonNullable.group({ mode: 'DISABLED' as PasskeyMode, usernameless: false });

  constructor() {
    this.form.controls.mode.valueChanges.subscribe((mode) => {
      // La connexion sans adresse n'existe qu'en mode complet.
      if (mode !== 'FULL') this.form.controls.usernameless.setValue(false, { emitEvent: false });
    });
    void this.load();
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    if (!this.canEdit()) return;
    const { mode, usernameless } = this.form.getRawValue();
    this.saving.set(true);
    try {
      this.apply(await this.passkeys.saveSettings({ passkeyMode: mode, passkeyUsernameless: mode === 'FULL' && usernameless }));
      this.notice.set('Réglage enregistré.');
    } catch (error) {
      this.error.set(describeHttpError(error, 'Enregistrement impossible. Réessayez.'));
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.apply(await this.passkeys.settings());
    } catch (error) {
      this.loadError.set(describeHttpError(error, 'Impossible de charger ce réglage. Rechargez la page.'));
    }
  }

  private apply(settings: PasskeySettings): void {
    this.view.set(settings);
    this.form.reset({ mode: settings.mode, usernameless: settings.usernameless });
    if (!this.canEdit()) this.form.disable({ emitEvent: false });
  }
}
