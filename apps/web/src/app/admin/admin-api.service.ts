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
  /** Portée projet de l'attribution ; absent = toute l'association. */
  project?: { id: string; code: string; name: string } | null;
}

export interface UserAccess {
  permissions: { permission: string; label: string; grantedBy: { assignmentId: string; roleId: string; roleKey: string; roleName: string }[] }[];
  projectPermissions: { permission: string; label: string; projectId: string; projectCode: string; projectName: string; grantedBy: { assignmentId: string; roleId: string; roleKey: string; roleName: string } }[];
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
  /** Droit à confier avec soin (sécurité, comptes définitifs, export de toutes les données). */
  sensitive?: boolean;
}

/** Résultat de l'envoi du lien par email : envoyé, échoué (l'administrateur transmet alors le lien lui-même) ou envoi non configuré. */
export type MailOutcome = { status: 'SENT'; to: string } | { status: 'FAILED'; to: string } | { status: 'NOT_CONFIGURED' };

/** Lien à usage unique à transmettre à l'utilisateur ; n'est montré qu'une seule fois. */
export interface PasswordLink {
  token: string;
  path: string;
  expiresAt: string;
  purpose: 'INVITATION' | 'RESET';
  /** Ce qu'il est advenu de l'email qui porte ce lien. */
  mail?: MailOutcome;
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
  /** Documents liés à un objet précis (projet, subvention…). */
  objectType?: string;
  objectId?: string;
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
  /** Rapports figés automatiquement par la fermeture ou la clôture (ADR 0031) ; `error` s'ils n'ont pas pu l'être. */
  frozen?: FrozenOutcomeInfo;
}

export type FrozenOutcomeInfo = { number: number; provisional: boolean } | { error: string };

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
  /** Dernier rapprochement validé : seul cas où le compte est dit « rapproché ». */
  reconciled: { periodEnd: string; closingBalance: string } | null;
  lastStatement: { periodEnd: string; closingBalance: string; computedAtEnd: string; gap: string } | null;
}

// --- Parcours simplifiés (ADR 0028) ---

export interface OperationCategoryInfo {
  id: string;
  direction: 'IN' | 'OUT';
  label: string;
  hint: string;
  active: boolean;
  /** Rôle particulier (cotisations, subventions) : la catégorie proposée d'office pour ces règlements. */
  usage: 'MEMBERSHIP' | 'GRANT' | null;
  account: { id: string; number: string; label: string };
}

export interface TodoItemInfo {
  code: string;
  level: 'TODO' | 'WARNING' | 'INFO';
  title: string;
  detail: string;
  count?: number;
  link: string;
  /** De quoi ouvrir l'écran déjà filtré (ex. le compte qui a des mouvements à classer). */
  query?: Record<string, string>;
  actionLabel: string;
}

export interface RecentOperationInfo {
  id: string;
  date: string;
  label: string;
  /** Montant signé : positif = argent reçu, négatif = argent dépensé. */
  amount: string;
  accountName: string;
  situation: 'TO_CLASSIFY' | 'CLASSIFIED' | 'DRAFT' | 'BOOKED' | 'TRANSFER';
}

export interface OverviewInfo {
  setup: {
    fiscalYear: boolean;
    accounts: boolean;
    financialAccount: boolean;
    categories: boolean;
    startMode: 'HISTORY' | 'OPENING' | null;
    openingSituation: 'NONE' | 'DRAFT' | 'POSTED' | 'SKIPPED';
  };
  cash: { total: string; accounts: { id: string; name: string; balance: string }[] } | null;
  month: { from: string; to: string; received: string; spent: string } | null;
  /** Les 5 dernières opérations (absentes sans droit de lecture des comptes). */
  recent?: RecentOperationInfo[] | null;
  todo: TodoItemInfo[];
}

export type StartModeInfo = 'HISTORY' | 'OPENING' | null;

export interface OpeningSituationInfo {
  mode: StartModeInfo;
  date: string | null;
  accounts: { id: string; name: string; openedOn: string; openingBalance: string }[];
  misaligned: { id: string; name: string; openedOn: string }[];
  kinds: { key: string; side: 'RECEIVABLE' | 'PAYABLE'; label: string; hint: string; available: boolean }[];
  equityAccounts: { id: string; number: string; label: string }[];
  suggestedEquityAccountId: string | null;
  existing: { entryId: string; date: string; status: 'DRAFT' | 'POSTED' } | null;
  fiscalYear: boolean;
}

export interface OpeningSituationBody {
  date: string;
  receivables: { kind: string; label?: string; thirdPartyId?: string; amount: string }[];
  payables: { kind: string; label?: string; thirdPartyId?: string; amount: string }[];
  equityAmount: string;
  equityAccountId?: string | null;
  explanation?: string | null;
  post?: boolean;
}

export interface OpeningSituationResultInfo {
  entryId: string;
  posted: boolean;
  journalCode: string;
  number: number | null;
  equity: string;
  lines: number;
}

/** Une part d'un montant fractionné : une catégorie et son montant (chaîne décimale positive). */
export interface CategorySplitBody {
  categoryId: string;
  amount: string;
}

/** Une catégorie, ou une répartition en parts (jamais les deux). */
export type CategoryChoiceBody = { categoryId: string; splits?: undefined } | { splits: CategorySplitBody[]; categoryId?: undefined };

export type GuidedOperationBody = {
  financialAccountId: string;
  direction: 'IN' | 'OUT';
  amount: string;
  date: string;
  label: string;
  projectId?: string | null;
  reference?: string | null;
  post?: boolean;
} & CategoryChoiceBody;

export interface CorrectOperationBody {
  categoryId?: string;
  /** `null` : retour au projet par défaut ; absent : le projet actuel est gardé. */
  projectId?: string | null;
  label?: string;
}

export interface AdjustAmountBody {
  /** Le montant juste, positif. */
  amount: string;
  date: string;
}

export type AdjustAmountResult = GuidedOperationResult & { adjustedTransactionId: string; difference: string };

export interface BulkBookInfo {
  booked: number;
  posted: number;
  drafts: number;
  ignored: { transactionId: string; label: string; date: string; reason: string }[];
}

export interface GuidedOperationResult {
  transactionId: string;
  entryId: string;
  posted: boolean;
  journalCode: string;
  number: number | null;
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
  /** Répartie sur plusieurs catégories : pas de catégorie unique, ses parts sont dans l'écriture liée. */
  split: boolean;
  /** Comptabilisation : « à comptabiliser », « en cours » (écriture en brouillon) ou « comptabilisée ». */
  accounting: 'NONE' | 'IN_PROGRESS' | 'POSTED';
  entry: { id: string; status: 'DRAFT' | 'POSTED'; journalCode: string; number: number | null } | null;
  transfer: { id: string; direction: 'OUT' | 'IN'; otherAccountId: string; otherAccountName: string } | null;
  /** Montant et date figés : identifiant bancaire, écriture liée ou virement. */
  financialLock: 'RECONCILED' | 'BANK' | 'ENTRY' | 'TRANSFER' | null;
  deletable: boolean;
  /** Rapprochement où la transaction est pointée ; « validé » = rapprochée. */
  reconciliation: { id: string; status: 'IN_PROGRESS' | 'VALIDATED'; periodEnd: string } | null;
  version: number;
  /** Proposition de classement (ADR 0019 amendé) : seulement dans la liste, jamais appliquée seule. */
  suggestion?: TransactionSuggestionInfo | null;
  /** Un document visible est lié au mouvement (liste seulement, avec le droit de lire les documents). */
  hasDocument?: boolean;
}

