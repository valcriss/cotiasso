import { Component, input } from '@angular/core';

/**
 * Barre d'action d'une section (design.md §2) : sert aux onglets d'une page qui n'ont pas leur propre en-tête. Une phrase
 * d'aide facultative à gauche, les boutons de la section à droite (un seul principal, plein ; les autres en contour).
 */
@Component({
  selector: 'app-action-bar',
  styles: `
    :host {
      display: block;
      margin: 0 0 16px;
    }
    .bar {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .help {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 0;
      max-width: 70ch;
    }
    /* Même barre d'outils que l'en-tête de page : une carte, boutons alignés à gauche. */
    .buttons {
      align-items: center;
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      box-shadow: var(--app-shadow-xs);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 14px 18px;
    }
    .buttons:empty {
      display: none;
    }
  `,
  template: `
    <div class="bar">
      @if (description()) {
        <p class="help">{{ description() }}</p>
      }
      <div class="buttons" role="group" [attr.aria-label]="label()">
        <ng-content />
      </div>
    </div>
  `,
})
export class ActionBar {
  readonly description = input<string>('');
  /** Nom de la barre pour les lecteurs d'écran (ex. « Actions des exercices »). */
  readonly label = input<string>('Actions');
}
