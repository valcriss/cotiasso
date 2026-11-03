import { Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatEuroAmount, parseAmountToCents } from '../accounting/amount';
import type { GrantFinanceInfo, GrantInfo } from '../admin/admin-api.service';

export type ProgressAction = 'allocate' | 'decide' | 'close';

interface Step {
  label: string;
  state: 'done' | 'current' | 'todo';
}

interface Next {
  text: string;
  action?: { key: ProgressAction; label: string };
}

const STEPS = ['Demandée', 'Accordée', 'Argent reçu', 'Dépenses justifiées', 'Clôturée'];

/**
 * Frise d'avancement d'une subvention (#22) : où en est le dossier, et surtout **ce qu'il reste à faire** avec un bouton pour la
 * prochaine étape. Tout est lu dans l'état de la subvention et dans son suivi financier (reçu, dépensé) : aucune règle ici.
 */
@Component({
  selector: 'app-grant-progress',
  imports: [MatButtonModule, MatIconModule],
  styles: `
    ol {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 20px;
      list-style: none;
      margin: 8px 0;
      padding: 0;
    }
    li {
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      gap: 6px;
    }
    li.current {
      color: var(--mat-sys-on-surface);
      font-weight: 600;
    }
    li.done mat-icon {
      color: var(--app-success, var(--mat-sys-primary));
    }
    li.current mat-icon {
      color: var(--mat-sys-primary);
    }
    .next {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin: 4px 0 12px;
    }
  `,
  template: `
    @if (steps(); as list) {
      <ol aria-label="Avancement de la subvention">
        @for (step of list; track step.label) {
          <li [class]="step.state" [attr.aria-current]="step.state === 'current' ? 'step' : null">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ icon(step) }}</mat-icon>
            <span>{{ step.label }}</span>
            <span class="sr-only">{{ step.state === 'done' ? '(fait)' : step.state === 'current' ? '(étape en cours)' : '(à venir)' }}</span>
          </li>
        }
      </ol>
      @if (next(); as todo) {
        <p class="next" role="status">
          <span>{{ todo.text }}</span>
          @if (todo.action && canManage()) {
            <button mat-stroked-button type="button" (click)="act.emit(todo.action.key)">{{ todo.action.label }}</button>
          }
        </p>
      }
    }
  `,
})
export class GrantProgress {
  readonly grant = input.required<GrantInfo>();
  readonly canManage = input(false);
  /** Suivi financier déjà chargé par la page (reçu, dépensé) ; absent, la frise se limite à l'état du dossier. */
  readonly finance = input<GrantFinanceInfo | null>(null);
  readonly act = output<ProgressAction>();

  protected icon(step: Step): string {
    return step.state === 'done' ? 'check_circle' : step.state === 'current' ? 'radio_button_checked' : 'radio_button_unchecked';
  }

  private readonly stage = computed<number | null>(() => {
    const grant = this.grant();
    switch (grant.status) {
      case 'REQUESTED':
      case 'UNDER_REVIEW':
        return 0;
      case 'CLOSED':
        return 5;
      case 'GRANTED': {
        const finance = this.finance();
        if (!finance || finance.grantId !== grant.id) return 1;
        const granted = parseAmountToCents(finance.granted) ?? 0;
        const received = parseAmountToCents(finance.received) ?? 0;
        const spent = parseAmountToCents(finance.spent) ?? 0;
        if (received < granted) return 2;
        return spent < received ? 3 : 4;
      }
      default:
        return null; // refusée ou abandonnée : pas de frise
    }
  });

  protected readonly steps = computed<Step[] | null>(() => {
    const stage = this.stage();
    if (stage === null) return null;
    return STEPS.map((label, index) => ({ label, state: index < stage ? 'done' : index === stage ? 'current' : 'todo' }));
  });

  protected readonly next = computed<Next | null>(() => {
    const grant = this.grant();
    const finance = this.finance()?.grantId === grant.id ? this.finance() : null;
    switch (grant.status) {
      case 'REQUESTED':
      case 'UNDER_REVIEW':
        return grant.allocations.length === 0
          ? { text: 'Dites d’abord quels projets cette subvention finance, puis enregistrez la réponse du financeur.', action: { key: 'allocate', label: 'Choisir les projets financés' } }
          : { text: 'Le financeur a répondu ? Enregistrez sa décision.', action: { key: 'decide', label: 'Enregistrer l’accord' } };
      case 'GRANTED': {
        if (!finance) return { text: 'Subvention accordée : suivez les versements reçus puis les dépenses justifiées.' };
        const granted = parseAmountToCents(finance.granted) ?? 0;
        const received = parseAmountToCents(finance.received) ?? 0;
        const spent = parseAmountToCents(finance.spent) ?? 0;
        if (received < granted) {
          return { text: `${formatEuroAmount(finance.remaining ?? '0.00')} restent à recevoir. Enregistrez chaque versement dès qu’il arrive sur le compte.` };
        }
        if (spent < received) {
          return { text: `${formatEuroAmount(finance.residual)} reçus ne sont pas encore justifiés par des dépenses. Affectez les dépenses du projet à cette subvention.` };
        }
        return { text: 'Tout l’argent reçu est justifié par des dépenses : vous pouvez clôturer la subvention.', action: { key: 'close', label: 'Clôturer la subvention' } };
      }
      case 'CLOSED':
        return { text: 'Subvention terminée et clôturée.' };
      case 'REFUSED':
        return { text: 'Le financeur a refusé ce dossier : il reste ici avec son motif.' };
      default:
        return { text: 'Cette demande a été abandonnée : elle reste ici avec son motif.' };
    }
  });
}
