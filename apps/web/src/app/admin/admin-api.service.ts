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

export interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  restricted: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  linkCount: number;
  latest: { number: number; originalName: string; mimeType: string; size: number; uploadedAt: string };
}

export interface DocumentVersionInfo {
  number: number;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  comment: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface DocumentLinkInfo {
  id: string;
  objectType: string;
  objectId: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  versions: DocumentVersionInfo[];
  links: DocumentLinkInfo[];
}

export interface DocumentOptions {
  categories: { key: string; label: string }[];
  objectTypes: string[];
  allowedExtensions: string[];
}

export interface DocumentFilters {
  q?: string;
  category?: string;
  includeArchived?: boolean;
  page?: number;
}

export interface DocumentUploadResult {
  document: DocumentDetail;
  duplicates: { documentId: string; title: string }[];
}

export interface BackupEntryInfo {
  name: string;
  createdAt: string;
  appVersion: string;
  bytes: number | null;
  migrations: number;
  counts: { users: number; documents: number; documentVersions: number; auditEvents: number };
  archivePresent: boolean;
}

export interface FiscalYearInfo {
  id: string;
  label: string;
  start: string;
  end: string;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
}

export type JournalType = 'BANK' | 'CASH' | 'PURCHASES' | 'REVENUE' | 'MISC' | 'OPENING';

export interface JournalInfo {
  id: string;
  code: string;
  label: string;
  type: JournalType;
  active: boolean;
}

export interface AccountInfo {
  id: string;
  number: string;
  label: string;
  active: boolean;
  reportLine: string | null;
}

export interface OperationsInfo {
  version: string;
  backups: {
    configured: boolean;
    report: { health: 'OK' | 'FAILING' | 'STALE' | 'NONE'; message: string; ageHours: number | null } | null;
    status: { lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; intervalHours: number; retentionDays: number } | null;
    entries: BackupEntryInfo[];
  };
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

  documentOptions(): Promise<DocumentOptions> {
    return firstValueFrom(this.http.get<DocumentOptions>('/api/documents/options'));
  }

  listDocuments(filters: DocumentFilters): Promise<{ items: DocumentSummary[]; total: number; pageSize: number }> {
    let params = new HttpParams();
    if (filters.q) params = params.set('q', filters.q);
    if (filters.category) params = params.set('category', filters.category);
    if (filters.includeArchived) params = params.set('includeArchived', 'true');
    if (filters.page && filters.page > 1) params = params.set('page', String(filters.page));
    return firstValueFrom(this.http.get<{ items: DocumentSummary[]; total: number; pageSize: number }>('/api/documents', { params }));
  }

  getDocument(id: string): Promise<DocumentDetail> {
    return firstValueFrom(this.http.get<DocumentDetail>(`/api/documents/${id}`));
  }

  uploadDocument(form: FormData): Promise<DocumentUploadResult> {
    return firstValueFrom(this.http.post<DocumentUploadResult>('/api/documents', form));
  }

  addDocumentVersion(id: string, form: FormData): Promise<DocumentUploadResult> {
    return firstValueFrom(this.http.post<DocumentUploadResult>(`/api/documents/${id}/versions`, form));
  }

  updateDocument(id: string, changes: { title?: string; category?: string; restricted?: boolean }): Promise<DocumentDetail> {
    return firstValueFrom(this.http.patch<DocumentDetail>(`/api/documents/${id}`, changes));
  }

  setDocumentArchived(id: string, archived: boolean): Promise<DocumentDetail> {
    return firstValueFrom(this.http.post<DocumentDetail>(`/api/documents/${id}/${archived ? 'archive' : 'unarchive'}`, {}));
  }

  addDocumentLink(id: string, objectType: string, objectId: string): Promise<DocumentDetail> {
    return firstValueFrom(this.http.post<DocumentDetail>(`/api/documents/${id}/links`, { objectType, objectId }));
  }

  removeDocumentLink(id: string, linkId: string): Promise<DocumentDetail> {
    return firstValueFrom(this.http.delete<DocumentDetail>(`/api/documents/${id}/links/${linkId}`));
  }

  /** Lien de téléchargement : le navigateur envoie son cookie de session, le serveur contrôle l'accès. */
  documentDownloadUrl(id: string, version?: number): string {
    return `/api/documents/${id}/download${version ? `?version=${version}` : ''}`;
  }

  listFiscalYears(): Promise<FiscalYearInfo[]> {
    return firstValueFrom(this.http.get<FiscalYearInfo[]>('/api/fiscal-years'));
  }

  createFiscalYear(body: { label: string; start: string; end: string }): Promise<FiscalYearInfo> {
    return firstValueFrom(this.http.post<FiscalYearInfo>('/api/fiscal-years', body));
  }

  updateFiscalYear(id: string, body: { label?: string; start?: string; end?: string }): Promise<FiscalYearInfo> {
    return firstValueFrom(this.http.patch<FiscalYearInfo>(`/api/fiscal-years/${id}`, body));
  }

  listJournals(): Promise<JournalInfo[]> {
    return firstValueFrom(this.http.get<JournalInfo[]>('/api/journals'));
  }

  createJournal(body: { code: string; label: string; type: JournalType }): Promise<JournalInfo> {
    return firstValueFrom(this.http.post<JournalInfo>('/api/journals', body));
  }

  updateJournal(id: string, body: { label?: string; active?: boolean }): Promise<JournalInfo> {
    return firstValueFrom(this.http.patch<JournalInfo>(`/api/journals/${id}`, body));
  }

  listAccounts(): Promise<AccountInfo[]> {
    return firstValueFrom(this.http.get<AccountInfo[]>('/api/accounts'));
  }

  createAccount(body: { number: string; label: string }): Promise<AccountInfo> {
    return firstValueFrom(this.http.post<AccountInfo>('/api/accounts', body));
  }

  updateAccount(id: string, body: { label?: string; active?: boolean }): Promise<AccountInfo> {
    return firstValueFrom(this.http.patch<AccountInfo>(`/api/accounts/${id}`, body));
  }

  importAccounts(accounts: { number: string; label: string }[]): Promise<{ created: number; skipped: number }> {
    return firstValueFrom(this.http.post<{ created: number; skipped: number }>('/api/accounts/import', { accounts }));
  }

  operations(): Promise<OperationsInfo> {
    return firstValueFrom(this.http.get<OperationsInfo>('/api/operations'));
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/auth/password', { currentPassword, newPassword }));
  }
}
