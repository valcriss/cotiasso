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

export interface ClosingCheckInfo {
  code: string;
  level: 'BLOCKING' | 'WARNING';
  message: string;
}

export interface ClosingReportInfo {
  fiscalYearId: string;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  checks: ClosingCheckInfo[];
  canStart: boolean;
  canClose: boolean;
  preview: { accountCount: number; result: { kind: 'SURPLUS' | 'DEFICIT' | 'BALANCED'; amount: string } } | null;
}

export interface LedgerLineInfo {
  date: string;
  journalCode: string;
  entryId: string;
  entryNumber: number;
  entryLabel: string;
  reference: string | null;
  lineLabel: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface LedgerAccountInfo {
  accountId: string;
  number: string;
  label: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
  lines: LedgerLineInfo[];
}

export interface TrialBalanceRowInfo {
  accountId: string;
  number: string;
  label: string;
  debit: string;
  credit: string;
  debitBalance: string;
  creditBalance: string;
}

export interface TrialBalanceInfo {
  rows: TrialBalanceRowInfo[];
  totals: { debit: string; credit: string; debitBalance: string; creditBalance: string };
  balanced: boolean;
}

export interface JournalBookEntryInfo {
  id: string;
  date: string;
  journalCode: string;
  number: number;
  label: string;
  reference: string | null;
  kind: string;
  status: string;
  lines: { accountNumber: string; accountLabel: string; label: string | null; debit: string; credit: string }[];
  totalDebit: string;
  totalCredit: string;
}

export interface BalanceInfo {
  opening: string;
  computed: string;
  accounting: string;
  lastStatement: { periodEnd: string; closingBalance: string; computedAtEnd: string; gap: string } | null;
}

export interface FinancialAccountInfo {
  id: string;
  name: string;
  type: 'BANK' | 'CASH';
  currency: string;
  reference: string | null;
  accountId: string;
  accountNumber: string;
  journalId: string;
  journalCode: string;
  openedOn: string;
  archivedOn: string | null;
  balances: BalanceInfo;
}

export interface TransactionInfo {
  id: string;
  financialAccountId: string;
  operationDate: string;
  valueDate: string | null;
  amount: string;
  label: string;
  reference: string | null;
  origin: 'MANUAL' | 'IMPORT';
  externalId: string | null;
  bankIdentified: boolean;
  projectId: string | null;
  projectCode: string | null;
  counterpartAccountId: string | null;
  counterpartAccountNumber: string | null;
  qualified: boolean;
  version: number;
}

export interface TransactionBody {
  operationDate: string;
  amount: string;
  label: string;
  reference: string | null;
  projectId: string | null;
  counterpartAccountId: string | null;
}

export interface ImportCandidateInfo {
  transactionId: string;
  operationDate: string;
  label: string;
  score: number;
}

export interface ImportLineInfo {
  id: string;
  position: number;
  status: 'NEW' | 'DUPLICATE' | 'PROBABLE_MATCH' | 'ERROR';
  fitId: string | null;
  operationDate: string | null;
  amount: string | null;
  label: string;
  reference: string | null;
  errors: string[];
  candidates: ImportCandidateInfo[];
  matchedTransactionId: string | null;
  decision: 'CREATE' | 'LINK' | 'SKIP' | null;
  transactionId: string | null;
}

export interface ImportInfo {
  id: string;
  financialAccountId: string;
  fileName: string;
  format: string;
  status: 'ANALYZED' | 'COMMITTED' | 'CANCELLED';
  periodStart: string | null;
  periodEnd: string | null;
  ledgerBalance: string | null;
  ledgerBalanceDate: string | null;
  accountHint: string | null;
  summary: {
    total: number;
    new: number;
    duplicate: number;
    probableMatch: number;
    error: number;
    result?: { created: number; linked: number; skipped: number };
  };
  createdAt: string;
  committedAt: string | null;
  lines: ImportLineInfo[];
}

export interface ImportDecisionBody {
  lineId: string;
  action: 'CREATE' | 'LINK' | 'SKIP';
  transactionId?: string;
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  q?: string;
  qualified?: 'true' | 'false';
  after?: string;
}

export interface ReportParams {
  fiscalYearId: string;
  from?: string;
  to?: string;
  accountId?: string;
  prefix?: string;
  journalId?: string;
}

export type EntryStatus = 'DRAFT' | 'POSTED' | 'REVERSED';

export type ProjectStatus = 'PREPARATION' | 'ACTIVE' | 'FINISHED' | 'ARCHIVED';

export interface ProjectInfo {
  id: string;
  code: string;
  name: string;
  description: string;
  status: ProjectStatus;
  permanent: boolean;
  startDate: string | null;
  endDate: string | null;
  managerId: string | null;
}

export interface ProjectTotalsInfo {
  charges: string;
  produits: string;
  result: string;
}

export interface ProjectSummaryInfo {
  total: ProjectTotalsInfo;
  years: ({ fiscalYearId: string; label: string } & ProjectTotalsInfo)[];
}

export interface AllocationInfo {
  projectId: string;
  projectCode?: string;
  amount: string;
}

export interface EntryLineInfo {
  position: number;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  debit: string;
  credit: string;
  label: string | null;
  allocations: AllocationInfo[];
}

export interface EntryInfo {
  id: string;
  fiscalYearId: string;
  journalId: string;
  journalCode: string;
  date: string;
  label: string;
  reference: string | null;
  kind: 'NORMAL' | 'ADJUSTMENT' | 'REVERSAL' | 'OPENING';
  status: EntryStatus;
  number: number | null;
  version: number;
  postedAt: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  totalDebit: string;
  totalCredit: string;
  lines: EntryLineInfo[];
}

export interface EntryDraftBody {
  journalId: string;
  date: string;
  label: string;
  reference: string | null;
  lines: { accountId: string; debit: string; credit: string; label?: string | null; allocations?: AllocationInfo[] }[];
}

export interface EntryFilters {
  fiscalYearId?: string;
  journalId?: string;
  status?: EntryStatus;
  after?: string;
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

