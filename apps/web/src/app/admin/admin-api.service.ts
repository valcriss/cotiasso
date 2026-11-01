import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
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

  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/auth/password', { currentPassword, newPassword }));
  }
}
