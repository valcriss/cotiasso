import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AdminApiService, type GrantInfo, type ProjectInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { GRANT_STATUS_LABELS } from '../grants/grant-labels';
import { formatEuroAmount } from './amount';

/** Financements d'un projet : les subventions qui le financent et la part de chacune. Lecture seule. */
@Component({
  selector: 'app-project-grants',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
  `,
  template: `
    <section class="panel" [attr.aria-label]="'Financements de ' + project().name">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">payments</mat-icon><span>Financements</span></h3>
        <div class="actions">
          <a mat-button routerLink="/subventions">Voir les subventions</a>
        </div>
      </div>
      <p class="muted">Les subventions qui financent ce projet, avec la part qui lui revient. Pour en savoir plus ou les modifier, ouvrez la page Subventions.</p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (grants().length === 0) {
        <p class="muted">Aucune subvention n'est affectée à ce projet pour l'instant.</p>
      } @else {
        <table class="table">
          <caption class="sr-only">Subventions du projet</caption>
          <thead>
            <tr>
              <th scope="col">Subvention</th>
              <th scope="col">Financeur</th>
              <th scope="col">État</th>
              <th scope="col" class="amount">Part de ce projet</th>
            </tr>
          </thead>
          <tbody>
            @for (grant of grants(); track grant.id) {
              <tr>
                <td>{{ grant.title }}</td>
                <td>{{ grant.funder.name }}</td>
                <td><span class="chip">{{ statusLabel(grant) }}</span></td>
                <td class="amount">{{ part(grant) }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class ProjectGrants {
  private readonly api = inject(AdminApiService);

  readonly project = input.required<ProjectInfo>();

  protected readonly grants = signal<GrantInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.project().id;
      untracked(() => void this.load(id));
    });
  }

  protected statusLabel(grant: GrantInfo): string {
    return GRANT_STATUS_LABELS[grant.status];
  }

  protected part(grant: GrantInfo): string {
    const found = grant.allocations.find((a) => a.projectId === this.project().id);
    return found ? formatEuroAmount(found.amount) : '—';
  }

  private async load(projectId: string): Promise<void> {
    this.error.set(null);
    try {
      this.grants.set(await this.api.listProjectGrants(projectId));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les financements.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
