import { Component, effect, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { FiscalYearInfo } from '../admin/admin-api.service';
import { DateField } from '../ui/date-field';

export interface PeriodFilter {
  fiscalYearId: string;
  from: string;
  to: string;
}

/** Exercice par défaut d'un état : l'exercice ouvert le plus récent, sinon le dernier créé. */
export function defaultYear(years: readonly FiscalYearInfo[]): FiscalYearInfo | undefined {
  const open = years.filter((y) => y.status === 'OPEN');
  return (open.length > 0 ? open : years).at(-1);
}

/** Filtres communs aux états : exercice et période. Les filtres propres à un état se placent dans le contenu projeté. */
@Component({
  selector: 'app-report-filters',
  imports: [DateField, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <form class="panel filters" [formGroup]="form" (ngSubmit)="apply()">
      <mat-form-field appearance="outline">
        <mat-label>Exercice</mat-label>
        <mat-select formControlName="fiscalYearId">
          @for (year of years(); track year.id) {
            <mat-option [value]="year.id">{{ year.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <app-date-field label="Du" formControlName="from" />
      <app-date-field label="Au" formControlName="to" />
      <ng-content />
      <div class="actions">
        <button mat-flat-button type="submit" [disabled]="!form.getRawValue().fiscalYearId">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">search</mat-icon> Afficher
        </button>
      </div>
    </form>
  `,
})
export class ReportFilters {
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly years = input.required<FiscalYearInfo[]>();
  /** Émis au chargement (exercice par défaut) puis à chaque validation du formulaire. */
  readonly filtered = output<PeriodFilter>();

  protected readonly form = this.fb.group({ fiscalYearId: [''], from: [''], to: [''] });
  private initialised = false;

  constructor() {
    effect(() => {
      const years = this.years();
      if (this.initialised || years.length === 0) return;
      this.initialised = true;
      this.form.patchValue({ fiscalYearId: defaultYear(years)!.id });
      this.apply();
    });
  }

  protected apply(): void {
    this.filtered.emit(this.form.getRawValue());
  }
}