  createAccount(body: { number: string; label: string; reportLine?: string }): Promise<AccountInfo> {
    return firstValueFrom(this.http.post<AccountInfo>('/api/accounts', body));
  }

  updateAccount(id: string, body: { label?: string; active?: boolean }): Promise<AccountInfo> {
    return firstValueFrom(this.http.patch<AccountInfo>(`/api/accounts/${id}`, body));
  }

  importAccounts(accounts: { number: string; label: string }[]): Promise<{ created: number; skipped: number }> {
    return firstValueFrom(this.http.post<{ created: number; skipped: number }>('/api/accounts/import', { accounts }));
  }

  closingReport(id: string): Promise<ClosingReportInfo> {
    return firstValueFrom(this.http.get<ClosingReportInfo>(`/api/fiscal-years/${id}/closing`));
  }

  startClosing(id: string): Promise<ClosingReportInfo> {
    return firstValueFrom(this.http.post<ClosingReportInfo>(`/api/fiscal-years/${id}/closing/start`, {}));
  }

  cancelClosing(id: string): Promise<ClosingReportInfo> {
    return firstValueFrom(this.http.post<ClosingReportInfo>(`/api/fiscal-years/${id}/closing/cancel`, {}));
  }

  closeFiscalYear(
    id: string,
    body: { surplusAccountId?: string | null; deficitAccountId?: string | null },
  ): Promise<{ openingEntryId: string }> {
    return firstValueFrom(this.http.post<{ openingEntryId: string }>(`/api/fiscal-years/${id}/closing/close`, body));
  }

  private reportParams(params: ReportParams): HttpParams {
    let query = new HttpParams();
    for (const [key, value] of Object.entries(params)) if (value) query = query.set(key, value);
    return query;
  }

  ledger(params: ReportParams): Promise<{ accounts: LedgerAccountInfo[] }> {
    return firstValueFrom(this.http.get<{ accounts: LedgerAccountInfo[] }>('/api/reports/ledger', { params: this.reportParams(params) }));
  }

  trialBalance(params: ReportParams): Promise<TrialBalanceInfo> {
    return firstValueFrom(this.http.get<TrialBalanceInfo>('/api/reports/trial-balance', { params: this.reportParams(params) }));
  }

  journalBook(params: ReportParams): Promise<{ entries: JournalBookEntryInfo[] }> {
    return firstValueFrom(this.http.get<{ entries: JournalBookEntryInfo[] }>('/api/reports/journal', { params: this.reportParams(params) }));
  }

  listFinancialAccounts(): Promise<FinancialAccountInfo[]> {
    return firstValueFrom(this.http.get<FinancialAccountInfo[]>('/api/financial-accounts'));
  }

  createFinancialAccount(body: {
    name: string;
    type: 'BANK' | 'CASH';
    reference: string | null;
    accountId: string;
    openedOn: string;
    openingBalance: string;
  }): Promise<FinancialAccountInfo> {
    return firstValueFrom(this.http.post<FinancialAccountInfo>('/api/financial-accounts', body));
  }

