import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { firstValueFrom } from 'rxjs';
import { AuthService, type SessionResponse } from './auth.service';

export type PasskeyMode = 'DISABLED' | 'SECOND_FACTOR' | 'FULL';

export interface PasskeyMethods {
  mode: PasskeyMode;
  usernameless: boolean;
}

export interface PasskeyItem {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: 'singleDevice' | 'multiDevice' | string;
  backedUp: boolean;
}

export interface PasskeyState extends PasskeyMethods {
  canRegister: boolean;
  items: PasskeyItem[];
}

/** Réglage de l'association (Paramètres › Sécurité). */
export interface PasskeySettings {
  mode: PasskeyMode;
  usernameless: boolean;
  effectiveMode: PasskeyMode;
  domain: { ok: true; rpId: string } | { ok: false; reason: string; message: string };
  usableKeys: number;
  otherDomainKeys: number;
  usersWithKeys: number;
}

interface Challenge<T> {
  challengeId: string;
  options: T;
}

/** Clés d'accès (ADR 0036) : appels à l'API et dialogue avec l'appareil (Face ID, empreinte, code, clé de sécurité). */
@Injectable({ providedIn: 'root' })
export class PasskeyService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** Le navigateur sait-il gérer les clés d'accès ? Sinon, aucune option n'est proposée. */
  supported(): boolean {
    return browserSupportsWebAuthn();
  }

  /** Moyens de connexion proposés avant toute session ; « désactivé » si le serveur ne répond pas. */
  async methods(): Promise<PasskeyMethods> {
    try {
      const response = await firstValueFrom(this.http.get<{ passkeys: PasskeyMethods }>('/api/auth/methods'));
      return response.passkeys;
    } catch {
      return { mode: 'DISABLED', usernameless: false };
    }
  }

  state(): Promise<PasskeyState> {
    return firstValueFrom(this.http.get<PasskeyState>('/api/auth/passkeys'));
  }

  /** Connexion par clé d'accès seule (mode complet). `email` est null quand l'association autorise de ne pas le saisir. */
  async login(email: string | null): Promise<void> {
    const challenge = await firstValueFrom(
      this.http.post<Challenge<PublicKeyCredentialRequestOptionsJSON>>('/api/auth/passkeys/login/options', { email }),
    );
    const response = await startAuthentication({ optionsJSON: challenge.options });
    const session = await firstValueFrom(
      this.http.post<SessionResponse>('/api/auth/passkeys/login/verify', { challengeId: challenge.challengeId, response }),
    );
    this.auth.completeLogin(session);
  }

  /** Second facteur d'une session ouverte avec le mot de passe. */
  async verify(): Promise<void> {
    const challenge = await firstValueFrom(
      this.http.post<Challenge<PublicKeyCredentialRequestOptionsJSON>>('/api/auth/passkeys/verify/options', {}),
    );
    const response = await startAuthentication({ optionsJSON: challenge.options });
    await firstValueFrom(this.http.post<void>('/api/auth/passkeys/verify', { challengeId: challenge.challengeId, response }));
    await this.auth.refresh();
  }

  /** Ajoute une clé. Le mot de passe est exigé quand la session est complète. Renvoie les codes de secours s'ils viennent d'être créés. */
  async register(label: string, password?: string): Promise<{ passkey: PasskeyItem; recoveryCodes: string[] | null }> {
    const challenge = await firstValueFrom(
      this.http.post<Challenge<PublicKeyCredentialCreationOptionsJSON>>('/api/auth/passkeys/register/options', password ? { password } : {}),
    );
    const response = await startRegistration({ optionsJSON: challenge.options });
    const result = await firstValueFrom(
      this.http.post<{ passkey: PasskeyItem; recoveryCodes: string[] | null }>('/api/auth/passkeys/register/verify', {
        challengeId: challenge.challengeId,
        response,
        label,
      }),
    );
    await this.auth.refresh();
    return result;
  }

  rename(id: string, label: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`/api/auth/passkeys/${id}`, { label }));
  }

  async revoke(id: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post<void>(`/api/auth/passkeys/${id}/revoke`, { password }));
    await this.auth.refresh();
  }

  settings(): Promise<PasskeySettings> {
    return firstValueFrom(this.http.get<PasskeySettings>('/api/security/passkeys'));
  }

  saveSettings(value: { passkeyMode: PasskeyMode; passkeyUsernameless: boolean }): Promise<PasskeySettings> {
    return firstValueFrom(this.http.put<PasskeySettings>('/api/security/passkeys', value));
  }
}
