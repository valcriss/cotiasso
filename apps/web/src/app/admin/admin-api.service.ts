import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  requiresMfa: boolean;
  version: number;
}

export interface UserAssignment {
  id: string;
  startsAt: string;
  endsAt: string | null;
  role: { id: string; key: string; name: string };
}

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roleAssignments: UserAssignment[];
}

export interface PermissionInfo {
  key: string;
  label: string;
}

/** Lien à usage unique à transmettre à l'utilisateur ; n'est montré qu'une seule fois. */
export interface PasswordLink {
  token: string;
  path: string;
  expiresAt: string;
  purpose: 'INVITATION' | 'RESET';
}

export interface RoleDraft {
  key?: string;
  name: string;
  description: string;
  permissions: string[];
  requiresMfa: boolean;
}

export type SettingsSection = 'identity' | 'branding';

export interface ModuleInfo {
  key: string;
  label: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE';
  reason: string | null;
  requires: string[];
  activatedAt: string | null;
}

export interface AuditEntry {
  seq: number;
  id: string;
  occurredAt: string;
  action: string;
  objectType: string;
  objectId: string | null;
  justification: string | null;
  details: unknown;
  actor: { id: string; displayName: string; email: string } | null;
}

export interface AuditPageResult {
  items: AuditEntry[];
  nextCursor: number | null;
}

export interface AuditFilters {
  action?: string;
  objectType?: string;
  from?: string;
  to?: string;
}

export interface IntegrityReport {
  ok: boolean;
  checked: number;
  unchained: number;
  firstBrokenSeq: number | null;
  reason: string | null;
}

/** Appels de l'API d'administration (utilisateurs, rôles, attributions). Le serveur applique les droits. */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);

  listUsers(): Promise<ManagedUser[]> {
    return firstValueFrom(this.http.get<ManagedUser[]>('/api/users'));
  }

  createUser(input: { email: string; displayName: string; roleIds: string[] }): Promise<{ user: ManagedUser; invitation: PasswordLink }> {
    return firstValueFrom(this.http.post<{ user: ManagedUser; invitation: PasswordLink }>('/api/users', input));
  }

  issueReset(userId: string): Promise<PasswordLink> {
    return firstValueFrom(this.http.post<PasswordLink>(`/api/users/${userId}/password-reset`, {}));
  }

  disable(userId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/users/${userId}/disable`, {}));
  }

  enable(userId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/users/${userId}/enable`, {}));
  }

  resetMfa(userId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/users/${userId}/mfa/reset`, {}));
  }

  revokeSessions(userId: string): Promise<{ revoked: number }> {
    return firstValueFrom(this.http.post<{ revoked: number }>(`/api/users/${userId}/sessions/revoke`, {}));
  }

  assignRole(userId: string, roleId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/users/${userId}/assignments`, { roleId }));
  }

  revokeAssignment(assignmentId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/assignments/${assignmentId}`));
  }

  listRoles(): Promise<RoleSummary[]> {
    return firstValueFrom(this.http.get<RoleSummary[]>('/api/roles'));
  }

  createRole(draft: RoleDraft): Promise<RoleSummary> {
    return firstValueFrom(this.http.post<RoleSummary>('/api/roles', draft));
  }

  updateRole(roleId: string, draft: RoleDraft): Promise<RoleSummary> {
    return firstValueFrom(this.http.put<RoleSummary>(`/api/roles/${roleId}`, draft));
  }

  listPermissions(): Promise<PermissionInfo[]> {
    return firstValueFrom(this.http.get<PermissionInfo[]>('/api/authz/permissions'));
  }

  getSettings<T>(section: SettingsSection): Promise<T> {
    return firstValueFrom(this.http.get<{ value: T }>(`/api/settings/${section}`)).then((response) => response.value);
  }

  updateSettings<T>(section: SettingsSection, value: T): Promise<{ changed: boolean; value: T }> {
    return firstValueFrom(this.http.put<{ changed: boolean; value: T }>(`/api/settings/${section}`, value));
  }

  listModules(): Promise<ModuleInfo[]> {
    return firstValueFrom(this.http.get<ModuleInfo[]>('/api/modules'));
  }

  activateModule(key: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/modules/${key}/activate`, {}));
  }

  deactivateModule(key: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/modules/${key}/deactivate`, {}));
  }

  listAudit(filters: AuditFilters, before?: number): Promise<AuditPageResult> {
    let params = new HttpParams().set('limit', '50');
    for (const [key, value] of Object.entries(filters)) if (value) params = params.set(key, value);
    if (before !== undefined) params = params.set('before', String(before));
    return firstValueFrom(this.http.get<AuditPageResult>('/api/audit', { params }));
  }

  auditFacets(): Promise<{ actions: string[]; objectTypes: string[] }> {
    return firstValueFrom(this.http.get<{ actions: string[]; objectTypes: string[] }>('/api/audit/facets'));
  }

  verifyAudit(): Promise<IntegrityReport> {
    return firstValueFrom(this.http.get<IntegrityReport>('/api/audit/verify'));
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/auth/password', { currentPassword, newPassword }));
  }
}
