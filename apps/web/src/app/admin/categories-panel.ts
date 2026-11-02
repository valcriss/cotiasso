import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { AdminApiService, type AccountInfo, type OperationCategoryInfo } from './admin-api.service';
import { CategoryDialog, type CategoryDialogData } from './category-dialog';

/**
 * Paramètres › Comptabilité › Catégories d'opération (ADR 0028) : les mots que le trésorier voit en enregistrant de
 * l'argent reçu ou dépensé, et le compte du plan comptable qui se cache derrière chacun.
 */
@Component({
  selector: 'app-categories-panel',
  imports: [MatButtonModule, MatIconModule],
  styleUrl: './admin-pages.scss',
  template: `
    <section class="panel" aria-labelledby="cat-title">
      <div class="head">
        <h3 id="cat-title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">sell</mat-icon><span>Catégories d’opération</span></h3>
        @if (canEdit()) {
          <div class="actions">
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="installTemplate()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">auto_fix_high</mat-icon> Installer les catégories de départ
            </button>
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="edit(null)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouvelle catégorie
            </button>
          </div>
        }
      </div>
      <p class="muted">
        Ce sont les mots proposés quand on enregistre de l’argent reçu ou dépensé (« Cotisations », « Assurance »…). Chacune renvoie à un compte
        du plan comptable, indiqué en petit pour votre expert-comptable. Une catégorie ne se supprime pas : on la désactive.
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (categories().length === 0) {
        <p class="muted">
          Aucune catégorie pour l’instant.
          @if (canEdit()) {
            Commencez par « Installer les catégories de départ » : une quinzaine de catégories courantes, prêtes à l’emploi, que vous pourrez modifier.
          }
        </p>
      } @else {
        <table class="table">
          <caption class="sr-only">Catégories d’opération</caption>
          <thead>
            <tr>
              <th scope="col">Catégorie</th>
              <th scope="col">Type</th>
              <th scope="col">Compte comptable</th>
              <th scope="col">État</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (category of categories(); track category.id) {
              <tr>
                <td>
                  {{ category.label }}
                  @if (category.hint) {
                    <div class="muted">{{ category.hint }}</div>
                  }
                </td>
                <td>{{ category.direction === 'IN' ? 'Argent reçu' : 'Argent dépensé' }}</td>
                <td class="muted">{{ category.account.number }} — {{ category.account.label }}</td>
                <td>{{ category.active ? 'Active' : 'Désactivée' }}</td>
                <td class="row-actions">
                  @if (canEdit()) {
                    <button mat-button type="button" [attr.aria-label]="'Modifier ' + category.label" (click)="edit(category)">Modifier</button>
                    <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="(category.active ? 'Désactiver ' : 'Réactiver ') + category.label" (click)="toggle(category)">
                      {{ category.active ? 'Désactiver' : 'Réactiver' }}
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class CategoriesPanel {
  private readonly api = inject(AdminApiService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  readonly canEdit = input.required<boolean>();
  /** Plan de comptes, pour choisir le compte d'une catégorie. */
  readonly accounts = input.required<AccountInfo[]>();
  /** Le plan de comptes a changé (modèle de démarrage installé) : la page parente le recharge. */
  readonly planChanged = output<void>();

  protected readonly categories = signal<OperationCategoryInfo[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly empty = computed(() => this.categories().length === 0);

  constructor() {
    void this.load();
  }

  protected async edit(category: OperationCategoryInfo | null): Promise<void> {
    const saved = await this.dialogs.open<OperationCategoryInfo, CategoryDialogData>(CategoryDialog, {
      size: 'md',
      data: { category, accounts: this.accounts() },
    });
    if (!saved) return;
    this.notifier.success(category ? `Catégorie « ${saved.label} » modifiée.` : `Catégorie « ${saved.label} » créée.`);
    await this.load();
  }

  protected async toggle(category: OperationCategoryInfo): Promise<void> {
    await this.run(async () => {
      await this.api.updateOperationCategory(category.id, { active: !category.active });
      this.notifier.success(category.active ? `« ${category.label} » n’est plus proposée.` : `« ${category.label} » est de nouveau proposée.`);
    });
  }

  protected async installTemplate(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Installer les catégories de départ ?',
      message:
        'Le logiciel ajoute les catégories courantes d’une association et les comptes comptables correspondants. Rien n’est écrasé ni dupliqué : ce qui existe déjà est conservé. C’est une proposition, à faire relire par votre expert-comptable.',
      confirmLabel: 'Installer',
    });
    if (!confirmed) return;
    await this.run(async () => {
      const result = await this.api.applyStarterTemplate();
      this.notifier.success(`${result.categoriesCreated} catégorie(s) et ${result.accountsCreated} compte(s) ajoutés.`);
      this.planChanged.emit();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      await this.load();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'opération n'a pas abouti. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.categories.set(await this.api.listOperationCategories(true));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Les catégories n’ont pas pu être chargées. Rechargez la page dans un instant.').message);
    }
  }
}
