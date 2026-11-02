import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AdminApiService, type FinancialAccountInfo, type FiscalYearInfo, type OverviewInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { PageHeader } from '../ui/page-header';
import { StartAccountDialog, StartYearDialog, type StartAccountDialogData } from './start-dialogs';

interface Step {
  key: 'year' | 'categories' | 'account';
  title: string;
  why: string;
  done: boolean;
  /** Une étape ne se débloque qu'une fois la précédente faite : on ne propose jamais une action impossible. */
  locked: boolean;
}

/**
 * Assistant de démarrage (ADR 0028) : les quelques réglages sans lesquels rien ne peut s'enregistrer, dans l'ordre et en
 * langage courant. Réservé à l'administration de la comptabilité ; chaque étape se rejoue sans risque.
 */
@Component({
  selector: 'app-start-page',
  imports: [MatButtonModule, MatIconModule, RouterLink, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    ol.steps {
      display: flex;
      flex-direction: column;
      gap: 16px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    ol.steps li {
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      box-shadow: var(--app-shadow-sm);
      display: flex;
      gap: 16px;
      padding: 20px 28px;
    }
    ol.steps li.locked {
      opacity: 0.6;
    }
    ol.steps .mark {
      color: var(--mat-sys-primary);
      flex: none;
    }
    ol.steps .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
    }
    ol.steps h3 {
      font: var(--mat-sys-title-medium);
      margin: 0;
    }
    ol.steps p {
      margin: 0;
    }
    .actions {
      margin-top: 6px;
    }
  `,
  template: `
    <app-page-header
      title="Démarrer"
      icon="rocket_launch"
      description="Trois étapes pour préparer votre association : la période de vos comptes, des catégories prêtes à l’emploi, puis votre compte bancaire. Aucune connaissance en comptabilité n’est nécessaire."
    />

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (overview(); as view) {
      <ol class="steps">
        @for (step of steps(); track step.key; let index = $index) {
          <li [class.locked]="step.locked">
            <mat-icon class="mark" fontSet="material-icons-outlined" aria-hidden="true">{{ step.done ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
            <div class="text">
              <h3>{{ index + 1 }}. {{ step.title }} @if (step.done) { <span class="chip">Fait</span> }</h3>
              <p class="muted">{{ step.why }}</p>
              @if (!step.done) {
                <div class="actions">
                  <button mat-flat-button type="button" [disabled]="step.locked || busy()" (click)="run(step.key)">
                    {{ label(step.key) }}
                  </button>
                  @if (step.locked) {
                    <span class="muted"> Terminez d’abord l’étape précédente.</span>
                  }
                </div>
              } @else if (step.key === 'account') {
                <div class="actions">
                  <button mat-stroked-button type="button" [disabled]="busy()" (click)="run('account')">Ajouter un autre compte</button>
                </div>
              }
            </div>
          </li>
        }
      </ol>

      @if (allDone()) {
        <section class="panel" aria-label="Tout est prêt">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">celebration</mat-icon><span>Tout est prêt</span></h3>
          <p>
            Vous pouvez maintenant enregistrer vos premières opérations. Depuis la vue d’ensemble, « J’ai reçu de l’argent » et « J’ai dépensé
            de l’argent » s’occupent de la comptabilité à votre place.
          </p>
          <a mat-flat-button routerLink="/vue-d-ensemble">Aller à la vue d’ensemble</a>
        </section>
      }
    } @else if (!error()) {
      <p class="muted">Chargement…</p>
    }
  `,
})
export class StartPage {
  private readonly api = inject(AdminApiService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly overview = signal<OverviewInfo | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  private accounts: FinancialAccountInfo[] = [];

  protected readonly steps = computed<Step[]>(() => {
    const setup = this.overview()?.setup;
    if (!setup) return [];
    return [
      {
        key: 'year',
        title: 'La période de votre comptabilité',
        why: 'Une association arrête ses comptes une fois par an. Indiquez le premier et le dernier jour de la période (souvent l’année civile).',
        done: setup.fiscalYear,
        locked: false,
      },
      {
        key: 'categories',
        title: 'Les catégories de départ',
        why: 'Des catégories en mots simples (« cotisation », « assurance », « don »…) pour classer l’argent reçu et dépensé. C’est une proposition courante, à faire relire par votre expert-comptable si vous en avez un ; vous pourrez la modifier.',
        done: setup.categories,
        locked: !setup.fiscalYear,
      },
      {
        key: 'account',
        title: 'Votre compte bancaire',
        why: 'L’endroit où se trouve l’argent de l’association. Indiquez son nom et combien il y a dessus au départ ; ajoutez aussi la caisse si vous en avez une.',
        done: setup.financialAccount,
        locked: !setup.categories,
      },
    ];
  });
  protected readonly allDone = computed(() => this.steps().length > 0 && this.steps().every((s) => s.done));

  constructor() {
    void this.load();
  }

  protected label(key: Step['key']): string {
    return { year: 'Définir la période', categories: 'Installer les catégories', account: 'Ajouter mon compte' }[key];
  }

  protected async run(key: Step['key']): Promise<void> {
    this.error.set(null);
    if (key === 'year') {
      const created = await this.dialogs.open<FiscalYearInfo>(StartYearDialog, { size: 'md' });
      if (created) this.notifier.success(`Période enregistrée : ${created.label}.`);
    } else if (key === 'categories') {
      const confirmed = await this.dialogs.confirm({
        title: 'Installer les catégories de départ ?',
        message:
          'Le logiciel ajoute une quinzaine de catégories d’argent reçu et dépensé, et les comptes comptables correspondants. Rien n’est écrasé : si vous en avez déjà, elles sont conservées. Vous pourrez ensuite en ajouter, en renommer ou en désactiver dans Paramètres › Comptabilité.',
        confirmLabel: 'Installer',
      });
      if (!confirmed) return;
      this.busy.set(true);
      try {
        const result = await this.api.applyStarterTemplate();
        this.notifier.success(`${result.categoriesCreated} catégorie(s) installée(s).`);
      } catch (failure) {
        this.error.set(describeHttpError(failure, "Les catégories n'ont pas pu être installées. Réessayez dans un instant.").message);
        return;
      } finally {
        this.busy.set(false);
      }
    } else {
      const created = await this.dialogs.open<FinancialAccountInfo, StartAccountDialogData>(StartAccountDialog, { size: 'md', data: { existing: this.accounts } });
      if (created) this.notifier.success(`Compte « ${created.name} » ajouté.`);
    }
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [overview, accounts] = await Promise.all([this.api.overview(), this.api.listFinancialAccounts()]);
      this.accounts = accounts;
      this.overview.set(overview);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'assistant n'a pas pu être chargé. Rechargez la page dans un instant.").message);
    }
  }
}
