import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AdminApiService, type FinancialAccountInfo, type FiscalYearInfo, type OpeningSituationInfo, type OverviewInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { PageHeader } from '../ui/page-header';
import { OpeningSituationDialog, type OpeningSituationDialogData } from './opening-situation-dialog';
import { StartAccountDialog, StartYearDialog, type StartAccountDialogData } from './start-dialogs';

interface Step {
  key: 'mode' | 'year' | 'categories' | 'account' | 'situation';
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
      description="Quelques étapes pour préparer votre association : comment vous commencez, la période de vos comptes, des catégories prêtes à l’emploi, votre compte bancaire et, si vous repartez de zéro, votre situation de départ. Aucune connaissance en comptabilité n’est nécessaire."
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
              @if (step.key === 'mode') {
                <div class="actions">
                  <button mat-flat-button type="button" [disabled]="busy() || view.setup.startMode === 'OPENING'" (click)="chooseMode('OPENING')">
                    Je pars d’une situation de départ
                  </button>
                  <button mat-stroked-button type="button" [disabled]="busy() || view.setup.startMode === 'HISTORY'" (click)="chooseMode('HISTORY')">
                    Je reprends mon historique
                  </button>
                </div>
              } @else if (step.key === 'situation' && view.setup.openingSituation === 'DRAFT') {
                <p class="alert" role="status">
                  La situation est préparée mais pas encore enregistrée dans les comptes : une personne autorisée à comptabiliser doit la valider
                  (Comptabilité › Écritures).
                </p>
              } @else if (!step.done) {
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
  /** Début du premier exercice : date de départ proposée aux comptes quand on repart d'une situation d'ouverture. */
  private defaultStart: string | null = null;

  protected readonly steps = computed<Step[]>(() => {
    const setup = this.overview()?.setup;
    if (!setup) return [];
    return [
      {
        key: 'mode',
        title: 'Comment commencez-vous ?',
        why:
          setup.startMode === 'OPENING'
            ? 'Vous repartez d’une situation de départ : l’argent que vous avez, ce qu’on vous doit et ce que vous devez à une date donnée. Vous n’avez pas à reprendre les anciens relevés.'
            : setup.startMode === 'HISTORY'
              ? 'Vous reprenez votre historique : vous importerez les relevés des périodes passées, mouvement par mouvement, depuis le début.'
              : 'Deux façons de commencer. « Situation de départ » : plus simple, recommandée si vous n’avez pas de relevés anciens à reprendre. « Historique » : vous importez vos relevés depuis la création de l’association. Vous pourrez changer d’avis tant que rien n’est engagé.',
        done: setup.startMode !== null,
        locked: false,
      },
      {
        key: 'year',
        title: 'La période de votre comptabilité',
        why: 'Une association arrête ses comptes une fois par an. Indiquez le premier et le dernier jour de la période (souvent l’année civile).',
        done: setup.fiscalYear,
        locked: setup.startMode === null && !setup.fiscalYear,
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
      ...(setup.startMode === 'OPENING'
        ? [
            {
              key: 'situation' as const,
              title: 'Votre situation de départ',
              why: 'L’argent que vous avez au départ, ce qu’on vous doit et ce que vous devez. Le logiciel calcule le reste, que vous confirmez : c’est le point de départ de vos comptes.',
              done: setup.openingSituation === 'POSTED',
              locked: !setup.financialAccount,
            },
          ]
        : []),
    ];
  });
  /** Le choix du mode ne bloque pas « Tout est prêt » : une installation déjà commencée avant ce choix reste utilisable. */
  protected readonly allDone = computed(() => {
    const steps = this.steps().filter((s) => s.key !== 'mode');
    return steps.length > 0 && steps.every((s) => s.done);
  });

  constructor() {
    void this.load();
  }

  protected label(key: Step['key']): string {
    return { mode: 'Choisir', year: 'Définir la période', categories: 'Installer les catégories', account: 'Ajouter mon compte', situation: 'Indiquer ma situation' }[key];
  }

  protected async chooseMode(mode: 'HISTORY' | 'OPENING'): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.api.setStartMode(mode);
      this.notifier.success(mode === 'OPENING' ? 'Vous repartez d’une situation de départ.' : 'Vous reprenez votre historique.');
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le choix n'a pas pu être enregistré. Réessayez dans un instant.").message);
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  protected async run(key: Step['key']): Promise<void> {
    this.error.set(null);
    if (key === 'situation') {
      let situation: OpeningSituationInfo;
      try {
        situation = await this.api.openingSituation();
      } catch (failure) {
        this.error.set(describeHttpError(failure, "La situation de départ n'a pas pu être chargée. Réessayez dans un instant.").message);
        return;
      }
      const result = await this.dialogs.open<{ posted: boolean }, OpeningSituationDialogData>(OpeningSituationDialog, { size: 'lg', data: { situation } });
      if (result) {
        this.notifier.success(result.posted ? 'Situation de départ enregistrée dans les comptes.' : 'Situation de départ préparée : elle reste à valider.');
      }
    } else if (key === 'year') {
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
      const created = await this.dialogs.open<FinancialAccountInfo, StartAccountDialogData>(StartAccountDialog, { size: 'md', data: { existing: this.accounts, defaultDate: this.defaultStart } });
      if (created) this.notifier.success(`Compte « ${created.name} » ajouté.`);
    }
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [overview, accounts, years] = await Promise.all([this.api.overview(), this.api.listFinancialAccounts(), this.api.listFiscalYears()]);
      this.accounts = accounts;
      this.defaultStart = overview.setup.startMode === 'OPENING' ? ([...years].map((y) => y.start).sort()[0] ?? null) : null;
      this.overview.set(overview);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'assistant n'a pas pu être chargé. Rechargez la page dans un instant.").message);
    }
  }
}
