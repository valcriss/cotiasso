import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../theme/theme.service';

/**
 * État vide « aucune période de comptabilité » (ADR 0028). En affichage simple, on parle de période et on mène à l'assistant
 * Démarrer (là où on la crée) ; en affichage comptable, on garde l'exercice et Paramètres › Comptabilité.
 */
@Component({
  selector: 'app-no-period',
  imports: [MatButtonModule, RouterLink],
  template: `
    @if (simple()) {
      <p class="muted">
        Aucune période de comptabilité n’est encore définie. Une période est l’année pour laquelle vous tenez vos comptes (souvent l’année civile).
        @if (canCreate()) {
          Elle se crée en quelques secondes dans l’assistant « Démarrer ».
        } @else {
          Demandez à la personne qui administre la comptabilité de la définir.
        }
      </p>
      @if (canCreate()) {
        <a mat-flat-button routerLink="/demarrage">Définir la période</a>
      }
    } @else {
      <p class="muted">Aucun exercice n'est encore créé : créez-le dans Paramètres › Comptabilité.</p>
    }
  `,
})
export class NoPeriod {
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  protected readonly canCreate = computed(() => this.auth.can('settings.accounting:admin'));
}
