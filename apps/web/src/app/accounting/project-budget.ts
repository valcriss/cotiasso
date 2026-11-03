import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AdminApiService, type BudgetInfo, type BudgetSummaryInfo, type ProjectInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { ThemeService } from '../theme/theme.service';
import { formatEuroAmount } from './amount';
import { BudgetDialog } from './budget-dialog';
import { BUDGET_KIND_LABELS, BUDGET_STATUS_LABELS } from './project-labels';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { formatDate } from '../ui/dates';

/**
 * Budget prévisionnel d'un projet : versions successives, une seule en vigueur. Une version approuvée ne se modifie plus
 * (on prépare une nouvelle version). C'est une prévision : aucune écriture comptable n'en découle.
 */
@Component({
  selector: 'app-project-budget',
  imports: [FrDatePipe, MatButtonModule, MatIconModule],
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
    <section class="panel" [attr.aria-label]="'Budget de ' + project().name">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">request_quote</mat-icon><span>Budget prévisionnel</span></h3>
        <div class="actions">
          @if (canPrepare()) {
            <button mat-stroked-button type="button" [disabled]="hasDraft()" (click)="prepare()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Préparer un budget
            </button>
          }
        </div>
      </div>
      <p class="muted">
        Ce que vous prévoyez de dépenser (charges) et de recevoir (produits) pour ce projet. C'est une prévision : elle ne
        {{ simple() ? 'modifie pas vos comptes' : 'crée aucune écriture comptable' }}.
        @if (hasDraft() && canPrepare()) {
          Un budget est déjà en préparation : approuvez-le ou supprimez-le avant d'en préparer un autre.
        }
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (versions().length === 0) {
        <p class="muted">
          @if (canPrepare()) {
            Aucun budget pour l'instant. Cliquez sur « Préparer un budget », puis ajoutez les dépenses et les recettes que vous prévoyez.
          } @else {
            Aucun budget n'a encore été préparé pour ce projet.
          }
        </p>
      } @else {
        <table class="table">
          <caption class="sr-only">Versions du budget</caption>
          <thead>
            <tr>
              <th scope="col">N°</th>
              <th scope="col">Nom</th>
              <th scope="col">État</th>
              <th scope="col" class="amount">Dépenses prévues</th>
              <th scope="col" class="amount">Recettes prévues</th>
              <th scope="col" class="amount">Résultat prévu</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (version of versions(); track version.id) {
              <tr [class.selected]="version.id === current()?.id">
                <td>{{ version.number }}</td>
                <td>{{ version.label }}</td>
                <td>
                  <span class="chip">{{ statusLabel(version) }}</span>
                </td>
                <td class="amount">{{ amount(version.charges) }}</td>
                <td class="amount">{{ amount(version.products) }}</td>
                <td class="amount">{{ amount(version.result) }}</td>
                <td class="row-actions">
                  <button mat-button type="button" [attr.aria-label]="'Voir le budget n° ' + version.number" (click)="open(version)">Voir</button>
                </td>
              </tr>
            }
          </tbody>
        </table>

        @if (current(); as budget) {
          <div class="head">
            <h3><span>Budget n° {{ budget.number }} — {{ budget.label }}</span></h3>
            <div class="actions">
              @if (budget.status === 'DRAFT') {
                @if (canPrepare()) {
                  <button mat-stroked-button type="button" (click)="editLines(budget)">
                    <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit</mat-icon> Modifier les lignes
                  </button>
                  <button mat-button type="button" (click)="remove(budget)">
                    <mat-icon fontSet="material-icons-outlined" aria-hidden="true">delete</mat-icon> Supprimer ce brouillon
                  </button>
                }
                @if (canApprove()) {
                  <button mat-flat-button type="button" [disabled]="budget.lineCount === 0" (click)="approve(budget)">
                    <mat-icon fontSet="material-icons-outlined" aria-hidden="true">check</mat-icon> Approuver
                  </button>
                }
              }
            </div>
          </div>
          @if (budget.status !== 'DRAFT') {
            <p class="muted">
              @if (budget.status === 'APPROVED') {
                Budget en vigueur depuis le {{ approvedOn(budget) }}. Il ne se modifie plus : pour le changer, préparez une nouvelle version
                (elle reprend ces lignes).
              } @else {
                Version remplacée, conservée pour l'historique.
              }
            </p>
          } @else if (budget.lineCount === 0) {
            <p class="muted">Ce budget est vide. @if (canPrepare()) { Cliquez sur « Modifier les lignes » pour ajouter des dépenses et des recettes. }</p>
          }
          @if (budget.lines.length > 0) {
            <table class="table">
              <caption class="sr-only">Lignes du budget n° {{ budget.number }}</caption>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Poste</th>
                  <th scope="col">Période</th>
                  <th scope="col" class="amount">Montant</th>
                </tr>
              </thead>
              <tbody>
                @for (line of budget.lines; track line.id) {
                  <tr>
                    <td>{{ kindLabel(line.kind) }}</td>
                    <td>{{ line.label }}</td>
                    <td>{{ line.periodStart | frDate }} → {{ line.periodEnd | frDate }}</td>
                    <td class="amount">{{ amount(line.amount) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        }
      }
    </section>
  `,
})
export class ProjectBudget {
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  readonly project = input.required<ProjectInfo>();
  /** Émis quand le budget en vigueur peut avoir changé : le suivi du budget se recharge. */
  readonly changed = output<void>();

  protected readonly versions = signal<BudgetSummaryInfo[]>([]);
  protected readonly current = signal<BudgetInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatEuroAmount;

  protected readonly hasDraft = computed(() => this.versions().some((version) => version.status === 'DRAFT'));
  protected readonly canPrepare = computed(() => {
    this.auth.permissions();
    return this.auth.can('budgets:update') && this.project().status !== 'ARCHIVED';
  });
  protected readonly canApprove = computed(() => {
    this.auth.permissions();
    return this.auth.can('budgets:approve');
  });

  constructor() {
    // Recharge quand on ouvre un autre projet. `untracked` : les signaux lus par le chargement ne relancent pas l'effet.
    effect(() => {
      const id = this.project().id;
      untracked(() => void this.load(id));
    });
  }

  protected statusLabel(version: BudgetSummaryInfo): string {
    return BUDGET_STATUS_LABELS[version.status];
  }

  protected kindLabel(kind: BudgetInfo['lines'][number]['kind']): string {
    return BUDGET_KIND_LABELS[kind];
  }

  protected approvedOn(budget: BudgetInfo): string {
    return budget.approvedAt ? formatDate(budget.approvedAt.slice(0, 10)) : '';
  }

  protected async open(version: BudgetSummaryInfo): Promise<void> {
    try {
      this.current.set(await this.api.getBudget(version.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger ce budget.').message);
    }
  }

  protected async prepare(): Promise<void> {
    const created = await this.dialogs.open<BudgetInfo>(BudgetDialog, {
      size: 'md',
      data: { mode: 'create', project: this.project(), versions: this.versions() },
    });
    if (!created) return;
    this.notifier.success(`Budget n° ${created.number} préparé. Ajoutez maintenant ses lignes.`);
    await this.load(this.project().id, created.id);
    this.changed.emit();
  }

  protected async editLines(budget: BudgetInfo): Promise<void> {
    const saved = await this.dialogs.open<BudgetInfo>(BudgetDialog, {
      size: 'lg',
      data: { mode: 'edit', project: this.project(), budget },
    });
    if (!saved) return;
    this.notifier.success(`Budget n° ${saved.number} enregistré.`);
    await this.load(this.project().id, saved.id);
    this.changed.emit();
  }

  protected async approve(budget: BudgetInfo): Promise<void> {
    const inForce = this.versions().find((version) => version.status === 'APPROVED');
    const confirmed = await this.dialogs.confirm({
      title: `Approuver le budget n° ${budget.number} ?`,
      message:
        `Ce budget deviendra le budget en vigueur de « ${this.project().name} ».\n` +
        'Il ne pourra plus être modifié : pour le changer, vous préparerez une nouvelle version.\n' +
        (inForce ? `Le budget n° ${inForce.number} sera conservé comme « remplacé ».\n` : '') +
        (this.simple() ? 'Vos comptes ne sont pas modifiés.' : "Aucune écriture comptable n'est créée."),
      confirmLabel: 'Approuver',
    });
    if (!confirmed) return;
    try {
      await this.api.approveBudget(budget.id);
      this.notifier.success(`Budget n° ${budget.number} approuvé : il est en vigueur.`);
      await this.load(this.project().id, budget.id);
      this.changed.emit();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le budget n'a pas pu être approuvé. Réessayez dans un instant.").message);
    }
  }

  protected async remove(budget: BudgetInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Supprimer ce brouillon ?',
      message: `Le brouillon n° ${budget.number} et ses lignes seront supprimés. Les budgets approuvés ne sont pas touchés.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.api.deleteBudget(budget.id);
      this.notifier.success('Brouillon supprimé.');
      this.current.set(null);
      await this.load(this.project().id);
      this.changed.emit();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le brouillon n'a pas pu être supprimé. Réessayez dans un instant.").message);
    }
  }

  private async load(projectId: string, show?: string): Promise<void> {
    this.error.set(null);
    try {
      const versions = await this.api.listBudgets(projectId);
      this.versions.set(versions);
      const kept = this.current()?.projectId === projectId ? this.current()?.id : undefined;
      // Par défaut : le brouillon s'il y en a un (c'est lui qui attend une action), sinon la version en vigueur.
      const target =
        show ?? kept ?? versions.find((v) => v.status === 'DRAFT')?.id ?? versions.find((v) => v.status === 'APPROVED')?.id ?? versions[0]?.id;
      const stillThere = versions.find((v) => v.id === target);
      this.current.set(stillThere && stillThere.projectId === projectId ? await this.api.getBudget(stillThere.id) : null);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger le budget.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
