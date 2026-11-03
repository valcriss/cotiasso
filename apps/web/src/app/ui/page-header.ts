import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * En-tête de page (design.md §2) : titre avec icône et une phrase qui explique à quoi sert la page. La barre d'action de
 * la page se projette dans une barre d'outils placée sous la carte du titre et de la description.
 *
 * <app-page-header title="Projets" icon="folder_open" description="…"><button …>Nouveau projet</button></app-page-header>
 */
@Component({
  selector: 'app-page-header',
  imports: [MatIconModule],
  styles: `
    :host {
      display: block;
      margin: 0 0 20px;
    }
    .page-header {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    /* En-tête : une carte avec le titre et la phrase qui explique la page. */
    .page-text {
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      box-shadow: var(--app-shadow-sm);
      min-width: 0;
      padding: 20px 28px;
    }
    h1 {
      align-items: center;
      display: flex;
      font: var(--mat-sys-headline-small);
      gap: 12px;
      margin: 0;
    }
    h1 mat-icon {
      color: var(--mat-sys-primary);
      font-size: 28px;
      height: 28px;
      width: 28px;
    }
    .description {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 6px 0 0;
    }
    /* Barre d'outils : une carte sous le titre, boutons alignés à gauche, le principal en premier. */
    .actions {
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
    .actions:empty {
      display: none;
    }
    /* Petit écran : les boutons se rangent en deux colonnes (règles des boutons dans app-ui.scss) au lieu de s'empiler un par ligne. */
    @media (max-width: 600px) {
      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 12px;
      }
    }
  `,
  template: `
    <header class="page-header">
      <div class="page-text">
        <h1>
          @if (icon()) {
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ icon() }}</mat-icon>
          }
          <span>{{ title() }}</span>
        </h1>
        @if (description()) {
          <p class="description">{{ description() }}</p>
        }
      </div>
      <div class="actions" role="group" [attr.aria-label]="'Actions de la page ' + title()">
        <ng-content />
      </div>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly description = input<string>('');
  readonly icon = input<string>('');
}
