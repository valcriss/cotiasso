import { Component, computed, input } from '@angular/core';

/**
 * Squelette de chargement (#28) : la forme de ce qui arrive (tableau, cartes ou lignes de texte) à la place d'un « Chargement… »
 * brut, pour que la page ne saute pas à l'arrivée des données. Annoncé aux lecteurs d'écran par un texte masqué
 * (`role="status"`) ; l'animation s'arrête avec `prefers-reduced-motion`. Couleurs par jetons `--app-*` uniquement.
 *
 * <app-skeleton variant="table" [rows]="5" />
 */
@Component({
  selector: 'app-skeleton',
  styles: `
    :host {
      display: block;
      margin: 8px 0 16px;
    }
    .bar {
      animation: pulse 1.4s ease-in-out infinite;
      background: var(--app-border);
      border-radius: 4px;
      height: 14px;
    }
    .row {
      align-items: center;
      display: grid;
      gap: 16px;
      grid-template-columns: 1fr 3fr 1fr;
      padding: 12px 0;
    }
    .row + .row {
      border-top: 1px solid var(--app-border);
    }
    .cards {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .card {
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 20px;
    }
    .card .bar:first-child {
      height: 18px;
      width: 60%;
    }
    .card .bar:last-child {
      width: 40%;
    }
    @keyframes pulse {
      50% {
        opacity: 0.45;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bar {
        animation: none;
      }
    }
  `,
  template: `
    <div role="status">
      <span class="sr-only">Chargement…</span>
      @switch (variant()) {
        @case ('cards') {
          <div class="cards" aria-hidden="true">
            @for (item of items(); track item) {
              <div class="card"><span class="bar"></span><span class="bar"></span><span class="bar"></span></div>
            }
          </div>
        }
        @case ('text') {
          <div aria-hidden="true">
            @for (item of items(); track item) {
              <p class="bar" [style.width.%]="item % 2 === 0 ? 70 : 95"></p>
            }
          </div>
        }
        @default {
          <div aria-hidden="true">
            @for (item of items(); track item) {
              <div class="row"><span class="bar"></span><span class="bar"></span><span class="bar"></span></div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class Skeleton {
  readonly variant = input<'table' | 'cards' | 'text'>('table');
  readonly rows = input(4);
  protected readonly items = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}
