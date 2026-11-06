import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { describePasskeyError } from '../auth/passkey-errors';
import { PasskeyService, type PasskeyItem, type PasskeyState } from '../auth/passkey.service';
import { recoveryCodesText } from '../pages/mfa-enroll.page';
import { HelpHint } from '../ui/help-hint';

/** Mes clés d'accès (Mon compte) : voir, ajouter, renommer et retirer. Le mot de passe est redemandé pour ajouter ou retirer. */
@Component({
  selector: 'app-passkeys-panel',
  imports: [DatePipe, HelpHint, MatIconModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styleUrl: './admin-pages.scss',
  styles: [
    `
      .keys {
        list-style: none;
        margin: 0 0 16px;
        padding: 0;
      }
      .keys li {
        align-items: center;
        border-bottom: 1px solid var(--app-border);
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        justify-content: space-between;
        padding: 8px 0;
      }
      .keys .name {
        font-weight: 500;
      }
      .rename {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
    `,
  ],
  template: `
    @if (state(); as current) {
      @if (current.mode !== 'DISABLED' || current.items.length > 0) {
        <section class="panel narrow" aria-labelledby="passkeys-title">
          <h3 id="passkeys-title">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">vpn_key</mat-icon><span>Clés d’accès</span>
            <app-help-hint term="cleAcces" />
          </h3>

          @if (current.mode === 'DISABLED') {
            <p class="muted">
              Votre association n’utilise pas les clés d’accès pour l’instant : vos clés sont conservées, mais ne servent plus. Un administrateur peut les
              réactiver dans Paramètres › Sécurité.
            </p>
          } @else {
            <p class="muted">
              Connectez-vous en déverrouillant votre appareil (empreinte, visage ou code), sans retaper de mot de passe. Vous pouvez en créer une par
              appareil : téléphone, ordinateur, clé de sécurité.
            </p>
          }

          @if (current.items.length === 0) {
            <p class="muted">Vous n’avez pas encore de clé d’accès.</p>
          } @else {
            <ul class="keys" aria-label="Mes clés d’accès">
              @for (item of current.items; track item.id) {
                <li>
                  @if (editing() === item.id) {
                    <form class="rename" (submit)="$event.preventDefault(); saveName(item)">
                      <mat-form-field appearance="outline">
                        <mat-label>Nom de la clé</mat-label>
                        <input matInput [formControl]="newName" maxlength="60" />
                      </mat-form-field>
                      <button mat-flat-button type="submit" [disabled]="busy()">Enregistrer</button>
                      <button mat-button type="button" (click)="editing.set(null)">Annuler</button>
                    </form>
                  } @else {
                    <span>
                      <span class="name">{{ item.label }}</span><br />
                      <span class="muted">
                        {{ item.deviceType === 'multiDevice' ? 'Synchronisée avec votre compte (iCloud, Google…)' : 'Sur cet appareil seulement' }} ·
                        ajoutée le {{ item.createdAt | date: 'dd/MM/yyyy' }} ·
                        {{ item.lastUsedAt ? 'utilisée le ' + (item.lastUsedAt | date: 'dd/MM/yyyy') : 'jamais utilisée' }}
                      </span>
                    </span>
                    <span class="actions">
                      <button mat-stroked-button type="button" [disabled]="busy()" (click)="startRename(item)">Renommer</button>
                      <button mat-stroked-button type="button" class="danger-text" [disabled]="busy()" (click)="remove(item)">Retirer</button>
                    </span>
                  }
                </li>
              }
            </ul>
          }

          <mat-form-field appearance="outline">
            <mat-label>Mot de passe actuel</mat-label>
            <input matInput type="password" [formControl]="password" autocomplete="current-password" />
            <mat-hint>Demandé pour ajouter ou retirer une clé.</mat-hint>
          </mat-form-field>

          @if (current.canRegister && supported) {
            <mat-form-field appearance="outline">
              <mat-label>Nom de la nouvelle clé</mat-label>
              <input matInput [formControl]="label" maxlength="60" />
              <mat-hint>Pour la reconnaître, par exemple « Mon téléphone ».</mat-hint>
            </mat-form-field>
          }

          @if (error(); as failure) {
            <p class="alert" role="alert">{{ failure }}</p>
          }
          @if (notice(); as text) {
            <p class="success" role="status">{{ text }}</p>
          }

          @if (current.canRegister) {
            @if (supported) {
              <div class="actions">
                <button mat-flat-button type="button" [disabled]="busy()" (click)="add()">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une clé d’accès
                </button>
              </div>
            } @else {
              <p class="muted">Ce navigateur ne gère pas les clés d’accès : utilisez-en un récent pour en créer une.</p>
            }
          }

          @if (newCodes(); as codes) {
            <h4>Vos codes de secours</h4>
            <p class="muted">
              Ils permettent de vous connecter si vous perdez votre appareil. Chaque code ne sert qu’une fois et ils ne seront plus affichés : copiez-les et
              rangez-les ailleurs que sur ce téléphone.
            </p>
            <ul class="codes" aria-label="Codes de secours">
              @for (code of codes; track code) {
                <li>{{ code }}</li>
              }
            </ul>
            <div class="actions">
              <button mat-stroked-button type="button" (click)="copyCodes(codes)">Copier</button>
            </div>
          }
        </section>
      }
    }
  `,
})
export class PasskeysPanel {
  private readonly passkeys = inject(PasskeyService);

  protected readonly supported = this.passkeys.supported();
  protected readonly state = signal<PasskeyState | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly newCodes = signal<string[] | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly password = new FormControl('', { nonNullable: true });
  protected readonly label = new FormControl('Mon téléphone', { nonNullable: true });
  protected readonly newName = new FormControl('', { nonNullable: true });

  constructor() {
    void this.reload();
  }

  protected async add(): Promise<void> {
    await this.run(async () => {
      if (this.password.value === '') throw new MissingPassword();
      const result = await this.passkeys.register(this.label.value.trim(), this.password.value);
      this.newCodes.set(result.recoveryCodes);
      this.notice.set('Clé d’accès ajoutée. Vous pouvez désormais l’utiliser pour vous connecter.');
    });
  }

  protected startRename(item: PasskeyItem): void {
    this.newName.setValue(item.label);
    this.editing.set(item.id);
  }

  protected async saveName(item: PasskeyItem): Promise<void> {
    await this.run(async () => {
      await this.passkeys.rename(item.id, this.newName.value.trim());
      this.editing.set(null);
      this.notice.set('Nom enregistré.');
    });
  }

  protected async remove(item: PasskeyItem): Promise<void> {
    await this.run(async () => {
      if (this.password.value === '') throw new MissingPassword();
      await this.passkeys.revoke(item.id, this.password.value);
      this.notice.set('Clé d’accès retirée. Elle ne permet plus de se connecter.');
    });
  }

  protected async copyCodes(codes: string[]): Promise<void> {
    try {
      await navigator.clipboard.writeText(recoveryCodesText(codes));
    } catch {
      // La liste reste affichée : la copie manuelle reste possible.
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      this.password.reset('');
      await this.reload();
    } catch (error) {
      if (error instanceof MissingPassword) this.error.set('Saisissez votre mot de passe actuel pour continuer.');
      else this.error.set(describePasskeyError(error, 'Action impossible. Réessayez.').message);
    } finally {
      this.busy.set(false);
    }
  }

  private async reload(): Promise<void> {
    try {
      this.state.set(await this.passkeys.state());
    } catch {
      this.state.set(null);
    }
  }
}

class MissingPassword extends Error {}
