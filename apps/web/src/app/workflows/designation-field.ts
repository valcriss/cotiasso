import { Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { designationText, type Lookups } from './circuit-model';
import type { Designation, DesignationKind } from './workflows-api';

const KIND_LABELS: Record<DesignationKind, string> = { USER: 'Une personne', ROLE: 'Un rôle', OFFICE: 'Une fonction du bureau' };

/**
 * Choix de qui peut décider d'une étape : des personnes, des rôles ou des fonctions du bureau, cumulables. Une seule des
 * personnes désignées suffit à décider. Les fonctions suivent les changements de bureau sans toucher au circuit.
 */
@Component({
  selector: 'app-designation-field',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule],
  styles: `
    ul {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      list-style: none;
      margin: 0 0 8px;
      padding: 0;
    }
    li {
      align-items: center;
      background: var(--app-surface-muted);
      border: 1px solid var(--app-border);
      border-radius: 16px;
      display: flex;
      gap: 2px;
      padding: 2px 4px 2px 12px;
    }
    li button {
      min-width: 0;
    }
    .add {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .add mat-form-field {
      flex: 1 1 180px;
    }
  `,
  template: `
    @if (value().length === 0) {
      <p class="muted">Personne n’est désigné pour l’instant.</p>
    } @else {
      <ul [attr.aria-label]="'Personnes désignées pour ' + label()">
        @for (designation of value(); track designation.kind + designation.id) {
          <li>
            <span>{{ text(designation) }}</span>
            <button mat-icon-button type="button" [attr.aria-label]="'Retirer ' + text(designation)" (click)="remove(designation)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">close</mat-icon>
            </button>
          </li>
        }
      </ul>
    }
    <div class="add">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Ajouter</mat-label>
        <mat-select [value]="kind()" (selectionChange)="kind.set($event.value)" [attr.aria-label]="'Type de désignation pour ' + label()">
          @for (option of kinds; track option.kind) {
            <mat-option [value]="option.kind">{{ option.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>{{ kindLabel() }}</mat-label>
        <mat-select [value]="''" (selectionChange)="add($event.value)" [attr.aria-label]="'Qui ajouter pour ' + label()">
          @for (option of options(); track option.id) {
            <mat-option [value]="option.id">{{ option.name }}</mat-option>
          }
        </mat-select>
        @if (options().length === 0) {
          <mat-hint>Rien à ajouter ici.</mat-hint>
        }
      </mat-form-field>
    </div>
  `,
})
export class DesignationField {
  readonly value = input.required<Designation[]>();
  readonly lookups = input.required<Lookups>();
  /** Nom de l'étape, pour les libellés lus par les lecteurs d'écran. */
  readonly label = input<string>('cette étape');
  readonly valueChange = output<Designation[]>();

  protected readonly kinds = (Object.keys(KIND_LABELS) as DesignationKind[]).map((kind) => ({ kind, label: KIND_LABELS[kind] }));
  protected readonly kind = signal<DesignationKind>('OFFICE');
  protected readonly kindLabel = computed(() => KIND_LABELS[this.kind()]);

  /** Ce qu'on peut encore ajouter pour le type choisi (sans doublon). */
  protected readonly options = computed(() => {
    const source = this.kind() === 'USER' ? this.lookups().users : this.kind() === 'ROLE' ? this.lookups().roles : this.lookups().offices;
    const taken = new Set(this.value().filter((d) => d.kind === this.kind()).map((d) => d.id));
    return [...source.entries()].filter(([id]) => !taken.has(id)).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  });

  protected text(designation: Designation): string {
    return designationText(designation, this.lookups());
  }

  protected add(id: string): void {
    if (id) this.valueChange.emit([...this.value(), { kind: this.kind(), id }]);
  }

  protected remove(designation: Designation): void {
    this.valueChange.emit(this.value().filter((d) => !(d.kind === designation.kind && d.id === designation.id)));
  }
}
