import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminApiService, type ProjectInfo, type ProjectStatus, type ProjectSummaryInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { PageHeader } from '../ui/page-header';
import { formatApiAmount } from './amount';
import { ProjectDialog } from './project-dialog';
import { PROJECT_STATUS_LABELS } from './project-labels';

/** Projets : axe analytique des charges et produits, avec leur synthèse globale et annuelle. */
@Component({
  selector: 'app-projects-page',
  imports: [MatButtonModule, MatIconModule, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    tr.selected td {
      background: var(--app-surface-muted);
    }
  `,
  template: `
    <app-page-header
      title="Projets"
      icon="folder_open"
      description="Un projet regroupe les dépenses et les recettes d'une activité (festival, ateliers…) pour savoir ce qu'elle coûte et ce qu'elle rapporte."
    >
      @if (canUpdate()) {
        <button mat-flat-button type="button" (click)="create()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau projet
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else {
      <table class="table">
        <caption class="sr-only">Projets</caption>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Nom</th>
            <th scope="col">État</th>
            <th scope="col">Période</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          @for (project of projects(); track project.id) {
            <tr [class.selected]="project.id === selected()?.id">
              <td>
                {{ project.code }}
                @if (project.permanent) {
                  <span class="chip">Permanent</span>
                }
              </td>
              <td>{{ project.name }}</td>
              <td>{{ statusLabel(project.status) }}</td>
              <td>{{ period(project) }}</td>
              <td class="row-actions">
                <button mat-button type="button" [attr.aria-label]="'Ouvrir ' + project.name" (click)="select(project)">Ouvrir</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    }

    @if (selected(); as project) {
      <section class="panel" [attr.aria-label]="'Synthèse de ' + project.name">
        <div class="head">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">analytics</mat-icon><span>Synthèse de {{ project.name }}</span></h3>
          <div class="actions">
            @if (canUpdate()) {
              <button mat-stroked-button type="button" (click)="edit(project)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit</mat-icon> Modifier
              </button>
            }
            <button mat-button type="button" (click)="select(null)">Fermer</button>
          </div>
        </div>
        @if (project.description) {
          <p class="muted">{{ project.description }}</p>
        }
        @if (summary(); as data) {
          @if (data.years.length === 0) {
            <p class="muted">Aucune charge ni aucun produit n'a encore été ventilé sur ce projet.</p>
          } @else {
            <table class="table">
              <caption class="sr-only">Charges et produits par exercice</caption>
              <thead>
                <tr>
                  <th scope="col">Exercice</th>
                  <th scope="col" class="amount">Charges</th>
                  <th scope="col" class="amount">Produits</th>
                  <th scope="col" class="amount">Résultat</th>
                </tr>
              </thead>
              <tbody>
                @for (year of data.years; track year.fiscalYearId) {
                  <tr>
                    <td>{{ year.label }}</td>
                    <td class="amount">{{ amount(year.charges) }}</td>
                    <td class="amount">{{ amount(year.produits) }}</td>
                    <td class="amount">{{ amount(year.result) }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Total (tous exercices)</td>
                  <td class="amount">{{ amount(data.total.charges) }}</td>
                  <td class="amount">{{ amount(data.total.produits) }}</td>
                  <td class="amount">{{ amount(data.total.result) }}</td>
                </tr>
              </tfoot>
            </table>
          }
        }
      </section>
    }
  `,
})
export class ProjectsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly projects = signal<ProjectInfo[]>([]);
  protected readonly selected = signal<ProjectInfo | null>(null);
  protected readonly summary = signal<ProjectSummaryInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;

  protected readonly canUpdate = computed(() => {
    this.auth.permissions();
    return this.auth.can('projects:update');
  });

  constructor() {
    void this.load();
  }

  protected statusLabel(status: ProjectStatus): string {
    return PROJECT_STATUS_LABELS[status];
  }

  protected period(project: ProjectInfo): string {
    if (!project.startDate && !project.endDate) return '—';
    return `${project.startDate ?? '…'} → ${project.endDate ?? '…'}`;
  }

  protected async create(): Promise<void> {
    const created = await this.dialogs.open<ProjectInfo>(ProjectDialog, { size: 'md', data: { project: null } });
    if (!created) return;
    this.notifier.success(`Projet ${created.code} créé.`);
    await this.load();
    await this.select(created);
  }

  protected async edit(project: ProjectInfo): Promise<void> {
    const updated = await this.dialogs.open<ProjectInfo>(ProjectDialog, { size: 'md', data: { project } });
    if (!updated) return;
    this.notifier.success(`Projet ${updated.code} enregistré.`);
    await this.load();
    await this.select(updated);
  }

  protected async select(project: ProjectInfo | null): Promise<void> {
    this.selected.set(project);
    this.summary.set(null);
    if (!project) return;
    try {
      this.summary.set(await this.api.projectSummary(project.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la synthèse du projet.').message);
    }
  }

  private async load(): Promise<void> {
    try {
      this.projects.set(await this.api.listProjects());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les projets.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
