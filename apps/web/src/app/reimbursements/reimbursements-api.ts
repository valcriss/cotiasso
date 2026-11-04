import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type ReimbursementStatus = 'DRAFT' | 'IN_CIRCUIT' | 'RETURNED' | 'REFUSED' | 'CANCELLED' | 'PAID';

export interface ReimbursementListItem {
  id: string;
  number: number;
  status: ReimbursementStatus;
  amount: string;
  expenseDate: string;
  reason: string;
  requesterName: string;
  awaitingLabel: string | null;
  submittedAt: string | null;
  stepType?: 'APPROVAL' | 'PROCESSING';
}

export interface ReimbursementStep {
  nodeId: string;
  label: string;
  type: 'APPROVAL' | 'PROCESSING';
  state: 'DONE' | 'AUTO' | 'CURRENT' | 'PENDING' | 'RETURNED';
}

export interface ReimbursementDecision {
  nodeId: string | null;
  outcome: 'APPROVED' | 'AUTO_APPROVED' | 'REFUSED' | 'RETURNED' | 'PROCESSED' | 'CANCELLED';
  actorUserId: string;
  actorName?: string;
  message: string | null;
  round: number;
  createdAt: string;
}

export interface ReimbursementInfo {
  id: string;
  number: number;
  status: ReimbursementStatus;
  amount: string;
  expenseDate: string;
  reason: string;
  projectId: string | null;
  projectName: string | null;
  requesterUserId: string;
  requesterName: string;
  version: number;
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  documentCount: number;
  awaitingLabel: string | null;
  lastMessage: string | null;
  paid: { transactionId: string; entryId: string } | null;
  instance: { status: string; round: number; versionNumber: number; steps: ReimbursementStep[]; decisions: ReimbursementDecision[] } | null;
  can: { edit: boolean; submit: boolean; cancel: boolean; delete: boolean; decide: boolean; process: boolean; stepType: 'APPROVAL' | 'PROCESSING' | null };
}

export interface ReimbursementStatusInfo {
  enabled: boolean;
  /** Circuit en vigueur **et** utilisable : chaque étape a quelqu'un pour décider. Sinon la rubrique est masquée du menu. */
  ready: boolean;
  canRequest: boolean;
  reason: string | null;
}

export interface ReceiptInfo {
  id: string;
  title: string;
  latest: { originalName: string; size: number };
}

export interface ReimbursementBody {
  amount: string;
  expenseDate: string;
  reason: string;
  projectId: string | null;
}

export interface ProcessBody {
  mode: 'CREATE' | 'EXISTING';
  categoryId?: string;
  financialAccountId?: string;
  date?: string;
  transactionId?: string;
}

export interface TransactionCandidate {
  id: string;
  label: string;
  date: string;
  accountName: string;
  booked: boolean;
}

/** Demandes de remboursement (ADR 0035). */
@Injectable({ providedIn: 'root' })
export class ReimbursementsApi {
  private readonly http = inject(HttpClient);

  status(): Promise<ReimbursementStatusInfo> {
    return firstValueFrom(this.http.get<ReimbursementStatusInfo>('/api/reimbursements/status'));
  }

  projects(): Promise<{ id: string; name: string }[]> {
    return firstValueFrom(this.http.get<{ id: string; name: string }[]>('/api/reimbursements/projects'));
  }

  mine(): Promise<ReimbursementListItem[]> {
    return firstValueFrom(this.http.get<ReimbursementListItem[]>('/api/reimbursements/mine'));
  }

  all(): Promise<ReimbursementListItem[]> {
    return firstValueFrom(this.http.get<ReimbursementListItem[]>('/api/reimbursements'));
  }

  toDecide(): Promise<ReimbursementListItem[]> {
    return firstValueFrom(this.http.get<ReimbursementListItem[]>('/api/reimbursements/to-decide'));
  }

  get(id: string): Promise<ReimbursementInfo> {
    return firstValueFrom(this.http.get<ReimbursementInfo>(`/api/reimbursements/${id}`));
  }

  create(body: ReimbursementBody): Promise<ReimbursementInfo> {
    return firstValueFrom(this.http.post<ReimbursementInfo>('/api/reimbursements', body));
  }

  update(id: string, body: Partial<ReimbursementBody> & { version: number }): Promise<ReimbursementInfo> {
    return firstValueFrom(this.http.patch<ReimbursementInfo>(`/api/reimbursements/${id}`, body));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/reimbursements/${id}`));
  }

  submit(id: string): Promise<ReimbursementInfo> {
    return firstValueFrom(this.http.post<ReimbursementInfo>(`/api/reimbursements/${id}/submit`, {}));
  }

  cancel(id: string, message: string): Promise<ReimbursementInfo> {
    return firstValueFrom(this.http.post<ReimbursementInfo>(`/api/reimbursements/${id}/cancel`, { message }));
  }

  decide(id: string, type: 'APPROVE' | 'REFUSE' | 'RETURN', message: string | null): Promise<ReimbursementInfo> {
    return firstValueFrom(this.http.post<ReimbursementInfo>(`/api/reimbursements/${id}/decision`, { type, message }));
  }

  process(id: string, body: ProcessBody): Promise<ReimbursementInfo> {
    return firstValueFrom(this.http.post<ReimbursementInfo>(`/api/reimbursements/${id}/process`, body));
  }

  candidates(id: string): Promise<TransactionCandidate[]> {
    return firstValueFrom(this.http.get<TransactionCandidate[]>(`/api/reimbursements/${id}/transaction-candidates`));
  }

  receipts(id: string): Promise<ReceiptInfo[]> {
    return firstValueFrom(this.http.get<ReceiptInfo[]>(`/api/reimbursements/${id}/documents`));
  }

  addReceipt(id: string, file: File): Promise<unknown> {
    const form = new FormData();
    form.append('title', file.name);
    form.append('file', file);
    return firstValueFrom(this.http.post(`/api/reimbursements/${id}/documents`, form));
  }

  archiveReceipt(id: string, documentId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/reimbursements/${id}/documents/${documentId}`));
  }

  receiptUrl(id: string, documentId: string): string {
    return `/api/reimbursements/${id}/documents/${documentId}/download`;
  }
}
