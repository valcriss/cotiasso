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

export type MfaState = 'OK' | 'VERIFICATION_REQUIRED' | 'ENROLLMENT_REQUIRED';

export interface MfaStatus {
  state: MfaState;
  enabled: boolean;
  required: boolean;
}

export interface EnrollmentStart {
  secret: string;
  otpauthUri: string;
}

interface SessionResponse {
  user: AuthUser;
  permissions: string[];
  /** Droits exercés sur des projets précis (portée projet) : permission → identifiants de projets. */
  projectPermissions?: Record<string, string[]>;
  mfa: MfaStatus;
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
  private readonly projectPermissionsState = signal<Readonly<Record<string, readonly string[]>>>({});
  private readonly setupRequiredState = signal(false);
  private readonly mfaState = signal<MfaStatus>({ state: 'OK', enabled: false, required: false });
  private csrf: string | null = null;
  private initialization?: Promise<void>;

  readonly user = this.userState.asReadonly();
  readonly setupRequired = this.setupRequiredState.asReadonly();
  readonly permissions = this.permissionsState.asReadonly();
  /** Droits sur des projets précis (permission → projets), en plus des droits globaux. */
  readonly projectPermissions = this.projectPermissionsState.asReadonly();
  /** État du second facteur : détermine si la session est complète ou partielle. */
  readonly mfa = this.mfaState.asReadonly();

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

  /** Recharge l'état de la session (après une vérification ou un changement de rôle côté serveur). */
  async refresh(): Promise<void> {
    this.applySession(await firstValueFrom(this.http.get<SessionResponse>('/api/auth/me')));
  }

  /** Vérifie le second facteur (code TOTP ou code de secours) de la session en cours. */
  async verifyMfa(code: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/mfa/verify', { code }));
    await this.refresh();
  }

  startMfaEnrollment(): Promise<EnrollmentStart> {
    return firstValueFrom(this.http.post<EnrollmentStart>('/api/auth/mfa/enroll/start', {}));
  }

  /** Confirme l'inscription et renvoie les codes de secours, affichés une seule fois. */
  async confirmMfaEnrollment(code: string): Promise<string[]> {
    const result = await firstValueFrom(this.http.post<{ recoveryCodes: string[] }>('/api/auth/mfa/enroll/confirm', { code }));
    await this.refresh();
    return result.recoveryCodes;
  }

  async disableMfa(password: string): Promise<void> {
    await firstValueFrom(this.http.post<void>('/api/auth/mfa/disable', { password }));
    await this.refresh();
  }

  async regenerateRecoveryCodes(password: string): Promise<string[]> {
    const result = await firstValueFrom(this.http.post<{ recoveryCodes: string[] }>('/api/auth/mfa/recovery-codes', { password }));
    return result.recoveryCodes;
  }

  /** Définit le mot de passe avec un jeton d'invitation ou de réinitialisation ; ne connecte pas l'utilisateur. */
  async resetPassword(token: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post<void>('/api/auth/password-reset', { token, password }));
  }

  /** Droit sur un projet précis : global, ou accordé sur ce projet par une attribution à portée projet. */
  canOnProject(permission: string, projectId: string): boolean {
    return this.can(permission) || (this.projectPermissionsState()[permission] ?? []).includes(projectId);
  }

  /** Droit global, ou sur au moins un projet : de quoi afficher une rubrique dont le serveur filtrera le contenu. */
  canAny(permission: string | undefined): boolean {
    return permission === undefined || this.can(permission) || (this.projectPermissionsState()[permission] ?? []).length > 0;
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
    this.projectPermissionsState.set({});
    this.mfaState.set({ state: 'OK', enabled: false, required: false });
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
    this.projectPermissionsState.set(response.projectPermissions ?? {});
    this.mfaState.set(response.mfa);
    this.userState.set(response.user);
  }
}