export interface TransactionSuggestionInfo {
  counterpartAccountId: string;
  counterpartAccountNumber: string;
  counterpartAccountLabel: string;
  projectId: string | null;
  projectCode: string | null;
  /** Le mouvement le plus récent dont le classement est repris. */
  basedOn: { label: string; operationDate: string };
  matches: number;
}

export interface StatementInfo {
  id: string;
  periodStart: string;
  periodEnd: string;
  closingBalance: string;
}

export interface ReconciliationCheckInfo {
  code: 'GAP' | 'UNPOSTED_POINTED' | 'ENTRIES_WITHOUT_TRANSACTION';
  level: 'BLOCKING' | 'WARNING';
  message: string;
}

export interface ReconciliationInfo {
  id: string;
  financialAccountId: string;
  statementId: string;
  periodEnd: string;
  status: 'IN_PROGRESS' | 'VALIDATED' | 'CANCELLED';
  openingBalance: string;
  closingBalance: string;
  pointedCount: number;
  pointedTotal: string;
  pointedBalance: string;
  gap: string;
  outstandingCount: number;
  outstandingTotal: string;
  checks: ReconciliationCheckInfo[];
  canValidate: boolean;
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
}

export interface PointableTransactionInfo {
  transaction: TransactionInfo;
  pointed: boolean;
}

export interface MemberCategoryInfo {
  id: string;
  name: string;
  active: boolean;
  memberCount: number;
}

export interface MemberInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: 'ACTIVE' | 'FORMER';
  joinedOn: string | null;
  leftOn: string | null;
  hasAccount: boolean;
  note: string | null;
  anonymized: boolean;
  currentOffices: string[];
  version: number;
  /** Cotisation de la saison en cours, seulement dans la liste (`null` : aucune saison en cours). */
  membershipStatus?: MemberCotisationState | null;
}

export interface MemberOfficeInfo {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  note: string | null;
  current: boolean;
}

export interface MemberBody {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  categoryId: string | null;
  joinedOn: string | null;
  note: string | null;
}

export type MemberCotisationState = 'UP_TO_DATE' | 'PARTIAL' | 'DUE' | 'EXEMPT' | 'NONE';

export interface RenewalPreviewInfo {
  campaign: { id: string; name: string };
  source: { id: string; name: string } | null;
  tariffs: { id: string; label: string; amount: string }[];
  items: { memberId: string; memberName: string; categoryName: string | null; previouslyEnrolled: boolean; previousTariffLabel: string | null; proposedTariffId: string | null }[];
}

export interface BulkEnrollInfo {
  created: number;
  expectedTotal: string;
  skipped: { memberId: string; memberName: string; reason: string }[];
}

export interface MemberFilters {
  q?: string;
  status?: 'ACTIVE' | 'FORMER';
  categoryId?: string;
  /** Cotisation de la saison en cours : à jour (exonérés compris), en retard (due ou partielle), ou pas inscrit. */
  membershipStatus?: 'UP_TO_DATE' | 'LATE' | 'NONE';
  after?: string;
}

export type MembershipModeInfo = 'PAYMENT' | 'VALIDATION' | 'START_DATE';

export interface TariffInfo {
  id: string;
  label: string;
  amount: string;
  categoryId: string | null;
  categoryName: string | null;
  membershipCount: number;
}

export interface CampaignInfo {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  effectiveMode: MembershipModeInfo;
  tariffs: TariffInfo[];
  membershipCount: number;
  locked: boolean;
}

export interface MembershipInfo {
  id: string;
  campaignId: string;
  campaignName: string;
  memberId: string;
  memberName: string;
  tariffId: string | null;
  tariffLabel: string | null;
  expectedAmount: string;
  exemptionReason: string | null;
  status: 'PENDING' | 'EFFECTIVE' | 'CANCELLED';
  effectiveOn: string | null;
  effectiveOrigin: 'PAYMENT' | 'VALIDATION' | 'START_DATE' | 'EXEMPTION' | null;
  cancelReason: string | null;
  /** Règlements nets affectés ; `balance` = attendu − payé (négatif = trop-perçu). */
  paid: string;
  balance: string;
  overpaid: boolean;
  version: number;
}

