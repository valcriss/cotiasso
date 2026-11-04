import { Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

/**
 * Lien « Retour à la liste » d'une page de détail : toujours le premier bouton de la barre d'outils de la page, au même
 * endroit partout (design.md §2), pour qu'on sache comment revenir sans chercher.
 *
 * <app-back-link to="/projets" label="Retour aux projets" />
 */
@Component({
  selector: 'app-back-link',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  // L'hôte est un flex : le bouton prend la hauteur de la ligne, comme ses voisins directs dans la barre d'outils.
  styles: `
    :host {
      display: flex;
    }
    .back-link {
      flex: 1;
    }
  `,
  template: `
    <a mat-stroked-button class="back-link" [routerLink]="to()">
      <mat-icon fontSet="material-icons-outlined" aria-hidden="true">arrow_back</mat-icon> {{ label() }}
    </a>
  `,
})
export class BackLink {
  readonly to = input.required<string | unknown[]>();
  readonly label = input.required<string>();
}
