import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type DesignationKind = 'USER' | 'ROLE' | 'OFFICE';

/** Qui peut décider d'une étape : une personne, un rôle, ou une fonction du bureau. */
export interface Designation {
  kind: DesignationKind;
  id: string;
}

export interface CircuitNode {
  id: string;
  type: 'START' | 'APPROVAL' | 'PROCESSING' | 'END';
  label: string;
  approvers: Designation[];
  requesterExempt: boolean;
}

export interface CircuitDocument {
  schemaVersion: 1;
  allowSelfProcessing: boolean;
  nodes: CircuitNode[];
  edges: { from: string; to: string }[];
}

export interface CircuitIssue {
  nodeId?: string;
  code: string;
  message: string;
}

export interface VersionSummary {
  id: string;
  number: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
}

export interface WorkflowSummary {
  subjectType: string;
  label: string;
  active: VersionSummary | null;
  draft: VersionSummary | null;
}

export interface VersionView extends VersionSummary {
  subjectType: string;
  label: string;
  revision: number;
  document: CircuitDocument;
  /** Ce qui empêche de mettre cette version en vigueur. */
  issues: CircuitIssue[];
  /** Signalements : une étape que personne ne peut décider aujourd'hui. */
  warnings: CircuitIssue[];
}

/** Circuits de validation (ADR 0035). */
@Injectable({ providedIn: 'root' })
export class WorkflowsApi {
  private readonly http = inject(HttpClient);

  list(): Promise<WorkflowSummary[]> {
    return firstValueFrom(this.http.get<WorkflowSummary[]>('/api/workflows'));
  }

  history(subjectType: string): Promise<{ subjectType: string; label: string; versions: VersionSummary[] }> {
    return firstValueFrom(this.http.get<{ subjectType: string; label: string; versions: VersionSummary[] }>(`/api/workflows/${subjectType}`));
  }

  version(id: string): Promise<VersionView> {
    return firstValueFrom(this.http.get<VersionView>(`/api/workflow-versions/${id}`));
  }

  createDraft(subjectType: string, source: 'ACTIVE' | 'STARTER'): Promise<VersionView> {
    return firstValueFrom(this.http.post<VersionView>(`/api/workflows/${subjectType}/draft`, { source }));
  }

  updateDraft(id: string, revision: number, document: CircuitDocument): Promise<VersionView> {
    return firstValueFrom(this.http.put<VersionView>(`/api/workflow-versions/${id}`, { revision, document }));
  }

  deleteDraft(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/workflow-versions/${id}`));
  }

  activate(id: string): Promise<VersionView> {
    return firstValueFrom(this.http.post<VersionView>(`/api/workflow-versions/${id}/activate`, {}));
  }
}
