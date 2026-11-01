import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AdminApiService,
  type ProjectInfo,
  type ProjectStatus,
  type ProjectSummaryInfo,
} from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { formatApiAmount } from './amount';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PREPARATION: 'En préparation',
  ACTIVE: 'Actif',
  FINISHED: 'Terminé',
  ARCHIVED: 'Archivé',
};

/** Projets : axe analytique des charges et produits, avec leur synthèse globale et annuelle. */
@Component({
  selector: 'app-projects-page',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
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
    <header class="head">
      <h1 class="title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">folder_open</mat-icon><span>Projets</span></h1>
      @if (canUpdate()) {
        <button mat-flat-button type="button" (click)="startNew()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau projet
        </button>
      }
    </header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @if (notice(); as message) {
      <p class="success" role="status">{{ message }}</p>
    }

    @if (editing(); as mode) {
      <form class="panel" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h3>
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ mode === 'new' ? 'create_new_folder' : 'edit' }}</mat-icon>
          <span>{{ mode === 'new' ? 'Nouveau projet' : 'Modifier le projet ' + selected()?.code }}</span>
        </h3>
        <div class="row">
          @if (mode === 'new') {
            <mat-form-field appearance="outline">
              <mat-label>Code</mat-label>
              <input matInput formControlName="code" placeholder="FESTIVAL" />
              <mat-hint>Majuscules, chiffres, tirets ; définitif</mat-hint>
            </mat-form-field>
          }
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Nom</mat-label>
            <input matInput formControlName="name" required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>État</mat-label>
            <mat-select formControlName="status">
              @for (status of statuses; track status.value) {
                <mat-option [value]="status.value">{{ status.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Objet</mat-label>
          <textarea matInput rows="2" formControlName="description"></textarea>
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Début</mat-label>
            <input matInput type="date" formControlName="startDate" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Fin</mat-label>
            <input matInput type="date" formControlName="endDate" />
          </mat-form-field>
        </div>
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="busy() || form.invalid">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">save</mat-icon> Enregistrer
          </button>
          <button mat-button type="button" (click)="closeForm()">Annuler</button>
        </div>
      </form>
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
                <button mat-button type="button" [attr.aria-label]="'Ouvrir ' + project.name" (click)="open(project)">Ouvrir</button>
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
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly statuses = (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((value) => ({
    value,
    label: PROJECT_STATUS_LABELS[value],
  }));
  protected readonly projects = signal<ProjectInfo[]>([]);
  protected readonly selected = signal<ProjectInfo | null>(null);
  protected readonly summary = signal<ProjectSummaryInfo | null>(null);
  /** `new` pendant la création, `edit` pendant la modification, `null` sinon. */
  protected readonly editing = signal<'new' | 'edit' | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly amount = formatApiAmount;

  protected readonly canUpdate = computed(() => {
    this.auth.permissions();
    return this.auth.can('projects:update');
  });

  protected readonly form = this.fb.group({
    code: ['', [Validators.pattern(/^[A-Z0-9-]{1,20}$/)]],
    name: ['', [Validators.required]],
    description: [''],
    status: ['PREPARATION' as ProjectStatus],
    startDate: [''],
    endDate: [''],
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

  protected startNew(): void {
    this.form.reset({ code: '', name: '', description: '', status: 'PREPARATION', startDate: '', endDate: '' });
    this.form.controls.code.addValidators(Validators.required);
    this.form.controls.code.updateValueAndValidity();
    this.form.controls.status.enable();
    this.editing.set('new');
  }

  protected edit(project: ProjectInfo): void {
    this.form.controls.code.clearValidators();
    this.form.controls.code.addValidators(Validators.pattern(/^[A-Z0-9-]{1,20}$/));
    this.form.reset({
      code: project.code,
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: project.startDate ?? '',
      endDate: project.endDate ?? '',
    });
    // Le projet permanent reste actif : son état ne se modifie pas.
    if (project.permanent) this.form.controls.status.disable();
    else this.form.controls.status.enable();
    this.editing.set('edit');
  }

  protected closeForm(): void {
    this.editing.set(null);
  }

  protected async open(project: ProjectInfo): Promise<void> {
    await this.select(project);
  }

  protected async select(project: ProjectInfo | null): Promise<void> {
    this.editing.set(null);
    this.selected.set(project);
    this.summary.set(null);
    if (!project) return;
    try {
      this.summary.set(await this.api.projectSummary(project.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la synthèse du projet.').message);
    }
  }

  protected async save(): Promise<void> {
    const mode = this.editing();
    const value = this.form.getRawValue();
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      if (mode === 'new') {
        const created = await this.api.createProject({
          code: value.code,
          name: value.name.trim(),
          description: value.description,
          status: value.status,
          startDate: value.startDate || null,
          endDate: value.endDate || null,
        });
        this.notice.set(`Projet ${created.code} créé.`);
        this.editing.set(null);
        await this.load();
        await this.select(created);
      } else if (mode === 'edit' && this.selected()) {
        const current = this.selected()!;
        const updated = await this.api.updateProject(current.id, {
          name: value.name.trim(),
          description: value.description,
          ...(current.permanent ? {} : { status: value.status }),
          startDate: value.startDate || null,
          endDate: value.endDate || null,
        });
        this.notice.set('Projet enregistré.');
        this.editing.set(null);
        await this.load();
        await this.select(updated);
      }
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Enregistrement impossible. Réessayez.").message);
    } finally {
      this.busy.set(false);
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