export interface PaymentAllocationInfo {
  id: string;
  transactionId: string;
  transactionDate: string;
  accountName: string;
  amount: string;
  kind: 'PAYMENT' | 'REFUND';
  note: string | null;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface PaymentCandidateInfo {
  id: string;
  operationDate: string;
  label: string;
  accountName: string;
  amount: string;
  remaining: string;
  /** Le mouvement n'est pas encore dans les comptes : on peut l'y enregistrer d'un même geste. */
  canBook?: boolean;
}

export interface ReminderInfo {
  campaignName: string;
  totalDue: string;
  items: { membership: MembershipInfo; email: string | null; phone: string | null }[];
}

export interface ReceiptInfo {
  association: { name: string; address: string; postalCode: string; city: string };
  member: string;
  campaign: { name: string; startsOn: string; endsOn: string };
  expectedAmount: string;
  payments: { date: string; amount: string; kind: 'PAYMENT' | 'REFUND' }[];
  paid: string;
  balance: string;
  issuedOn: string;
  notice: string;
}

export interface ComparedRowInfo {
  code: string;
  label: string;
  amount: string;
  /** Montant de l'exercice précédent ; `null` sans exercice précédent. */
  previous: string | null;
}

export interface ComparedGroupInfo {
  code: string;
  label: string;
  help: string;
  rows: ComparedRowInfo[];
  total: string;
  previousTotal: string | null;
}

export interface StatementYearInfo {
  id: string;
  label: string;
  start: string;
  end: string;
  status: string;
}

interface StatementBaseInfo {
  fiscalYear: StatementYearInfo;
  previous: StatementYearInfo | null;
  draftEntries: number;
  carryWarning: string | null;
}

export interface FrozenReportSummaryInfo {
  id: string;
  fiscalYearId: string;
  number: number;
  kind: 'CLOSING' | 'CLOSED' | 'MANUAL';
  provisional: boolean;
  label: string;
  reason: string | null;
  supersedesNumber: number | null;
  latest: boolean;
  calcVersion: number;
  createdAt: string;
  sha256: string;
  approval: { meetingDate: string; note: string; approvedAt: string } | null;
}

export interface FrozenReportDetailInfo extends FrozenReportSummaryInfo {
  intact: boolean;
  content: {
    meta: { generatedAt: string; calcVersion: number; provisional: boolean; draftEntries: number; fiscalYear: { id: string; label: string; start: string; end: string; status: string } };
    incomeStatement: IncomeStatementInfo;
    balanceSheet: BalanceSheetInfo;
    treasury: TreasuryStatementInfo;
  };
}

export interface IncomeStatementInfo extends StatementBaseInfo {
  sections: ComparedGroupInfo[];
  intermediate: { code: string; label: string; amount: string; previous: string | null }[];
  products: string;
  charges: string;
  result: string;
  previousResult: string | null;
  defaulted: { number: string; label: string }[];
  unclassified: { number: string; label: string; amount: string }[];
}

export interface BalanceSheetInfo extends StatementBaseInfo {
  assets: ComparedGroupInfo[];
  liabilities: ComparedGroupInfo[];
  totalAssets: string;
  totalLiabilities: string;
  previousTotalAssets: string | null;
  previousTotalLiabilities: string | null;
  difference: string;
  balanced: boolean;
  result: string;
  unclassified: { number: string; label: string; amount: string }[];
}

export interface TreasuryFiguresInfo {
  opening: string;
  receipts: string;
  payments: string;
  closing: string;
}

export interface TreasuryRowInfo extends TreasuryFiguresInfo {
  number: string;
  label: string;
  financialAccountName: string | null;
  previous: TreasuryFiguresInfo | null;
}

export interface TreasuryStatementInfo extends StatementBaseInfo {
  rows: TreasuryRowInfo[];
  totals: TreasuryFiguresInfo;
  previousTotals: TreasuryFiguresInfo | null;
}

export type ProgressAnomalyLevel = 'TODO' | 'BLOCKING' | 'WARNING' | 'INFO';
export type ProgressAnomalyFix = 'TRANSACTIONS' | 'RECOVERY' | 'ENTRY' | 'RECONCILIATION' | 'DOCUMENTS' | 'THIRD_PARTIES';

export interface ProgressAnomaly {
  code: string;
  level: ProgressAnomalyLevel;
  financialAccountId: string | null;
  financialAccountName: string | null;
  count: number;
  message: string;
  fix: ProgressAnomalyFix;
  details?: { entryId: string; date: string; label: string; messages: string[] }[];
}

export interface ProgressAccount {
  financialAccountId: string;
  name: string;
  total: number;
  qualified: number;
  drafted: number;
  posted: number;
  reconciled: number;
  percent: number | null;
  opening: { state: 'NOT_NEEDED' | 'TO_PREPARE' | 'DRAFT' | 'POSTED' | 'REVERSED'; amount: string } | null;
  statementUntil: string | null;
  reconciledUntil: string | null;
  blockedDrafts: number;
}

export interface ProgressYear {
  fiscalYear: { id: string; label: string; start: string; end: string; status: 'OPEN' | 'CLOSING' | 'CLOSED' };
  accounts: ProgressAccount[];
  totals: { total: number; qualified: number; drafted: number; posted: number; reconciled: number; percent: number | null };
  documents: { postedEntries: number; withoutDocument: number };
  anomalies: ProgressAnomaly[];
  complete: boolean;
  draftAnalysisLimited: boolean;
}

export interface RecoveryProgressInfo {
  generatedAt: string;
  years: ProgressYear[];
}

export interface RecoveryBatchInfo {
  id: string;
  name: string;
  note: string | null;
  status: 'OPEN' | 'COMPLETED' | 'ABANDONED';
  createdAt: string;
  closedAt: string | null;
  abandonedAt: string | null;
  drafts: number;
  posted: number;
  total: number;
}

export interface RecoveryItemInfo {
  entryId: string;
  kind: 'OPENING' | 'TRANSACTION';
  financialAccountId: string;
  financialAccountName: string;
  date: string;
  label: string;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  journalCode: string;
  number: number | null;
  amount: string;
}

export type SkipReasonInfo = 'NOT_QUALIFIED' | 'ALREADY_LINKED' | 'TRANSFER' | 'NO_FISCAL_YEAR' | 'YEAR_NOT_OPEN' | 'REFUSED';

export interface PrepareReportInfo {
  created: number;
  skipped: { transactionId: string; date: string; label: string; amount: string; reason: SkipReasonInfo; message: string }[];
  skippedByReason: Partial<Record<SkipReasonInfo, number>>;
}

export interface PostReportInfo {
  posted: number;
  failed: { entryId: string; date: string; label: string; messages: string[] }[];
  remainingDrafts: number;
  completed: boolean;
}

export interface EntryCandidateInfo {
  id: string;
  date: string;
  label: string;
  status: 'DRAFT' | 'POSTED';
  journalCode: string;
  number: number | null;
}

export interface TransferBody {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  date: string;
  label?: string;
  prepareEntry: boolean;
}

export interface TransferInfo {
  id: string;
  out: TransactionInfo;
  in: TransactionInfo;
  entryId: string | null;
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
  /** Document qui conserve le fichier OFX d'origine (restreint), s'il existe. */
  documentId?: string | null;
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
  accounting?: 'NONE' | 'IN_PROGRESS' | 'POSTED';
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

export type BudgetStatus = 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
export type BudgetLineKind = 'CHARGE' | 'PRODUCT';

export interface BudgetLineInfo {
  id: string;
  kind: BudgetLineKind;
  label: string;
  accountId: string | null;
  periodStart: string;
  periodEnd: string;
  amount: string;
}

export interface BudgetSummaryInfo {
  id: string;
  projectId: string;
  number: number;
  label: string;
  status: BudgetStatus;
  approvedAt: string | null;
  createdAt: string;
  lineCount: number;
  charges: string;
  products: string;
  result: string;
}

export interface BudgetInfo extends BudgetSummaryInfo {
  lines: BudgetLineInfo[];
}

export type BudgetLineBody = Omit<BudgetLineInfo, 'id'>;

export interface ParticipantInfo {
  id: string;
  projectId: string;
  memberId: string | null;
  userId: string | null;
  name: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  note: string;
}

export type CommitmentState = 'OPEN' | 'SETTLED' | 'REOPENED' | 'CANCELLED';

export interface CommitmentInfo {
  id: string;
  projectId: string;
  label: string;
  amount: string;
  committedOn: string;
  accountId: string | null;
  accountNumber: string | null;
  accountLabel: string | null;
  note: string;
  state: CommitmentState;
  engaged: boolean;
  settledEntry: { id: string; number: number | null; date: string; label: string; journalCode: string; status: EntryStatus } | null;
  cancelReason: string | null;
}

export interface EntryCandidateInfo {
  id: string;
  number: number | null;
  date: string;
  label: string;
  journalCode: string;
  projectAmount: string;
}

export interface BudgetReportRowInfo {
  key: string;
  label: string;
  accountNumber: string | null;
  budget: string | null;
  engaged: string | null;
  actual: string | null;
  remaining: string | null;
  outOfBudget: boolean;
  note: string | null;
}

export interface BudgetReportSectionInfo {
  rows: BudgetReportRowInfo[];
  total: { budget: string | null; engaged: string | null; actual: string; remaining: string | null };
}

export interface BudgetReportInfo {
  project: { id: string; code: string; name: string };
  scope: { kind: 'GLOBAL' | 'YEAR'; fiscalYear: { id: string; label: string; start: string; end: string } | null };
  fiscalYears: { id: string; label: string; start: string; end: string }[];
  budget: { id: string; number: number; label: string; approvedAt: string | null } | null;
  formula: string;
  charges: BudgetReportSectionInfo;
  products: BudgetReportSectionInfo;
  warnings: string[];
}

export type FunderType = 'LOCAL_AUTHORITY' | 'STATE' | 'FOUNDATION' | 'COMPANY' | 'OTHER';

export interface FunderInfo {
  id: string;
  name: string;
  type: FunderType;
  contactName: string;
  email: string;
  phone: string;
  note: string;
  archived: boolean;
  grantCount: number;
}

export type GrantStatus = 'REQUESTED' | 'UNDER_REVIEW' | 'GRANTED' | 'REFUSED' | 'CLOSED' | 'CANCELLED';
export type GrantResidual = 'REFUND' | 'KEPT_WITH_AGREEMENT' | 'NONE';

export interface GrantAllocationInfo {
  projectId: string;
  projectCode: string;
  projectName: string;
  amount: string;
}

export interface GrantInfo {
  id: string;
  funder: { id: string; name: string; type: FunderType; archived: boolean };
  reference: string | null;
  title: string;
  status: GrantStatus;
  requestedAmount: string;
  grantedAmount: string | null;
  requestedOn: string | null;
  decidedOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  conditions: string;
  note: string;
  reason: string | null;
  closedOn: string | null;
  residual: GrantResidual | null;
  residualNote: string | null;
  allocations: GrantAllocationInfo[];
  allocatedTotal: string;
  /** Somme des versements reçus. */
  received: string;
}

export type ScheduleState = 'PENDING' | 'PARTIAL' | 'RECEIVED';

export interface GrantScheduleInfo {
  id: string;
  dueOn: string;
  amount: string;
  condition: string;
  received: string;
  state: ScheduleState;
  overdue: boolean;
}

export interface GrantPaymentInfo {
  id: string;
  transactionId: string;
  operationDate: string;
  amount: string;
  scheduleId: string | null;
  note: string | null;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface GrantFinanceInfo {
  grantId: string;
  granted: string | null;
  planned: string;
  received: string;
  remaining: string | null;
  unplanned: string | null;
  overReceived: boolean;
  /** Dépenses affectées à la subvention (comptabilisées, non annulées). */
  spent: string;
  /** Reçu − dépenses affectées : ce qui n'a pas été dépensé. */
  residual: string;
  schedule: GrantScheduleInfo[];
  payments: GrantPaymentInfo[];
}

export interface GrantExpenseInfo {
  id: string;
  amount: string;
  coFinancingReason: string | null;
  cancelled: boolean;
  cancelReason: string | null;
  counted: boolean;
  reversed: boolean;
  outOfPeriod: boolean;
  entry: { id: string; number: number | null; journalCode: string; date: string; label: string | null };
  account: { number: string; label: string };
  project: { id: string; code: string; name: string };
  expenseAmount: string;
}

export interface GrantExpensesInfo {
  grantId: string;
  granted: string | null;
  spent: string;
  overGranted: boolean;
  overBy: string | null;
  expenses: GrantExpenseInfo[];
  warnings: string[];
}

export interface ExpenseCandidateInfo {
  allocationId: string;
  entry: { id: string; number: number | null; journalCode: string; date: string; label: string };
  account: { number: string; label: string };
  project: { id: string; code: string; name: string };
  amount: string;
  remaining: string;
  outOfPeriod: boolean;
}

export interface GrantReportInfo {
  grant: { id: string; title: string; funder: string; reference: string | null; periodStart: string | null; periodEnd: string | null };
  period: { from: string | null; to: string | null };
  granted: string | null;
  groups: { accountNumber: string; accountLabel: string; count: number; amount: string }[];
  spent: string;
  payments: { operationDate: string; amount: string }[];
  received: string;
  residual: string;
  overGranted: boolean;
  coFinancingReasons: string[];
  warnings: string[];
}

export interface PaymentCandidateInfo {
  id: string;
  operationDate: string;
  label: string;
  accountName: string;
  amount: string;
  remaining: string;
  /** Le mouvement n'est pas encore dans les comptes : on peut l'y enregistrer d'un même geste. */
  canBook?: boolean;
}

export interface GrantBody {
  funderId?: string;
  title?: string;
  reference?: string | null;
  requestedAmount?: string;
  requestedOn?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  conditions?: string;
  note?: string;
}

export interface AllocationBody {
  projectId: string;
  amount: string;
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
  /** Tiers concerné (adhérent, financeur, fournisseur…), nom lu en direct. */
  thirdParty?: { id: string; name: string; kind: ThirdPartyKindInfo } | null;
  allocations: AllocationInfo[];
}

export type ThirdPartyKindInfo = 'MEMBER' | 'FUNDER' | 'SUPPLIER' | 'OTHER';

export interface ThirdPartyInfo {
  id: string;
  kind: ThirdPartyKindInfo;
  name: string;
  memberId: string | null;
  funderId: string | null;
  note: string;
  archived: boolean;
}

export interface ThirdPartyBalanceRowInfo {
  id: string;
  name: string;
  kind: ThirdPartyKindInfo;
  net: string;
  owedToYou: string;
  youOwe: string;
  accounts: { number: string; label: string; net: string }[];
}

export interface ThirdPartyBalancesInfo {
  fiscalYear: { id: string; label: string; start: string; end: string; status: 'OPEN' | 'CLOSING' | 'CLOSED' };
  rows: ThirdPartyBalanceRowInfo[];
  totals: { owedToYou: string; youOwe: string };
  untracked: { lines: number; net: string };
  carryWarning: string | null;
}

export type ThirdPartyBody =
  | { kind: 'MEMBER'; memberId: string }
  | { kind: 'FUNDER'; funderId: string }
  | { kind: 'SUPPLIER' | 'OTHER'; name: string; note?: string };

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
  lines: { accountId: string; debit: string; credit: string; label?: string | null; thirdPartyId?: string | null; allocations?: AllocationInfo[] }[];
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
  offsite: {
    report: { health: 'OK' | 'FAILING' | 'STALE' | 'PENDING' | 'NONE'; message: string; ageHours: number | null };
    status: { lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; target: string } | null;
  };
}

export interface ReleaseNotesInfo {
  version: string;
  available: boolean;
  releases: { heading: string; current: boolean; groups: { title: string | null; items: string[] }[] }[];
}

/** Appels de l'API d'administration (utilisateurs, rôles, attributions). Le serveur applique les droits. */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);

