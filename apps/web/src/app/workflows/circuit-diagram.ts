import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { toEditable, whoText, type Lookups } from './circuit-model';
import type { CircuitDocument } from './workflows-api';

interface Box {
  icon: string;
  title: string;
  who: string;
  note: string;
  kind: 'start' | 'approval' | 'processing' | 'end';
}

/**
 * Le schéma d'un circuit : le chemin d'une demande, du dépôt au remboursement, avec pour chaque étape qui peut décider.
 * C'est une liste ordonnée (lue dans l'ordre par les lecteurs d'écran) dessinée en blocs reliés par des flèches.
 */
@Component({
  selector: 'app-circuit-diagram',
  imports: [MatIconModule],
  styles: `
    ol {
      align-items: stretch;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      align-items: center;
      display: flex;
      flex: 1 1 170px;
      gap: 6px;
      min-width: 0;
    }
    .box {
      background: var(--app-surface-muted);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      flex: 1;
      min-width: 0;
      padding: 10px 12px;
    }
    .approval {
      border-color: var(--mat-sys-primary);
    }
    .title {
      align-items: center;
      display: flex;
      font: var(--mat-sys-label-large);
      gap: 6px;
    }
    .title mat-icon {
      color: var(--mat-sys-primary);
      font-size: 20px;
      height: 20px;
      width: 20px;
    }
    .who {
      display: block;
      font: var(--mat-sys-body-medium);
      margin-top: 4px;
      overflow-wrap: anywhere;
    }
    .note {
      color: var(--mat-sys-on-surface-variant);
      display: block;
      font: var(--mat-sys-body-small);
      margin-top: 2px;
    }
    .arrow {
      color: var(--mat-sys-outline);
      flex: none;
    }
    li:last-child .arrow {
      display: none;
    }
  `,
  template: `
    <ol aria-label="Étapes du circuit">
      @for (box of boxes(); track $index) {
        <li>
          <div class="box" [class]="'box ' + box.kind">
            <span class="title"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ box.icon }}</mat-icon>{{ box.title }}</span>
            <span class="who">{{ box.who }}</span>
            @if (box.note) {
              <span class="note">{{ box.note }}</span>
            }
          </div>
          <mat-icon class="arrow" fontSet="material-icons-outlined" aria-hidden="true">arrow_forward</mat-icon>
        </li>
      }
    </ol>
  `,
})
export class CircuitDiagram {
  readonly document = input.required<CircuitDocument>();
  readonly lookups = input.required<Lookups>();

  protected readonly boxes = computed<Box[]>(() => {
    const circuit = toEditable(this.document());
    const lookups = this.lookups();
    return [
      { icon: 'edit_note', title: 'Dépôt de la demande', who: 'Tout membre', note: 'Avec son justificatif.', kind: 'start' },
      ...circuit.steps.map<Box>((step) => ({
        icon: 'how_to_reg',
        title: step.label,
        who: whoText(step.approvers, lookups),
        note: step.exempt ? 'Une personne suffit. Le demandeur est dispensé de cette étape s’il en fait partie.' : 'Une personne suffit. Le demandeur ne peut pas valider sa propre demande.',
        kind: 'approval',
      })),
      {
        icon: 'payments',
        title: circuit.processing.label,
        who: whoText(circuit.processing.approvers, lookups),
        note: circuit.allowSelfProcessing ? 'Le demandeur peut traiter sa propre demande.' : 'Personne ne traite sa propre demande.',
        kind: 'processing',
      },
      { icon: 'check_circle', title: 'Remboursée', who: 'La demande est terminée.', note: '', kind: 'end' },
    ];
  });
}