  archiveFinancialAccount(id: string): Promise<FinancialAccountInfo> {
    return firstValueFrom(this.http.patch<FinancialAccountInfo>(`/api/financial-accounts/${id}`, { archived: true }));
  }

  recordStatement(id: string, body: { periodStart: string; periodEnd: string; closingBalance: string }): Promise<unknown> {
    return firstValueFrom(this.http.post<unknown>(`/api/financial-accounts/${id}/statements`, body));
  }

  listTransactions(accountId: string, filters: TransactionFilters = {}): Promise<{ transactions: TransactionInfo[]; next: string | null }> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) if (value) params = params.set(key, value);
    return firstValueFrom(
      this.http.get<{ transactions: TransactionInfo[]; next: string | null }>(`/api/financial-accounts/${accountId}/transactions`, { params }),
    );
  }

  createTransaction(accountId: string, body: TransactionBody): Promise<TransactionInfo> {
    return firstValueFrom(this.http.post<TransactionInfo>(`/api/financial-accounts/${accountId}/transactions`, body));
  }

  updateTransaction(id: string, body: Partial<TransactionBody> & { version: number }): Promise<TransactionInfo> {
    return firstValueFrom(this.http.patch<TransactionInfo>(`/api/transactions/${id}`, body));
  }

  deleteTransaction(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/transactions/${id}`));
  }

  analyzeImport(accountId: string, file: File): Promise<ImportInfo> {
    const body = new FormData();
    body.append('file', file, file.name);
    return firstValueFrom(this.http.post<ImportInfo>(`/api/financial-accounts/${accountId}/imports`, body));
  }

  commitImport(id: string, body: { decisions: ImportDecisionBody[]; recordStatement: boolean }): Promise<ImportInfo> {
    return firstValueFrom(this.http.post<ImportInfo>(`/api/imports/${id}/commit`, body));
  }

  cancelImport(id: string): Promise<ImportInfo> {
    return firstValueFrom(this.http.post<ImportInfo>(`/api/imports/${id}/cancel`, {}));
  }

  listProjects(): Promise<ProjectInfo[]> {
    return firstValueFrom(this.http.get<ProjectInfo[]>('/api/projects'));
  }

  createProject(body: Partial<ProjectInfo> & { code: string; name: string }): Promise<ProjectInfo> {
    return firstValueFrom(this.http.post<ProjectInfo>('/api/projects', body));
  }

  updateProject(id: string, body: Partial<Omit<ProjectInfo, 'id' | 'code' | 'permanent'>>): Promise<ProjectInfo> {
    return firstValueFrom(this.http.patch<ProjectInfo>(`/api/projects/${id}`, body));
  }

  projectSummary(id: string): Promise<ProjectSummaryInfo> {
    return firstValueFrom(this.http.get<ProjectSummaryInfo>(`/api/projects/${id}/summary`));
  }

  accountingSettings(): Promise<{ projectRequired: boolean }> {
    return firstValueFrom(this.http.get<{ projectRequired: boolean }>('/api/accounting/settings'));
  }

  updateAccountingSettings(body: { projectRequired: boolean }): Promise<{ changed: boolean }> {
    return firstValueFrom(this.http.put<{ changed: boolean }>('/api/accounting/settings', body));
  }

  listEntries(filters: EntryFilters = {}): Promise<{ entries: EntryInfo[]; next: string | null }> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) if (value) params = params.set(key, value);
    return firstValueFrom(this.http.get<{ entries: EntryInfo[]; next: string | null }>('/api/entries', { params }));
  }

  getEntry(id: string): Promise<EntryInfo> {
    return firstValueFrom(this.http.get<EntryInfo>(`/api/entries/${id}`));
  }

  createEntry(body: EntryDraftBody): Promise<EntryInfo> {
    return firstValueFrom(this.http.post<EntryInfo>('/api/entries', body));
  }

  updateEntry(id: string, body: EntryDraftBody & { version: number }): Promise<EntryInfo> {
    return firstValueFrom(this.http.put<EntryInfo>(`/api/entries/${id}`, body));
  }

  deleteEntry(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/entries/${id}`));
  }

  postEntry(id: string): Promise<EntryInfo> {
    return firstValueFrom(this.http.post<EntryInfo>(`/api/entries/${id}/post`, {}));
  }

  reverseEntry(id: string, body: { date?: string; label?: string } = {}): Promise<EntryInfo> {
    return firstValueFrom(this.http.post<EntryInfo>(`/api/entries/${id}/reverse`, body));
  }

  operations(): Promise<OperationsInfo> {
    return firstValueFrom(this.http.get<OperationsInfo>('/api/operations'));
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/auth/password', { currentPassword, newPassword }));
  }
}
