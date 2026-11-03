import { Component, computed, inject, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { GLOSSARY, type GlossaryEntry, type GlossaryKey } from '../ui/glossary';
import { PageHeader } from '../ui/page-header';

interface HowTo {
  title: string;
  steps: string[];
  link: string;
  linkLabel: string;
}

/** Les cinq gestes qui reviennent le plus souvent, expliqués pas à pas. */
const HOW_TO: HowTo[] = [
  {
    title: 'Enregistrer une dépense',
    steps: ['Cliquez sur « J’ai dépensé de l’argent » (vue d’ensemble ou page Comptes).', 'Choisissez le compte, le montant, la date et ce à quoi l’argent a servi.', 'Joignez la facture en photo si vous l’avez, puis enregistrez.'],
    link: '/comptes',
    linkLabel: 'Aller aux comptes',
  },
  {
    title: 'Importer le relevé de la banque',
    steps: ['Téléchargez sur le site de votre banque le relevé au format OFX.', 'Sur la page Comptes, cliquez sur « Importer le relevé de ma banque » et déposez le fichier.', 'Vérifiez les lignes proposées, puis confirmez : rien n’est enregistré avant.'],
    link: '/comptes',
    linkLabel: 'Aller aux comptes',
  },
  {
    title: 'Enregistrer une cotisation',
    steps: ['Cliquez sur « J’ai reçu de l’argent » et choisissez la catégorie « Cotisations ».', 'Cherchez le membre : sa cotisation est proposée, avec le montant restant dû.', 'Enregistrez : l’argent est noté et la cotisation marquée payée.'],
    link: '/membres',
    linkLabel: 'Voir les membres',
  },
  {
    title: 'Préparer l’assemblée générale',
    steps: ['Classez et enregistrez tous les mouvements de la période.', 'Comparez chaque compte au relevé de la banque.', 'Ouvrez Rapports : le compte de résultat et le bilan sont prêts à imprimer.'],
    link: '/rapports',
    linkLabel: 'Ouvrir les rapports',
  },
  {
    title: 'Clôturer la période',
    steps: ['Vérifiez qu’aucun mouvement ne reste à classer ni en brouillon.', 'Dans Paramètres › Comptabilité, fermez la saisie de la période, puis clôturez-la.', 'Les comptes sont alors arrêtés et reportés sur la période suivante.'],
    link: '/parametres',
    linkLabel: 'Ouvrir les paramètres',
  },
];

/** Aide et lexique (#12) : comment faire les gestes courants, et ce que veulent dire les mots de l'application. */
@Component({
  selector: 'app-help-page',
  imports: [MatFormFieldModule, MatIconModule, MatInputModule, RouterLink, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    dl.glossary {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
    }
    dl.glossary dt {
      font-weight: 500;
    }
    dl.glossary dd {
      margin: 2px 0 0;
    }
    ol.steps {
      margin: 4px 0 8px;
      padding-left: 20px;
    }
  `,
  template: `
    <app-page-header
      title="Aide et lexique"
      icon="help_outline"
      description="Comment faire les gestes courants pas à pas, et ce que veulent dire les mots de l’application. Chaque mot comptable est expliqué en langage courant."
    />

    <section class="panel" aria-label="Comment faire pour…">
      <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">checklist</mat-icon><span>Comment faire pour…</span></h3>
      @for (howTo of howTo; track howTo.title) {
        <details>
          <summary><strong>{{ howTo.title }}</strong></summary>
          <ol class="steps">
            @for (step of howTo.steps; track step) {
              <li>{{ step }}</li>
            }
          </ol>
          <a [routerLink]="howTo.link">{{ howTo.linkLabel }}</a>
        </details>
      }
    </section>

    <section class="panel" aria-label="Lexique">
      <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">menu_book</mat-icon><span>Lexique</span></h3>
      <mat-form-field appearance="outline">
        <mat-label>Chercher un mot</mat-label>
        <input matInput [value]="query()" (input)="query.set($any($event.target).value)" autocomplete="off" />
      </mat-form-field>
      @if (entries().length === 0) {
        <p class="muted" role="status">Aucun mot ne correspond à « {{ query() }} ». Essayez une autre orthographe, ou effacez la recherche.</p>
      } @else {
        <dl class="glossary">
          @for (item of entries(); track item.key) {
            <div [id]="item.key">
              <dt>
                {{ item.entry.simple }}
                @if (item.entry.accounting; as accounting) { <span class="muted"> — en comptabilité : {{ accounting }}</span> }
              </dt>
              <dd>{{ item.entry.definition }}</dd>
              <dd class="muted">Exemple : {{ item.entry.example }}</dd>
            </div>
          }
        </dl>
      }
    </section>
  `,
})
export class HelpPage {
  protected readonly howTo = HOW_TO;
  protected readonly query = signal('');

  /** Mots filtrés par la recherche (sans tenir compte de la casse ni des accents), dans l'ordre alphabétique. */
  protected readonly entries = computed(() => {
    const wanted = normalize(this.query());
    return (Object.entries(GLOSSARY) as [GlossaryKey, GlossaryEntry][])
      .map(([key, entry]) => ({ key, entry }))
      .filter(({ entry }) => !wanted || normalize(`${entry.simple} ${'accounting' in entry ? entry.accounting : ''} ${entry.definition}`).includes(wanted))
      .sort((a, b) => a.entry.simple.localeCompare(b.entry.simple, 'fr'));
  });
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