  listUsers(): Promise<ManagedUser[]> {
    return firstValueFrom(this.http.get<ManagedUser[]>('/api/users'));
  }

  createUser(input: { email: string; displayName: string; roleIds: string[] }): Promise<{ user: ManagedUser; invitation: PasswordLink; mail?: MailOutcome }> {
    return firstValueFrom(this.http.post<{ user: ManagedUser; invitation: PasswordLink; mail?: MailOutcome }>('/api/users', input));
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

  assignRole(userId: string, roleId: string, projectId?: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/users/${userId}/assignments`, { roleId, ...(projectId && { projectId }) }));
  }

  userAccess(userId: string): Promise<UserAccess> {
    return firstValueFrom(this.http.get<UserAccess>(`/api/users/${userId}/access`));
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

  /** Ajoute ou remplace le logo de l'association (PNG, JPEG ou SVG) ; renvoie son empreinte. */
  uploadLogo(file: File): Promise<{ logoHash: string }> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(this.http.put<{ logoHash: string }>('/api/branding/logo', form));
  }

  /** Affiche le logo seul (faux) ou avec le nom de l'association (vrai). */
  setLogoDisplay(showName: boolean): Promise<void> {
    return firstValueFrom(this.http.put<void>('/api/branding/logo/display', { showName }));
  }

  removeLogo(): Promise<void> {
    return firstValueFrom(this.http.delete<void>('/api/branding/logo'));
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
    if (filters.objectType) params = params.set('objectType', filters.objectType);
    if (filters.objectId) params = params.set('objectId', filters.objectId);
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
  ): Promise<{ openingEntryId: string; frozen?: FrozenOutcomeInfo }> {
    return firstValueFrom(this.http.post<{ openingEntryId: string; frozen?: FrozenOutcomeInfo }>(`/api/fiscal-years/${id}/closing/close`, body));
  }

  listFrozenReports(fiscalYearId: string): Promise<FrozenReportSummaryInfo[]> {
    return firstValueFrom(this.http.get<FrozenReportSummaryInfo[]>(`/api/fiscal-years/${fiscalYearId}/frozen-reports`));
  }

  freezeReports(fiscalYearId: string, body: { label?: string; reason?: string }): Promise<FrozenReportSummaryInfo> {
    return firstValueFrom(this.http.post<FrozenReportSummaryInfo>(`/api/fiscal-years/${fiscalYearId}/frozen-reports`, body));
  }

  getFrozenReport(id: string): Promise<FrozenReportDetailInfo> {
    return firstValueFrom(this.http.get<FrozenReportDetailInfo>(`/api/frozen-reports/${id}`));
  }

  approveFrozenReport(id: string, body: { meetingDate: string; note?: string }): Promise<FrozenReportSummaryInfo> {
    return firstValueFrom(this.http.post<FrozenReportSummaryInfo>(`/api/frozen-reports/${id}/approve`, body));
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

  listMembers(filters: MemberFilters = {}): Promise<{ members: MemberInfo[]; next: string | null; campaign?: { id: string; name: string } | null }> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) if (value) params = params.set(key, value);
    return firstValueFrom(this.http.get<{ members: MemberInfo[]; next: string | null; campaign?: { id: string; name: string } | null }>('/api/members', { params }));
  }

  getMember(id: string): Promise<{ member: MemberInfo; offices: MemberOfficeInfo[] }> {
    return firstValueFrom(this.http.get<{ member: MemberInfo; offices: MemberOfficeInfo[] }>(`/api/members/${id}`));
  }

  createMember(body: MemberBody): Promise<MemberInfo> {
    return firstValueFrom(this.http.post<MemberInfo>('/api/members', body));
  }

  updateMember(id: string, body: Partial<MemberBody> & { version: number; status?: 'ACTIVE' | 'FORMER'; leftOn?: string | null }): Promise<MemberInfo> {
    return firstValueFrom(this.http.patch<MemberInfo>(`/api/members/${id}`, body));
  }

  anonymizeMember(id: string, reason: string): Promise<MemberInfo> {
    return firstValueFrom(this.http.post<MemberInfo>(`/api/members/${id}/anonymize`, { reason }));
  }

  listMemberCategories(): Promise<MemberCategoryInfo[]> {
    return firstValueFrom(this.http.get<MemberCategoryInfo[]>('/api/member-categories'));
  }

  createMemberCategory(name: string): Promise<MemberCategoryInfo> {
    return firstValueFrom(this.http.post<MemberCategoryInfo>('/api/member-categories', { name }));
  }

  updateMemberCategory(id: string, body: { name?: string; active?: boolean }): Promise<MemberCategoryInfo> {
    return firstValueFrom(this.http.patch<MemberCategoryInfo>(`/api/member-categories/${id}`, body));
  }

  addMemberOffice(memberId: string, body: { title: string; startsOn: string; endsOn?: string | null; note?: string | null }): Promise<MemberOfficeInfo> {
    return firstValueFrom(this.http.post<MemberOfficeInfo>(`/api/members/${memberId}/offices`, body));
  }

  updateMemberOffice(id: string, body: { title?: string; startsOn?: string; endsOn?: string | null; note?: string | null }): Promise<MemberOfficeInfo> {
    return firstValueFrom(this.http.patch<MemberOfficeInfo>(`/api/member-offices/${id}`, body));
  }

  removeMemberOffice(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/member-offices/${id}`));
  }

  listCampaigns(): Promise<CampaignInfo[]> {
    return firstValueFrom(this.http.get<CampaignInfo[]>('/api/campaigns'));
  }

  createCampaign(body: { name: string; startsOn: string; endsOn: string; effectiveMode?: MembershipModeInfo }): Promise<CampaignInfo> {
    return firstValueFrom(this.http.post<CampaignInfo>('/api/campaigns', body));
  }

  updateCampaign(id: string, body: { name?: string; startsOn?: string; endsOn?: string; effectiveMode?: MembershipModeInfo }): Promise<CampaignInfo> {
    return firstValueFrom(this.http.patch<CampaignInfo>(`/api/campaigns/${id}`, body));
  }

  addTariff(campaignId: string, body: { label: string; amount: string; categoryId?: string | null }): Promise<CampaignInfo> {
    return firstValueFrom(this.http.post<CampaignInfo>(`/api/campaigns/${campaignId}/tariffs`, body));
  }

  updateTariff(id: string, body: { label?: string; amount?: string }): Promise<CampaignInfo> {
    return firstValueFrom(this.http.patch<CampaignInfo>(`/api/tariffs/${id}`, body));
  }

  removeTariff(id: string): Promise<CampaignInfo> {
    return firstValueFrom(this.http.delete<CampaignInfo>(`/api/tariffs/${id}`));
  }

  /** Prépare la saison suivante : mêmes réglages et tarifs, nouvelles dates, aucune adhésion. */
  renewCampaign(campaignId: string, body: { name: string; startsOn: string; endsOn: string }): Promise<CampaignInfo> {
    return firstValueFrom(this.http.post<CampaignInfo>(`/api/campaigns/${campaignId}/renew`, body));
  }

  /** Membres à renouveler dans une saison, avec un tarif proposé (lecture seule). */
  renewalPreview(campaignId: string): Promise<RenewalPreviewInfo> {
    return firstValueFrom(this.http.get<RenewalPreviewInfo>(`/api/campaigns/${campaignId}/renewal-preview`));
  }

  /** Inscrit plusieurs membres d'un coup (tout ou rien) ; les déjà inscrits sont ignorés avec leur raison. */
  enrollMany(campaignId: string, items: { memberId: string; tariffId: string }[]): Promise<BulkEnrollInfo> {
    return firstValueFrom(this.http.post<BulkEnrollInfo>(`/api/campaigns/${campaignId}/memberships/bulk`, { items }));
  }

  listMemberships(campaignId: string): Promise<MembershipInfo[]> {
    return firstValueFrom(this.http.get<MembershipInfo[]>(`/api/campaigns/${campaignId}/memberships`));
  }

  /** Cotisations d'un membre, toutes saisons (celles qui restent à payer ont un `balance` positif). */
  listMemberMemberships(memberId: string): Promise<MembershipInfo[]> {
    return firstValueFrom(this.http.get<MembershipInfo[]>(`/api/members/${memberId}/memberships`));
  }

  createMembership(
    campaignId: string,
    body: { memberId: string; tariffId: string; expectedAmount?: string; exemptionReason?: string; effectiveOn?: string },
  ): Promise<MembershipInfo> {
    return firstValueFrom(this.http.post<MembershipInfo>(`/api/campaigns/${campaignId}/memberships`, body));
  }

  listAllocations(membershipId: string): Promise<PaymentAllocationInfo[]> {
    return firstValueFrom(this.http.get<PaymentAllocationInfo[]>(`/api/memberships/${membershipId}/allocations`));
  }

  paymentCandidates(membershipId: string, kind: 'PAYMENT' | 'REFUND'): Promise<PaymentCandidateInfo[]> {
    return firstValueFrom(this.http.get<PaymentCandidateInfo[]>(`/api/memberships/${membershipId}/payment-candidates`, { params: { kind } }));
  }

  allocatePayment(
    membershipId: string,
    body: { transactionId: string; amount: string; kind: 'PAYMENT' | 'REFUND'; note?: string },
  ): Promise<{ allocation: PaymentAllocationInfo; membership: MembershipInfo }> {
    return firstValueFrom(this.http.post<{ allocation: PaymentAllocationInfo; membership: MembershipInfo }>(`/api/memberships/${membershipId}/allocations`, body));
  }

  cancelAllocation(id: string, reason: string): Promise<MembershipInfo> {
    return firstValueFrom(this.http.post<MembershipInfo>(`/api/allocations/${id}/cancel`, { reason }));
  }

  reminders(campaignId: string): Promise<ReminderInfo> {
    return firstValueFrom(this.http.get<ReminderInfo>(`/api/campaigns/${campaignId}/reminders`));
  }

  receipt(membershipId: string): Promise<ReceiptInfo> {
    return firstValueFrom(this.http.get<ReceiptInfo>(`/api/memberships/${membershipId}/receipt`));
  }

  validateMembership(id: string): Promise<MembershipInfo> {
    return firstValueFrom(this.http.post<MembershipInfo>(`/api/memberships/${id}/validate`, {}));
  }

  cancelMembership(id: string, reason: string): Promise<MembershipInfo> {
    return firstValueFrom(this.http.post<MembershipInfo>(`/api/memberships/${id}/cancel`, { reason }));
  }

  incomeStatement(fiscalYearId: string): Promise<IncomeStatementInfo> {
    return firstValueFrom(this.http.get<IncomeStatementInfo>('/api/reports/income-statement', { params: { fiscalYearId } }));
  }

  treasuryStatement(fiscalYearId: string): Promise<TreasuryStatementInfo> {
    return firstValueFrom(this.http.get<TreasuryStatementInfo>('/api/reports/treasury', { params: { fiscalYearId } }));
  }

  balanceSheet(fiscalYearId: string): Promise<BalanceSheetInfo> {
    return firstValueFrom(this.http.get<BalanceSheetInfo>('/api/reports/balance-sheet', { params: { fiscalYearId } }));
  }

  recoveryProgress(): Promise<RecoveryProgressInfo> {
    return firstValueFrom(this.http.get<RecoveryProgressInfo>('/api/recovery-progress'));
  }

  listRecoveryBatches(): Promise<RecoveryBatchInfo[]> {
    return firstValueFrom(this.http.get<RecoveryBatchInfo[]>('/api/recovery-batches'));
  }

  getRecoveryBatch(id: string): Promise<{ batch: RecoveryBatchInfo; items: RecoveryItemInfo[] }> {
    return firstValueFrom(this.http.get<{ batch: RecoveryBatchInfo; items: RecoveryItemInfo[] }>(`/api/recovery-batches/${id}`));
  }

  createRecoveryBatch(body: { name: string; note?: string }): Promise<RecoveryBatchInfo> {
    return firstValueFrom(this.http.post<RecoveryBatchInfo>('/api/recovery-batches', body));
  }

  prepareRecoveryEntries(id: string, body: { financialAccountId: string; from?: string; to?: string }): Promise<PrepareReportInfo> {
    return firstValueFrom(this.http.post<PrepareReportInfo>(`/api/recovery-batches/${id}/prepare-entries`, body));
  }

  prepareRecoveryOpening(id: string, body: { financialAccountId: string; counterpartAccountId: string; explanation: string }): Promise<RecoveryItemInfo> {
    return firstValueFrom(this.http.post<RecoveryItemInfo>(`/api/recovery-batches/${id}/opening`, body));
  }

  postRecoveryBatch(id: string): Promise<PostReportInfo> {
    return firstValueFrom(this.http.post<PostReportInfo>(`/api/recovery-batches/${id}/post`, {}));
  }

  abandonRecoveryBatch(id: string): Promise<{ deleted: number; kept: number }> {
    return firstValueFrom(this.http.post<{ deleted: number; kept: number }>(`/api/recovery-batches/${id}/abandon`, {}));
  }

  qualifyTransactions(accountId: string, body: { transactionIds: string[]; counterpartAccountId?: string; projectId?: string }): Promise<{ updated: number }> {
    return firstValueFrom(this.http.post<{ updated: number }>(`/api/financial-accounts/${accountId}/transactions/qualify`, body));
  }

  /** Le serveur recalcule les propositions : on n'envoie que les identifiants des mouvements à classer. */
  acceptSuggestions(accountId: string, transactionIds: string[]): Promise<{ updated: number }> {
    return firstValueFrom(this.http.post<{ updated: number }>(`/api/financial-accounts/${accountId}/transactions/accept-suggestions`, { transactionIds }));
  }

  listStatements(accountId: string): Promise<StatementInfo[]> {
    return firstValueFrom(this.http.get<StatementInfo[]>(`/api/financial-accounts/${accountId}/statements`));
  }

  listReconciliations(accountId: string): Promise<ReconciliationInfo[]> {
    return firstValueFrom(this.http.get<ReconciliationInfo[]>(`/api/financial-accounts/${accountId}/reconciliations`));
  }

  startReconciliation(accountId: string, statementId: string): Promise<ReconciliationInfo> {
    return firstValueFrom(this.http.post<ReconciliationInfo>(`/api/financial-accounts/${accountId}/reconciliations`, { statementId }));
  }

  reconciliationTransactions(id: string): Promise<PointableTransactionInfo[]> {
    return firstValueFrom(this.http.get<PointableTransactionInfo[]>(`/api/reconciliations/${id}/transactions`));
  }

  pointTransactions(id: string, transactionIds: string[]): Promise<ReconciliationInfo> {
    return firstValueFrom(this.http.post<ReconciliationInfo>(`/api/reconciliations/${id}/point`, { transactionIds }));
  }

  unpointTransactions(id: string, transactionIds: string[]): Promise<ReconciliationInfo> {
    return firstValueFrom(this.http.post<ReconciliationInfo>(`/api/reconciliations/${id}/unpoint`, { transactionIds }));
  }

  pointImportedTransactions(id: string): Promise<ReconciliationInfo> {
    return firstValueFrom(this.http.post<ReconciliationInfo>(`/api/reconciliations/${id}/point-imported`, {}));
  }

  validateReconciliation(id: string): Promise<ReconciliationInfo> {
    return firstValueFrom(this.http.post<ReconciliationInfo>(`/api/reconciliations/${id}/validate`, {}));
  }

  cancelReconciliation(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/reconciliations/${id}/cancel`, {}));
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

  prepareTransactionEntry(id: string): Promise<{ transaction: TransactionInfo; entryId: string }> {
    return firstValueFrom(this.http.post<{ transaction: TransactionInfo; entryId: string }>(`/api/transactions/${id}/entry`, {}));
  }

  entryCandidates(id: string): Promise<EntryCandidateInfo[]> {
    return firstValueFrom(this.http.get<EntryCandidateInfo[]>(`/api/transactions/${id}/entry-candidates`));
  }

  linkTransactionEntry(id: string, entryId: string): Promise<TransactionInfo> {
    return firstValueFrom(this.http.post<TransactionInfo>(`/api/transactions/${id}/link`, { entryId }));
  }

  unlinkTransactionEntry(id: string): Promise<TransactionInfo> {
    return firstValueFrom(this.http.delete<TransactionInfo>(`/api/transactions/${id}/link`));
  }

  createTransfer(body: TransferBody): Promise<TransferInfo> {
    return firstValueFrom(this.http.post<TransferInfo>('/api/transfers', body));
  }

  cancelTransfer(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/transfers/${id}`));
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

  listFunders(): Promise<FunderInfo[]> {
    return firstValueFrom(this.http.get<FunderInfo[]>('/api/funders'));
  }

  createFunder(body: Partial<Omit<FunderInfo, 'id' | 'archived' | 'grantCount'>> & { name: string; type: FunderType }): Promise<FunderInfo> {
    return firstValueFrom(this.http.post<FunderInfo>('/api/funders', body));
  }

  updateFunder(id: string, body: Partial<Omit<FunderInfo, 'id' | 'archived' | 'grantCount'>>): Promise<FunderInfo> {
    return firstValueFrom(this.http.patch<FunderInfo>(`/api/funders/${id}`, body));
  }

  archiveFunder(id: string): Promise<FunderInfo> {
    return firstValueFrom(this.http.post<FunderInfo>(`/api/funders/${id}/archive`, {}));
  }

  listGrants(filters: { status?: GrantStatus; funderId?: string; projectId?: string } = {}): Promise<GrantInfo[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) if (value) params = params.set(key, value);
    return firstValueFrom(this.http.get<GrantInfo[]>('/api/grants', { params }));
  }

  listProjectGrants(projectId: string): Promise<GrantInfo[]> {
    return firstValueFrom(this.http.get<GrantInfo[]>(`/api/projects/${projectId}/grants`));
  }

  getGrant(id: string): Promise<GrantInfo> {
    return firstValueFrom(this.http.get<GrantInfo>(`/api/grants/${id}`));
  }

  createGrant(body: GrantBody & { funderId: string; title: string; requestedAmount: string; allocations?: AllocationBody[] }): Promise<GrantInfo> {
    return firstValueFrom(this.http.post<GrantInfo>('/api/grants', body));
  }

  updateGrant(id: string, body: GrantBody): Promise<GrantInfo> {
    return firstValueFrom(this.http.patch<GrantInfo>(`/api/grants/${id}`, body));
  }

  setGrantAllocations(id: string, allocations: AllocationBody[]): Promise<GrantInfo> {
    return firstValueFrom(this.http.put<GrantInfo>(`/api/grants/${id}/allocations`, { allocations }));
  }

  reviewGrant(id: string): Promise<GrantInfo> {
    return firstValueFrom(this.http.post<GrantInfo>(`/api/grants/${id}/review`, {}));
  }

  decideGrant(id: string, body: { grantedAmount: string; decidedOn: string; allocations?: AllocationBody[] }): Promise<GrantInfo> {
    return firstValueFrom(this.http.post<GrantInfo>(`/api/grants/${id}/grant`, body));
  }

  refuseGrant(id: string, body: { decidedOn: string; reason: string }): Promise<GrantInfo> {
    return firstValueFrom(this.http.post<GrantInfo>(`/api/grants/${id}/refuse`, body));
  }

  cancelGrant(id: string, reason: string): Promise<GrantInfo> {
    return firstValueFrom(this.http.post<GrantInfo>(`/api/grants/${id}/cancel`, { reason }));
  }

  closeGrant(id: string, body: { closedOn: string; residual: GrantResidual; note: string }): Promise<GrantInfo> {
    return firstValueFrom(this.http.post<GrantInfo>(`/api/grants/${id}/close`, body));
  }

  grantFinance(id: string): Promise<GrantFinanceInfo> {
    return firstValueFrom(this.http.get<GrantFinanceInfo>(`/api/grants/${id}/finance`));
  }

  addGrantSchedule(grantId: string, body: { dueOn: string; amount: string; condition?: string }): Promise<GrantFinanceInfo> {
    return firstValueFrom(this.http.post<GrantFinanceInfo>(`/api/grants/${grantId}/schedule`, body));
  }

  updateGrantSchedule(id: string, body: { dueOn?: string; amount?: string; condition?: string }): Promise<GrantFinanceInfo> {
    return firstValueFrom(this.http.patch<GrantFinanceInfo>(`/api/grant-schedule/${id}`, body));
  }

  removeGrantSchedule(id: string): Promise<GrantFinanceInfo> {
    return firstValueFrom(this.http.delete<GrantFinanceInfo>(`/api/grant-schedule/${id}`));
  }

  recordGrantPayment(
    grantId: string,
    body: { transactionId: string; amount: string; scheduleId?: string | null; note?: string | null },
  ): Promise<GrantFinanceInfo> {
    return firstValueFrom(this.http.post<GrantFinanceInfo>(`/api/grants/${grantId}/payments`, body));
  }

  cancelGrantPayment(id: string, reason: string): Promise<GrantFinanceInfo> {
    return firstValueFrom(this.http.post<GrantFinanceInfo>(`/api/grant-payments/${id}/cancel`, { reason }));
  }

  grantPaymentCandidates(grantId: string): Promise<PaymentCandidateInfo[]> {
    return firstValueFrom(this.http.get<PaymentCandidateInfo[]>(`/api/grants/${grantId}/payment-candidates`));
  }

  grantExpenses(grantId: string): Promise<GrantExpensesInfo> {
    return firstValueFrom(this.http.get<GrantExpensesInfo>(`/api/grants/${grantId}/expenses`));
  }

  attachGrantExpense(grantId: string, body: { allocationId: string; amount: string; coFinancingReason?: string | null }): Promise<GrantExpensesInfo> {
    return firstValueFrom(this.http.post<GrantExpensesInfo>(`/api/grants/${grantId}/expenses`, body));
  }

  cancelGrantExpense(id: string, reason: string): Promise<GrantExpensesInfo> {
    return firstValueFrom(this.http.post<GrantExpensesInfo>(`/api/grant-expenses/${id}/cancel`, { reason }));
  }

  grantExpenseCandidates(grantId: string): Promise<ExpenseCandidateInfo[]> {
    return firstValueFrom(this.http.get<ExpenseCandidateInfo[]>(`/api/grants/${grantId}/expense-candidates`));
  }

  grantReport(grantId: string, period: { from?: string; to?: string } = {}): Promise<GrantReportInfo> {
    let params = new HttpParams();
    if (period.from) params = params.set('from', period.from);
    if (period.to) params = params.set('to', period.to);
    return firstValueFrom(this.http.get<GrantReportInfo>(`/api/grants/${grantId}/report`, { params }));
  }

  listBudgets(projectId: string): Promise<BudgetSummaryInfo[]> {
    return firstValueFrom(this.http.get<BudgetSummaryInfo[]>(`/api/projects/${projectId}/budgets`));
  }

  getBudget(id: string): Promise<BudgetInfo> {
    return firstValueFrom(this.http.get<BudgetInfo>(`/api/budgets/${id}`));
  }

  createBudget(projectId: string, body: { label: string; fromBudgetId?: string }): Promise<BudgetInfo> {
    return firstValueFrom(this.http.post<BudgetInfo>(`/api/projects/${projectId}/budgets`, body));
  }

  updateBudget(id: string, body: { label?: string; lines?: BudgetLineBody[] }): Promise<BudgetInfo> {
    return firstValueFrom(this.http.put<BudgetInfo>(`/api/budgets/${id}`, body));
  }

  approveBudget(id: string): Promise<BudgetInfo> {
    return firstValueFrom(this.http.post<BudgetInfo>(`/api/budgets/${id}/approve`, {}));
  }

  deleteBudget(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/budgets/${id}`));
  }

  listCommitments(projectId: string): Promise<CommitmentInfo[]> {
    return firstValueFrom(this.http.get<CommitmentInfo[]>(`/api/projects/${projectId}/commitments`));
  }

  createCommitment(
    projectId: string,
    body: { label: string; amount: string; committedOn: string; accountId?: string | null; note?: string },
  ): Promise<CommitmentInfo> {
    return firstValueFrom(this.http.post<CommitmentInfo>(`/api/projects/${projectId}/commitments`, body));
  }

  updateCommitment(
    id: string,
    body: { label?: string; amount?: string; committedOn?: string; accountId?: string | null; note?: string },
  ): Promise<CommitmentInfo> {
    return firstValueFrom(this.http.patch<CommitmentInfo>(`/api/commitments/${id}`, body));
  }

  settleCommitment(id: string, entryId: string): Promise<CommitmentInfo> {
    return firstValueFrom(this.http.post<CommitmentInfo>(`/api/commitments/${id}/settle`, { entryId }));
  }

  cancelCommitment(id: string, reason: string): Promise<CommitmentInfo> {
    return firstValueFrom(this.http.post<CommitmentInfo>(`/api/commitments/${id}/cancel`, { reason }));
  }

  commitmentCandidates(id: string): Promise<EntryCandidateInfo[]> {
    return firstValueFrom(this.http.get<EntryCandidateInfo[]>(`/api/commitments/${id}/entry-candidates`));
  }

  budgetReport(projectId: string, fiscalYearId?: string): Promise<BudgetReportInfo> {
    let params = new HttpParams();
    if (fiscalYearId) params = params.set('fiscalYearId', fiscalYearId);
    return firstValueFrom(this.http.get<BudgetReportInfo>(`/api/projects/${projectId}/budget-report`, { params }));
  }

  listParticipants(projectId: string): Promise<ParticipantInfo[]> {
    return firstValueFrom(this.http.get<ParticipantInfo[]>(`/api/projects/${projectId}/participants`));
  }

  addParticipant(
    projectId: string,
    body: { memberId?: string; userId?: string; role: string; startDate?: string | null; endDate?: string | null; note?: string },
  ): Promise<ParticipantInfo> {
    return firstValueFrom(this.http.post<ParticipantInfo>(`/api/projects/${projectId}/participants`, body));
  }

  updateParticipant(
    id: string,
    body: { role?: string; startDate?: string | null; endDate?: string | null; note?: string },
  ): Promise<ParticipantInfo> {
    return firstValueFrom(this.http.patch<ParticipantInfo>(`/api/project-participants/${id}`, body));
  }

  removeParticipant(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/project-participants/${id}`));
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

  listThirdParties(includeArchived = false): Promise<ThirdPartyInfo[]> {
    return firstValueFrom(this.http.get<ThirdPartyInfo[]>('/api/third-parties', { params: includeArchived ? { includeArchived: 'true' } : {} }));
  }

  createThirdParty(body: ThirdPartyBody): Promise<ThirdPartyInfo> {
    return firstValueFrom(this.http.post<ThirdPartyInfo>('/api/third-parties', body));
  }

  updateThirdParty(id: string, body: { name?: string; note?: string }): Promise<ThirdPartyInfo> {
    return firstValueFrom(this.http.patch<ThirdPartyInfo>(`/api/third-parties/${id}`, body));
  }

  archiveThirdParty(id: string): Promise<ThirdPartyInfo> {
    return firstValueFrom(this.http.post<ThirdPartyInfo>(`/api/third-parties/${id}/archive`, {}));
  }

  thirdPartyBalances(fiscalYearId?: string): Promise<ThirdPartyBalancesInfo> {
    return firstValueFrom(this.http.get<ThirdPartyBalancesInfo>('/api/reports/third-parties', { params: fiscalYearId ? { fiscalYearId } : {} }));
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

  releaseNotes(): Promise<ReleaseNotesInfo> {
    return firstValueFrom(this.http.get<ReleaseNotesInfo>('/api/operations/release-notes'));
  }

  setStartMode(mode: StartModeInfo): Promise<{ mode: StartModeInfo }> {
    return firstValueFrom(this.http.put<{ mode: StartModeInfo }>('/api/start-mode', { mode }));
  }

  openingSituation(): Promise<OpeningSituationInfo> {
    return firstValueFrom(this.http.get<OpeningSituationInfo>('/api/opening-situation'));
  }

  recordOpeningSituation(body: OpeningSituationBody): Promise<OpeningSituationResultInfo> {
    return firstValueFrom(this.http.post<OpeningSituationResultInfo>('/api/opening-situation', body));
  }

  /** « Je pars de zéro » : rien à reprendre, l'étape est validée sans écriture. */
  skipOpeningSituation(): Promise<{ skipped: true }> {
    return firstValueFrom(this.http.put<{ skipped: true }>('/api/opening-situation/skip', {}));
  }

  overview(): Promise<OverviewInfo> {
    return firstValueFrom(this.http.get<OverviewInfo>('/api/overview'));
  }

  listOperationCategories(all = false): Promise<OperationCategoryInfo[]> {
    return firstValueFrom(this.http.get<OperationCategoryInfo[]>(all ? '/api/operation-categories/all' : '/api/operation-categories'));
  }

  createOperationCategory(body: { direction: 'IN' | 'OUT'; label: string; hint?: string; accountId: string }): Promise<OperationCategoryInfo> {
    return firstValueFrom(this.http.post<OperationCategoryInfo>('/api/operation-categories', body));
  }

  updateOperationCategory(id: string, body: { label?: string; hint?: string; accountId?: string; active?: boolean; usage?: 'MEMBERSHIP' | 'GRANT' | null }): Promise<OperationCategoryInfo> {
    return firstValueFrom(this.http.patch<OperationCategoryInfo>(`/api/operation-categories/${id}`, body));
  }

  applyStarterTemplate(): Promise<{ accountsCreated: number; categoriesCreated: number }> {
    return firstValueFrom(this.http.post<{ accountsCreated: number; categoriesCreated: number }>('/api/starter-template', {}));
  }

  bookTransaction(id: string, body: CategoryChoiceBody & { projectId?: string | null; post?: boolean }): Promise<GuidedOperationResult> {
    return firstValueFrom(this.http.post<GuidedOperationResult>(`/api/transactions/${id}/book`, body));
  }

  bookTransactions(accountId: string, body: { transactionIds?: string[]; post?: boolean }): Promise<BulkBookInfo> {
    return firstValueFrom(this.http.post<BulkBookInfo>(`/api/financial-accounts/${accountId}/transactions/book`, body));
  }

  /** Corrige une opération enregistrée : l'écriture est contrepassée puis refaite, d'un seul bloc (tout ou rien). */
  correctOperation(transactionId: string, body: CorrectOperationBody): Promise<GuidedOperationResult & { reversedEntryId: string }> {
    return firstValueFrom(this.http.post<GuidedOperationResult & { reversedEntryId: string }>(`/api/transactions/${transactionId}/correct`, body));
  }

  adjustOperationAmount(transactionId: string, body: AdjustAmountBody): Promise<AdjustAmountResult> {
    return firstValueFrom(this.http.post<AdjustAmountResult>(`/api/transactions/${transactionId}/adjust-amount`, body));
  }

  recordOperation(body: GuidedOperationBody): Promise<GuidedOperationResult> {
    return firstValueFrom(this.http.post<GuidedOperationResult>('/api/guided-operations', body));
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/auth/password', { currentPassword, newPassword }));
  }
}
