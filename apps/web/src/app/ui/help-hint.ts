import { Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { GLOSSARY, type GlossaryKey } from './glossary';

/**
 * Aide contextuelle (#12) : une icône « ? » qui déplie, juste en dessous, la définition du terme et un exemple, avec un lien vers le
 * lexique. Dépliage au clic ou au clavier (Entrée, Espace), refermable par Échap : jamais une info-bulle seule, qui ne se lit ni au
 * clavier ni sur téléphone. Le mot comptable est donné à côté, pour s'y retrouver face à un expert.
 *
 * <app-help-hint term="brouillon" />
 */
@Component({
  selector: 'app-help-hint',
  imports: [MatIconModule, RouterLink],
  styles: `
    :host {
      display: inline;
    }
    .toggle {
      background: none;
      border: 0;
      border-radius: 50%;
      color: var(--mat-sys-primary);
      cursor: pointer;
      line-height: 1;
      padding: 2px;
      vertical-align: middle;
    }
    /* Sur téléphone, la zone de toucher grandit (marge négative : la ligne de texte ne bouge pas). */
    @media (max-width: 600px) {
      .toggle {
        margin: -8px -6px;
        padding: 8px;
      }
    }
    .toggle mat-icon {
      font-size: 18px;
      height: 18px;
      width: 18px;
    }
    .panel {
      background: var(--app-surface-variant, var(--mat-sys-surface-container));
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: block;
      font: var(--mat-sys-body-small);
      font-weight: normal;
      margin: 6px 0;
      max-width: 52ch;
      padding: 8px 12px;
      text-align: left;
      white-space: normal;
    }
    .panel p {
      margin: 0 0 4px;
    }
  `,
  template: `
    <button
      type="button"
      class="toggle"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="'Aide : ' + entry().simple"
      (click)="open.set(!open())"
      (keydown.escape)="open.set(false)"
    >
      <mat-icon fontSet="material-icons-outlined" aria-hidden="true">help_outline</mat-icon>
    </button>
    @if (open()) {
      <span class="panel" role="note" (keydown.escape)="open.set(false)">
        <p>
          <strong>{{ entry().simple }}</strong
          >@if (accountingWord(); as word) { <span class="muted"> — en comptabilité : {{ word }}</span> }
        </p>
        <p>{{ entry().definition }}</p>
        <p class="muted">Exemple : {{ entry().example }}</p>
        <a routerLink="/aide" [fragment]="term()">Voir dans le lexique</a>
      </span>
    }
  `,
})
export class HelpHint {
  readonly term = input.required<GlossaryKey>();
  protected readonly open = signal(false);
  protected readonly entry = computed(() => GLOSSARY[this.term()]);
  /** Le mot comptable, quand il existe : il servira face à l'expert-comptable. */
  protected readonly accountingWord = computed(() => ('accounting' in this.entry() ? (this.entry() as { accounting: string }).accounting : null));
}
