import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ThemeService } from '../theme/theme.service';
import { BackLink } from '../ui/back-link';
import { routeParam } from '../ui/route-param';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminApiService, type ProjectInfo, type ProjectStatus, type ProjectSummaryInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { formatDate } from '../ui/dates';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { PageHeader } from '../ui/page-header';
import { formatEuroAmount } from './amount';
import { LinkedDocuments } from '../documents/linked-documents';
import { ProjectBudget } from './project-budget';
import { ProjectCommitments } from './project-commitments';
import { ProjectReport } from './project-report';
import { ProjectDialog } from './project-dialog';
import { ProjectGrants } from './project-grants';
import { ProjectParticipants } from './project-participants';
import { PROJECT_STATUS_LABELS } from './project-labels';
import { Skeleton } from '../ui/skeleton';

/** Projets : axe analytique des charges et produits, avec leur synthèse globale et annuelle. */
@Component({
  selector: 'app-projects-page',
  imports: [Skeleton, BackLink, RouterLink, MatButtonModule, MatIconModule, PageHeader, LinkedDocuments, ProjectBudget, ProjectCommitments, ProjectGrants, ProjectParticipants, ProjectReport],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
  `,
  template: `
    @if (routeId()) {
      <app-page-header
        [title]="selected()?.name ?? 'Projet'"
        icon="folder_open"
        description="La synthèse, le budget, les engagements, les financements, les documents et les participants de ce projet."
      >
        <app-back-link to="/projets" label="Retour aux projets" />
        @if (selected(); as project) {
          @if (canEdit(project.id)) {
            <button mat-stroked-button type="button" (click)="edit(project)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit</mat-icon> Modifier
            </button>
          }
        }
      </app-page-header>
    } @else {
      <app-page-header
        title="Projets"
        icon="folder_open"
        description="Un projet regroupe les dépenses et les recettes d'une même action (festival, ateliers…) pour savoir ce qu'elle coûte et ce qu'elle rapporte."
      >
        @if (canUpdate()) {
          <button mat-flat-button type="button" (click)="create()">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau projet
          </button>
        }
      </app-page-header>
    }

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <app-skeleton variant="cards" />
    } @else if (routeId()) {
      @if (!selected()) {
        <p class="alert" role="alert">
          Ce projet est introuvable. Il a peut-être été retiré de votre accès, ou l'adresse est incomplète. Revenez à la liste des projets pour choisir un autre projet.
        </p>
      }
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
            <tr>
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
                <a mat-button [routerLink]="['/projets', project.id]" [attr.aria-label]="'Ouvrir ' + project.name">Ouvrir</a>
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
        </div>
        @if (project.description) {
          <p class="muted">{{ project.description }}</p>
        }
        @if (summary(); as data) {
          @if (data.years.length === 0) {
            <p class="muted">{{ simple() ? 'Aucune dépense ni aucune recette n’a encore été rattachée à ce projet.' : 'Aucune charge ni aucun produit n’a encore été ventilé sur ce projet.' }}</p>
          } @else {
            <table class="table">
              <caption class="sr-only">{{ simple() ? 'Dépenses et recettes par période' : 'Charges et produits par exercice' }}</caption>
              <thead>
                <tr>
                  <th scope="col">{{ simple() ? 'Période' : 'Exercice' }}</th>
                  <th scope="col" class="amount">{{ simple() ? 'Dépenses' : 'Charges' }}</th>
                  <th scope="col" class="amount">{{ simple() ? 'Recettes' : 'Produits' }}</th>
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
                  <td>{{ simple() ? 'Total (toutes les périodes)' : 'Total (tous exercices)' }}</td>
                  <td class="amount">{{ amount(data.total.charges) }}</td>
                  <td class="amount">{{ amount(data.total.produits) }}</td>
                  <td class="amount">{{ amount(data.total.result) }}</td>
                </tr>
              </tfoot>
            </table>
          }
        }
      </section>
      <app-project-report [project]="project" [refreshKey]="refresh()" />
      <app-project-budget [project]="project" (changed)="bump()" />
      <app-project-commitments [project]="project" (changed)="bump()" />
      @if (canSeeGrants(project.id)) {
        <app-project-grants [project]="project" />
      }
      @if (canOn('documents:view', project.id)) {
        <app-linked-documents objectType="project" [objectId]="project.id" [name]="project.name" [canDeposit]="canOn('documents:create', project.id) && project.status !== 'ARCHIVED'" />
      }
      <app-project-participants [project]="project" />
    }
  `,
})
export class ProjectsPage {
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  private readonly router = inject(Router);
  /** Le projet ouvert vient de l'adresse (`/projets/:id`) : `null` sur la liste. */
  protected readonly routeId = routeParam('id');
  protected readonly projects = signal<ProjectInfo[]>([]);
  protected readonly selected = computed(() => this.projects().find((p) => p.id === this.routeId()) ?? null);
  /** La synthèse se recharge quand on change de projet, pas quand sa fiche est modifiée. */
  private readonly selectedId = computed(() => this.selected()?.id ?? null);
  protected readonly summary = signal<ProjectSummaryInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatEuroAmount;
  /** Change quand le budget ou un engagement change : le suivi du budget se recharge. */
  protected readonly refresh = signal(0);

  protected bump(): void {
    this.refresh.update((n) => n + 1);
  }

  /** Créer un projet : droit global. */
  protected readonly canUpdate = computed(() => {
    this.auth.permissions();
    return this.auth.can('projects:update');
  });

  /** Modifier un projet : droit global, ou accordé sur ce projet par une attribution à portée projet. */
  protected canEdit(projectId: string): boolean {
    this.auth.permissions();
    this.auth.projectPermissions?.();
    return this.auth.canOnProject('projects:update', projectId);
  }

  constructor() {
    void this.load();
    effect(() => {
      const id = this.selectedId();
      untracked(() => void this.loadSummary(id));
    });
  }

  /** Droit global, ou accordé sur ce projet par une attribution à portée projet. */
  protected canOn(permission: string, projectId: string): boolean {
    this.auth.permissions();
    this.auth.projectPermissions?.();
    return this.auth.canOnProject(permission, projectId);
  }

  /** Les financements d'un projet se lisent avec `grants:view`, globalement ou sur ce projet. */
  protected canSeeGrants(projectId: string): boolean {
    this.auth.permissions();
    this.auth.projectPermissions?.();
    return this.auth.canOnProject('grants:view', projectId);
  }

  protected statusLabel(status: ProjectStatus): string {
    return PROJECT_STATUS_LABELS[status];
  }

  protected period(project: ProjectInfo): string {
    if (!project.startDate && !project.endDate) return '—';
    return `${project.startDate ? formatDate(project.startDate) : '…'} → ${project.endDate ? formatDate(project.endDate) : '…'}`;
  }

  protected async create(): Promise<void> {
    const created = await this.dialogs.open<ProjectInfo>(ProjectDialog, { size: 'md', data: { project: null } });
    if (!created) return;
    this.notifier.success(`Projet ${created.code} créé.`);
    // La page de détail recharge la liste : on y va directement.
    await this.router.navigate(['/projets', created.id]);
  }

  protected async edit(project: ProjectInfo): Promise<void> {
    const updated = await this.dialogs.open<ProjectInfo>(ProjectDialog, { size: 'md', data: { project } });
    if (!updated) return;
    this.notifier.success(`Projet ${updated.code} enregistré.`);
    await this.load();
  }

  private async loadSummary(id: string | null): Promise<void> {
    this.summary.set(null);
    if (!id) return;
    try {
      const data = await this.api.projectSummary(id);
      if (this.selectedId() === id) this.summary.set(data);
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
