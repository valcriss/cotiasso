import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
}

interface SessionResponse {
  user: AuthUser;
  permissions: string[];
  csrfToken: string;
  expiresAt: string;
}

export interface SetupRequest {
  token: string;
  email: string;
  displayName: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly userState = signal<AuthUser | null>(null);
  private readonly permissionsState = signal<ReadonlySet<string>>(new Set());
  private readonly setupRequiredState = signal(false);
  private csrf: string | null = null;
  private initialization?: Promise<void>;

  readonly user = this.userState.asReadonly();
  readonly setupRequired = this.setupRequiredState.asReadonly();
  readonly permissions = this.permissionsState.asReadonly();

  /** Indique si l'utilisateur détient la permission ; sert à adapter l'interface, le serveur reste l'autorité. */
  can(permission: string | undefined): boolean {
    return permission === undefined || this.permissionsState().has(permission);
  }

  /** Jeton CSRF à joindre aux requêtes modifiantes ; absent tant qu'aucune session n'est ouverte. */
  get csrfToken(): string | null {
    return this.csrf;
  }

  /** Détermine une seule fois l'état initial : installation requise ou session existante. */
  initialize(): Promise<void> {
    this.initialization ??= this.loadInitialState();
    return this.initialization;
  }

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/login', { email, password }));
    this.applySession(response);
  }

  async completeSetup(request: SetupRequest): Promise<void> {
    const response = await firstValueFrom(this.http.post<SessionResponse>('/api/setup', request));
    this.setupRequiredState.set(false);
    this.applySession(response);
  }

  /** Définit le mot de passe avec un jeton d'invitation ou de réinitialisation ; ne connecte pas l'utilisateur. */
  async resetPassword(token: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post<void>('/api/auth/password-reset', { token, password }));
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>('/api/auth/logout', {}));
    } finally {
      this.clearSession();
    }
  }

  /** Oublie la session locale (déconnexion, ou session expirée côté serveur). */
  clearSession(): void {
    this.userState.set(null);
    this.permissionsState.set(new Set());
    this.csrf = null;
  }

  private async loadInitialState(): Promise<void> {
    try {
      const status = await firstValueFrom(this.http.get<{ setupRequired: boolean }>('/api/setup/status'));
      this.setupRequiredState.set(status.setupRequired);
      if (status.setupRequired) return;
      this.applySession(await firstValueFrom(this.http.get<SessionResponse>('/api/auth/me')));
    } catch {
      // Pas de session (401) ou serveur injoignable : l'utilisateur arrivera sur la page de connexion.
      this.clearSession();
    }
  }

  private applySession(response: SessionResponse): void {
    this.csrf = response.csrfToken;
    this.permissionsState.set(new Set(response.permissions));
    this.userState.set(response.user);
  }
}
