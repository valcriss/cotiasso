import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminApiService } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { Notifier } from '../ui/notifier.service';
import { Skeleton } from '../ui/skeleton';
import { CircuitDiagram } from './circuit-diagram';
import { CircuitEditorDialog, type CircuitEditorData } from './circuit-editor-dialog';
import type { Lookups } from './circuit-model';
import { WorkflowsApi, type VersionSummary, type VersionView, type WorkflowSummary } from './workflows-api';

interface Section {
  summary: WorkflowSummary;
  active: VersionView | null;
  draft: VersionView | null;
  versions: VersionSummary[];
}

const STATE_LABELS: Record<VersionSummary['status'], string> = { DRAFT: 'Brouillon', ACTIVE: 'En vigueur', RETIRED: 'Remplacée' };

/** Circuits de validation (Paramètres) : qui donne son accord, puis qui rembourse. Une version en vigueur ne change plus. */
@Component({
  selector: 'app-circuits-page',
  imports: [CircuitDiagram, FrDatePipe, MatButtonModule, MatIconModule, Skeleton],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <section class="panel">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_tree</mat-icon><span>Circuits de validation</span></h3>
      </div>
      <p class="muted">
        Un circuit décrit le chemin d’une demande : qui doit donner son accord, puis qui rembourse. Quand vous le modifiez, le changement ne concerne que les nouvelles demandes : celles qui sont déjà déposées gardent le circuit
        qu’elles suivent.
      </p>
    </section>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <app-skeleton variant="cards" />
    }

    @for (section of sections(); track section.summary.subjectType) {
      <section class="panel" [attr.aria-label]="section.summary.label">
        <div class="head">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">receipt_long</mat-icon><span>{{ section.summary.label }}</span></h3>
          @if (canAdmin() && !section.draft) {
            <div class="actions">
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="prepare(section)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit_note</mat-icon>
                {{ section.active ? 'Préparer une nouvelle version' : 'Préparer le circuit de départ' }}
              </button>
            </div>
          }
        </div>

        @if (section.active; as active) {
          <p>
            <strong>En vigueur</strong> : version {{ active.number }}@if (active.activatedAt) { depuis le {{ active.activatedAt | frDate }}}.
          </p>
          <app-circuit-diagram [document]="active.document" [lookups]="lookups()" />
          @for (warning of active.warnings; track warning.nodeId) {
            <p class="alert" role="status">{{ warning.message }}</p>
          }
        } @else if (!loading()) {
          <p class="alert" role="status">
            Aucun circuit n’est en vigueur : les membres ne peuvent pas encore faire de demande de remboursement.
            @if (canAdmin()) {
              Préparez le circuit de départ (le membre dépose, le président donne son accord, le trésorier rembourse), vérifiez-le, puis mettez-le en vigueur.
            }
          </p>
        }

        @if (section.draft; as draft) {
          <h4>Brouillon (version {{ draft.number }})</h4>
          <p class="muted">Ce brouillon ne change rien tant que vous ne l’avez pas mis en vigueur.</p>
          <app-circuit-diagram [document]="draft.document" [lookups]="lookups()" />
          @if (draft.issues.length > 0) {
            <div class="alert" role="alert">
              <p>À régler avant de pouvoir le mettre en vigueur :</p>
              <ul>
                @for (issue of draft.issues; track $index) {
                  <li>{{ issue.message }}</li>
                }
              </ul>
            </div>
          }
          @for (warning of draft.warnings; track warning.nodeId) {
            <p class="alert" role="status">{{ warning.message }}</p>
          }
          @if (canAdmin()) {
            <div class="actions">
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="edit(draft)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit</mat-icon> Modifier le brouillon
              </button>
              <button mat-flat-button type="button" [disabled]="busy() || draft.issues.length > 0" (click)="activate(section, draft)">Mettre en vigueur</button>
              <button mat-button type="button" [disabled]="busy()" (click)="discard(draft)">Supprimer le brouillon</button>
            </div>
          }
        }

        @if (section.versions.length > 0) {
          <h4>Historique</h4>
          <table class="table">
            <caption class="sr-only">Versions du circuit</caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">État</th>
                <th scope="col">Mise en vigueur</th>
                <th scope="col">Remplacée le</th>
              </tr>
            </thead>
            <tbody>
              @for (version of section.versions; track version.id) {
                <tr>
                  <td>{{ version.number }}</td>
                  <td>{{ stateLabel(version) }}</td>
                  <td>{{ version.activatedAt ? (version.activatedAt | frDate) : '—' }}</td>
                  <td>{{ version.retiredAt ? (version.retiredAt | frDate) : '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }
  `,
})
export class CircuitsPage {
  private readonly api = inject(WorkflowsApi);
  private readonly admin = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sections = signal<Section[]>([]);
  protected readonly lookups = signal<Lookups>({ users: new Map(), roles: new Map(), offices: new Map() });
  protected readonly canAdmin = computed(() => this.auth.can('workflows:admin'));

  constructor() {
    void this.load();
  }

  protected stateLabel(version: VersionSummary): string {
    return STATE_LABELS[version.status];
  }

  protected async prepare(section: Section): Promise<void> {
    await this.run(async () => {
      await this.api.createDraft(section.summary.subjectType, section.active ? 'ACTIVE' : 'STARTER');
      await this.reload();
      this.notifier.success('Brouillon préparé. Modifiez-le, puis mettez-le en vigueur.');
    });
  }

  protected async edit(draft: VersionView): Promise<void> {
    const saved = await this.dialogs.open<VersionView, CircuitEditorData>(CircuitEditorDialog, { size: 'lg', data: { version: draft, lookups: this.lookups() } });
    if (!saved) return;
    this.notifier.success('Brouillon enregistré.');
    await this.reload();
  }

  protected async activate(section: Section, draft: VersionView): Promise<void> {
    const replacing = section.active !== null;
    const ok = await this.dialogs.confirm({
      title: `Mettre en vigueur la version ${draft.number} ?`,
      message: replacing
        ? 'Ce circuit s’appliquera aux nouvelles demandes. Les demandes déjà déposées gardent le circuit qu’elles suivent. La version actuelle est conservée dans l’historique.'
        : 'Les membres pourront alors faire des demandes de remboursement, qui suivront ce circuit. Vous pourrez ensuite le faire évoluer en préparant une nouvelle version.',
      confirmLabel: 'Mettre en vigueur',
    });
    if (!ok) return;
    await this.run(async () => {
      await this.api.activate(draft.id);
      await this.reload();
      this.notifier.success('Circuit mis en vigueur.');
    });
  }

  protected async discard(draft: VersionView): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Supprimer ce brouillon ?',
      message: 'Rien ne change pour les demandes : seul ce brouillon disparaît. Vous pourrez en préparer un autre.',
      confirmLabel: 'Supprimer le brouillon',
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await this.api.deleteDraft(draft.id);
      await this.reload();
      this.notifier.success('Brouillon supprimé.');
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'L’opération a échoué. Réessayez dans un instant.').message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    await Promise.all([this.loadLookups(), this.reload()]);
  }

  private async loadLookups(): Promise<void> {
    // Les noms servent à afficher qui est désigné ; sans le droit de les lire, l'écran dit « introuvable » plutôt que de planter.
    const [users, roles, offices] = await Promise.all([
      this.admin.listUsers().catch(() => []),
      this.admin.listRoles().catch(() => []),
      this.admin.listOfficeRoles().catch(() => []),
    ]);
    this.lookups.set({
      users: new Map(users.filter((u) => u.status === 'ACTIVE').map((u) => [u.id, u.displayName])),
      roles: new Map(roles.map((r) => [r.id, r.name])),
      offices: new Map(offices.filter((o) => o.active).map((o) => [o.id, o.name])),
    });
  }

  private async reload(): Promise<void> {
    try {
      const summaries = await this.api.list();
      this.sections.set(
        await Promise.all(
          summaries.map(async (summary) => ({
            summary,
            active: summary.active ? await this.api.version(summary.active.id) : null,
            draft: summary.draft ? await this.api.version(summary.draft.id) : null,
            versions: (await this.api.history(summary.subjectType)).versions,
          })),
        ),
      );
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Les circuits n’ont pas pu être chargés. Rechargez la page.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
