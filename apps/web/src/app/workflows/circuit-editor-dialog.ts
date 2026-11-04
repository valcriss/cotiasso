import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { CircuitDiagram } from './circuit-diagram';
import { MAX_STEPS, newStepId, toDocument, toEditable, type EditableCircuit, type EditableStep, type Lookups } from './circuit-model';
import { DesignationField } from './designation-field';
import { WorkflowsApi, type Designation, type VersionView } from './workflows-api';

export interface CircuitEditorData {
  version: VersionView;
  lookups: Lookups;
}

/**
 * Modification d'un brouillon de circuit : qui donne son accord, dans quel ordre, puis qui rembourse. Le schéma en bas se met
 * à jour pendant la saisie. Rien ne change pour les demandes en cours tant que le brouillon n'est pas mis en vigueur.
 */
@Component({
  selector: 'app-circuit-editor-dialog',
  imports: [CircuitDiagram, DesignationField, FormDialog, FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule],
  styles: `
    fieldset {
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 12px 16px 16px;
    }
    legend {
      font: var(--mat-sys-title-small);
      padding: 0 6px;
    }
    .tools {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      justify-content: flex-end;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 8px 0 4px;
    }
  `,
  template: `
    <form (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="'Circuit de validation — version ' + data.version.number"
        description="Une demande de remboursement passe par chacune de ces étapes, dans l’ordre. À chaque étape, il suffit qu’une des personnes désignées décide. Cette version n’agit pas tant que vous ne l’avez pas mise en vigueur."
        submitLabel="Enregistrer le brouillon"
        [dirty]="dirty()"
        [busy]="busy()"
        [error]="error()"
      >
        @for (step of circuit().steps; track step.id; let i = $index) {
          <fieldset>
            <legend>Étape {{ i + 1 }} : accord</legend>
            <mat-form-field appearance="outline">
              <mat-label>Nom de l’étape</mat-label>
              <input matInput [value]="step.label" (input)="patch(i, { label: $any($event.target).value })" placeholder="Accord du président" />
            </mat-form-field>
            <div>
              <h3>Qui peut donner son accord ?</h3>
              <app-designation-field [value]="step.approvers" [lookups]="data.lookups" [label]="step.label || 'cette étape'" (valueChange)="patch(i, { approvers: $event })" />
            </div>
            <mat-checkbox [checked]="step.exempt" (change)="patch(i, { exempt: $event.checked })">Le demandeur est dispensé de cette étape s’il fait partie des personnes désignées</mat-checkbox>
            <div class="tools">
              <button mat-button type="button" [disabled]="i === 0" [attr.aria-label]="'Monter l’étape ' + (i + 1)" (click)="move(i, -1)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">arrow_upward</mat-icon> Monter
              </button>
              <button mat-button type="button" [disabled]="i === circuit().steps.length - 1" [attr.aria-label]="'Descendre l’étape ' + (i + 1)" (click)="move(i, 1)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">arrow_downward</mat-icon> Descendre
              </button>
              <button mat-button type="button" [attr.aria-label]="'Retirer l’étape ' + (i + 1)" (click)="remove(i)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">delete</mat-icon> Retirer
              </button>
            </div>
          </fieldset>
        }
        <div>
          <button mat-stroked-button type="button" [disabled]="circuit().steps.length >= max" (click)="add()">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une étape d’accord
          </button>
          @if (circuit().steps.length >= max) {
            <span class="muted"> Trois étapes d’accord au plus.</span>
          }
          @if (circuit().steps.length === 0) {
            <p class="muted">Sans étape d’accord, les demandes vont directement au remboursement.</p>
          }
        </div>

        <fieldset>
          <legend>Dernière étape : le remboursement</legend>
          <mat-form-field appearance="outline">
            <mat-label>Nom de l’étape</mat-label>
            <input matInput [value]="circuit().processing.label" (input)="patchProcessing({ label: $any($event.target).value })" placeholder="Remboursement par le trésorier" />
          </mat-form-field>
          <div>
            <h3>Qui peut rembourser ?</h3>
            <app-designation-field [value]="circuit().processing.approvers" [lookups]="data.lookups" label="le remboursement" (valueChange)="patchProcessing({ approvers: $event })" />
            <p class="muted">Ces personnes doivent aussi avoir le droit de saisir des opérations dans la comptabilité.</p>
          </div>
          <mat-checkbox [checked]="circuit().allowSelfProcessing" (change)="setSelf($event.checked)">
            Une personne peut rembourser sa propre demande (à cocher seulement si personne d’autre ne peut le faire)
          </mat-checkbox>
        </fieldset>

        <div>
          <h3>Aperçu du circuit</h3>
          <app-circuit-diagram [document]="preview()" [lookups]="data.lookups" />
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class CircuitEditorDialog {
  private readonly api = inject(WorkflowsApi);
  private readonly reference = inject<MatDialogRef<CircuitEditorDialog, VersionView>>(MatDialogRef);
  protected readonly data = inject<CircuitEditorData>(MAT_DIALOG_DATA);
  protected readonly max = MAX_STEPS;

  protected readonly circuit = signal<EditableCircuit>(toEditable(this.data.version.document));
  protected readonly preview = computed(() => toDocument(this.circuit()));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dirty = signal(false);

  protected patch(index: number, change: Partial<EditableStep>): void {
    this.update((c) => ({ ...c, steps: c.steps.map((s, i) => (i === index ? { ...s, ...change } : s)) }));
  }

  protected patchProcessing(change: { label?: string; approvers?: Designation[] }): void {
    this.update((c) => ({ ...c, processing: { ...c.processing, ...change } }));
  }

  protected setSelf(value: boolean): void {
    this.update((c) => ({ ...c, allowSelfProcessing: value }));
  }

  protected add(): void {
    this.update((c) => ({ ...c, steps: [...c.steps, { id: newStepId(c.steps), label: `Accord n° ${c.steps.length + 1}`, approvers: [], exempt: true }] }));
  }

  protected remove(index: number): void {
    this.update((c) => ({ ...c, steps: c.steps.filter((_, i) => i !== index) }));
  }

  protected move(index: number, direction: -1 | 1): void {
    this.update((c) => {
      const steps = [...c.steps];
      const target = index + direction;
      if (target < 0 || target >= steps.length) return c;
      [steps[index], steps[target]] = [steps[target]!, steps[index]!];
      return { ...c, steps };
    });
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.updateDraft(this.data.version.id, this.data.version.revision, this.preview()));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Le brouillon n’a pas pu être enregistré. Votre saisie est conservée : réessayez dans un instant.').message);
    } finally {
      this.busy.set(false);
    }
  }

  private update(change: (circuit: EditableCircuit) => EditableCircuit): void {
    this.circuit.update(change);
    this.dirty.set(true);
  }
}
