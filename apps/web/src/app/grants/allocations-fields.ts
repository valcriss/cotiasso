import { Component, effect, input, signal } from '@angular/core';
import { FormArray, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { startWith } from 'rxjs';
import type { ProjectInfo } from '../admin/admin-api.service';
import { formatCents } from '../accounting/amount';
import { allocationTotalCents, newAllocationRow, type AllocationRow } from './allocation-rows';

/**
 * Répartition d'une subvention entre des projets : un projet et sa part par ligne, avec le total en direct. À l'accord, la
 * somme des parts doit égaler exactement le montant accordé ; avant, elle reste libre.
 */
@Component({
  selector: 'app-allocations-fields',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styles: `
    .line {
      border: 1px solid var(--app-border);
      border-radius: 4px;
      padding: 12px 12px 0;
      margin-bottom: 12px;
    }
    .line-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .summary {
      font-variant-numeric: tabular-nums;
      margin: 8px 0 0;
    }
  `,
  template: `
    @for (row of rows().controls; track row; let index = $index) {
      <div class="line" [formGroup]="row" role="group" [attr.aria-label]="'Part ' + (index + 1)">
        <div class="line-head">
          <strong>Projet {{ index + 1 }}</strong>
          <button mat-button type="button" (click)="remove(index)" [attr.aria-label]="'Retirer la part ' + (index + 1)">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">delete</mat-icon> Retirer
          </button>
        </div>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Projet financé</mat-label>
            <mat-select formControlName="projectId" required>
              @for (project of projects(); track project.id) {
                <mat-option [value]="project.id" [disabled]="usedElsewhere(row, project.id)">{{ project.code }} — {{ project.name }}</mat-option>
              }
            </mat-select>
            @if (row.controls.projectId.hasError('required')) {
              <mat-error>Choisissez le projet que cette part finance.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Part (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" placeholder="600,00" autocomplete="off" required />
            @if (row.controls.amount.hasError('required') || row.controls.amount.hasError('amount')) {
              <mat-error>Saisissez un montant positif, par exemple 600 ou 120,50.</mat-error>
            }
          </mat-form-field>
        </div>
      </div>
    }
    @if (rows().length === 0) {
      <p class="muted">Aucun projet pour l'instant. Ajoutez le ou les projets que cette subvention finance.</p>
    }
    <div>
      <button mat-stroked-button type="button" (click)="add()">
        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter un projet
      </button>
    </div>
    <p class="summary" aria-live="polite">
      Total réparti : <strong>{{ format(total()) }} €</strong>
      @if (target(); as goal) {
        · {{ goal.label }} : <strong>{{ format(goal.cents) }} €</strong> ·
        @if (total() === goal.cents) {
          <strong>La répartition est complète.</strong>
        } @else if (total() < goal.cents) {
          <strong>Il reste {{ format(goal.cents - total()) }} € à répartir.</strong>
        } @else {
          <strong>La répartition dépasse de {{ format(total() - goal.cents) }} €.</strong>
        }
      }
    </p>
  `,
})
export class AllocationsFields {
  readonly rows = input.required<FormArray<AllocationRow>>();
  readonly projects = input.required<ProjectInfo[]>();
  /** Montant à atteindre (ex. le montant accordé), en centimes ; `null` tant qu'il n'y en a pas. */
  readonly target = input<{ label: string; cents: number } | null>(null);

  protected readonly total = signal(0);
  protected readonly format = formatCents;

  constructor() {
    effect((onCleanup) => {
      const rows = this.rows();
      const subscription = rows.valueChanges.pipe(startWith(null)).subscribe(() => this.total.set(allocationTotalCents(rows)));
      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected add(): void {
    this.rows().push(newAllocationRow());
    this.rows().markAsDirty();
  }

  protected remove(index: number): void {
    this.rows().removeAt(index);
    this.rows().markAsDirty();
  }

  /** Un projet ne peut figurer qu'une fois : il est grisé dans les autres lignes. */
  protected usedElsewhere(current: AllocationRow, projectId: string): boolean {
    return this.rows().controls.some((row) => row !== current && row.controls.projectId.value === projectId);
  }
}
