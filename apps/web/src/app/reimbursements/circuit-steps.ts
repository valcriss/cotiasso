import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { ReimbursementStatus, ReimbursementStep } from './reimbursements-api';

interface Node {
  label: string;
  /** Texte lu par les lecteurs d'écran et affiché sous le nom de l'étape. */
  state: string;
  icon: string;
  kind: 'done' | 'current' | 'pending' | 'returned' | 'stopped';
}

const STATE_TEXT: Record<ReimbursementStep['state'], string> = {
  DONE: 'faite',
  AUTO: 'validée d’office',
  CURRENT: 'en attente',
  PENDING: 'à venir',
  RETURNED: 'a renvoyé la demande',
};

/**
 * Le chemin d'une demande, d'un coup d'œil : dépôt, puis chaque étape du circuit, puis le remboursement. Chaque étape dit où
 * elle en est avec un mot (pas seulement une couleur ni une icône). Sert de « schéma du circuit » sur la fiche d'une demande.
 */
@Component({
  selector: 'app-circuit-steps',
  imports: [MatIconModule],
  styles: `
    ol {
      align-items: stretch;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      align-items: center;
      background: var(--app-surface-muted);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: flex;
      flex: 1 1 140px;
      gap: 10px;
      min-width: 0;
      padding: 10px 12px;
    }
    li mat-icon {
      flex: none;
    }
    .label {
      display: block;
      font: var(--mat-sys-label-large);
    }
    .state {
      color: var(--mat-sys-on-surface-variant);
      display: block;
      font: var(--mat-sys-body-small);
    }
    .done mat-icon {
      color: var(--app-success);
    }
    .current {
      border-color: var(--mat-sys-primary);
    }
    .current mat-icon {
      color: var(--mat-sys-primary);
    }
    .returned mat-icon,
    .stopped mat-icon {
      color: var(--mat-sys-error);
    }
    .pending mat-icon {
      color: var(--mat-sys-outline);
    }
  `,
  template: `
    <ol aria-label="Étapes de la demande">
      @for (node of nodes(); track $index) {
        <li [class]="node.kind">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ node.icon }}</mat-icon>
          <span>
            <span class="label">{{ node.label }}</span>
            <span class="state">{{ node.state }}</span>
          </span>
        </li>
      }
    </ol>
  `,
})
export class CircuitSteps {
  readonly steps = input.required<ReimbursementStep[]>();
  readonly status = input.required<ReimbursementStatus>();

  protected readonly nodes = computed<Node[]>(() => {
    const status = this.status();
    const stopped = status === 'REFUSED' || status === 'CANCELLED';
    const start: Node = { label: 'Demande déposée', state: status === 'DRAFT' ? 'pas encore' : 'faite', icon: status === 'DRAFT' ? 'radio_button_unchecked' : 'check_circle', kind: status === 'DRAFT' ? 'pending' : 'done' };
    const middle = this.steps().map<Node>((step) => {
      const kind: Node['kind'] = step.state === 'DONE' || step.state === 'AUTO' ? 'done' : step.state === 'CURRENT' ? 'current' : step.state === 'RETURNED' ? 'returned' : 'pending';
      const icon = kind === 'done' ? 'check_circle' : kind === 'current' ? 'hourglass_top' : kind === 'returned' ? 'undo' : 'radio_button_unchecked';
      return { label: step.label, state: STATE_TEXT[step.state], icon, kind };
    });
    const end: Node =
      status === 'PAID'
        ? { label: 'Remboursée', state: 'faite', icon: 'check_circle', kind: 'done' }
        : stopped
          ? { label: status === 'REFUSED' ? 'Refusée' : 'Annulée', state: 'terminée', icon: 'block', kind: 'stopped' }
          : { label: 'Remboursée', state: 'à venir', icon: 'radio_button_unchecked', kind: 'pending' };
    return [start, ...middle, end];
  });
}
