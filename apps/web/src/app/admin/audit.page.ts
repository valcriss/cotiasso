import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';
import { AdminApiService, type AuditEntry, type AuditFilters, type IntegrityReport } from './admin-api.service';
import { ExportLink } from '../reports/export-link';
import { actionLabel, auditObjectLabel } from './audit-labels';
import { DateField } from '../ui/date-field';

/** Début de journée locale (from) ou fin de journée locale (to) au format ISO, pour des bornes inclusives. */
export function dayBound(value: string, end: boolean): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

@Component({
  selector: 'app-audit-page',
  imports: [DateField, ActionBar, DatePipe, ExportLink, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styleUrl: './admin-pages.scss',
  template: `
    <app-action-bar
      label="Actions du journal"
      description="L'historique des actions sensibles (connexions, droits, écritures validées…), conservé sans possibilité de modification. La vérification détecte une modification faite directement en base ; elle ne constitue pas un archivage à valeur probante."
    >
      <button mat-stroked-button type="button" [disabled]="verifying()" (click)="verify()">
        <mat-icon fontSet="material-icons-outlined">verified_user</mat-icon>
        Vérifier l'intégrité
      </button>
      <app-export-link base="/api/audit/csv" [params]="applied()" />
    </app-action-bar>

    @if (report(); as result) {
      @if (result.ok) {
        <p class="success" role="status">
          Chaîne intacte : {{ result.checked }} événement(s) vérifié(s).
          @if (result.unchained > 0) {
            {{ result.unchained }} événement(s) antérieur(s) à la chaîne ne sont pas vérifiables.
          }
        </p>
      } @else {
        <p class="alert" role="alert">
          Altération détectée à l'événement n° {{ result.firstBrokenSeq }} : {{ result.reason }}
        </p>
      }
    }

    <form class="panel filters" [formGroup]="filters" (ngSubmit)="search()">
      <mat-form-field appearance="outline">
        <mat-label>Action</mat-label>
        <mat-select formControlName="action">
          <mat-option value="">Toutes</mat-option>
          @for (action of actions(); track action) {
            <mat-option [value]="action">{{ label(action) }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Objet</mat-label>
        <mat-select formControlName="objectType">
          <mat-option value="">Tous</mat-option>
          @for (type of objectTypes(); track type) {
            <mat-option [value]="type">{{ objectLabel(type) }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <app-date-field label="Du" formControlName="from" />
      <app-date-field label="Au" formControlName="to" />
      <div class="actions">
        <button mat-flat-button type="submit" [disabled]="loading()">Filtrer</button>
        <button mat-button type="button" (click)="reset()">Réinitialiser</button>
      </div>
    </form>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (entries().length === 0 && !loading()) {
      <p class="muted">Aucun événement ne correspond à ces critères.</p>
    } @else {
      <table class="table">
        <caption class="sr-only">Événements du journal d'audit, du plus récent au plus ancien</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Acteur</th>
            <th scope="col">Action</th>
            <th scope="col">Objet</th>
          </tr>
        </thead>
        <tbody>
          @for (entry of entries(); track entry.id) {
            <tr>
              <td>{{ entry.occurredAt | date: 'dd/MM/yyyy HH:mm:ss' }}</td>
              <td>
                @if (entry.actor; as actor) {
                  {{ actor.displayName }}
                  <div class="muted">{{ actor.email }}</div>
                } @else {
                  <span class="muted">Système ou inconnu</span>
                }
              </td>
              <td>
                <strong>{{ label(entry.action) }}</strong>
                @if (entry.justification) {
                  <div class="muted">Motif : {{ entry.justification }}</div>
                }
                @if (hasDetails(entry)) {
                  <details>
                    <summary>Détails</summary>
                    <pre>{{ pretty(entry.details) }}</pre>
                  </details>
                }
              </td>
              <td>
                {{ objectLabel(entry.objectType) }}
                @if (entry.objectId) {
                  <div class="muted">{{ entry.objectId }}</div>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (nextCursor() !== null) {
        <div class="actions more">
          <button mat-stroked-button type="button" [disabled]="loading()" (click)="loadMore()">Charger plus</button>
        </div>
      }
    }
  `,
})
export class AuditPage {
  private readonly api = inject(AdminApiService);

  protected readonly filters = inject(FormBuilder).nonNullable.group({ action: '', objectType: '', from: '', to: '' });
  /** Critères de la dernière recherche : l'export reprend exactement ce qui est affiché, pas ce qui est saisi sans être recherché. */
  protected readonly applied = signal<Record<string, string>>({});
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly nextCursor = signal<number | null>(null);
  protected readonly actions = signal<string[]>([]);
  protected readonly objectTypes = signal<string[]>([]);
  protected readonly loading = signal(false);
  protected readonly verifying = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly report = signal<IntegrityReport | null>(null);
  protected readonly label = actionLabel;
  protected readonly objectLabel = auditObjectLabel;
  protected readonly hasCriteria = computed(() => Object.values(this.filters.getRawValue()).some(Boolean));

  constructor() {
    void this.init();
  }

  protected async search(): Promise<void> {
    this.entries.set([]);
    this.nextCursor.set(null);
    await this.fetch();
  }

  protected async reset(): Promise<void> {
    this.filters.reset({ action: '', objectType: '', from: '', to: '' });
    await this.search();
  }

  protected async loadMore(): Promise<void> {
    await this.fetch(this.nextCursor() ?? undefined);
  }

  protected async verify(): Promise<void> {
    this.error.set(null);
    this.verifying.set(true);
    try {
      this.report.set(await this.api.verifyAudit());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Vérification impossible. Réessayez.').message);
    } finally {
      this.verifying.set(false);
    }
  }

  protected hasDetails(entry: AuditEntry): boolean {
    return entry.details !== null && entry.details !== undefined && Object.keys(entry.details as object).length > 0;
  }

  protected pretty(details: unknown): string {
    return JSON.stringify(details, null, 2);
  }

  private async init(): Promise<void> {
    try {
      const facets = await this.api.auditFacets();
      this.actions.set(facets.actions);
      this.objectTypes.set(facets.objectTypes);
    } catch {
      // Les filtres restent utilisables sans suggestions.
    }
    await this.search();
  }

  private async fetch(before?: number): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const { action, objectType, from, to } = this.filters.getRawValue();
      const criteria: AuditFilters = {
        action,
        objectType,
        ...(dayBound(from, false) && { from: dayBound(from, false)! }),
        ...(dayBound(to, true) && { to: dayBound(to, true)! }),
      };
      if (before === undefined) this.applied.set(Object.fromEntries(Object.entries(criteria).filter(([, value]) => value)) as Record<string, string>);
      const page = await this.api.listAudit(criteria, before);
      this.entries.update((current) => [...current, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger le journal.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
