import { Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { formatEuroAmount } from '../accounting/amount';
import { AdminApiService, type IncomeStatementInfo } from '../admin/admin-api.service';
import { ActionBar } from '../ui/action-bar';
import { NoPeriod } from '../ui/no-period';
import { ExportLink } from './export-link';
import { StatementPageBase } from './statement-page';
import { StatementGroups } from './statements';
import { Skeleton } from '../ui/skeleton';

/** Compte de résultat : ce que l'association a gagné et dépensé sur l'exercice, avec l'exercice précédent en regard. */
@Component({
  selector: 'app-income-statement-page',
  imports: [Skeleton, NoPeriod, MatFormFieldModule, MatIconModule, MatSelectModule, ActionBar, ExportLink, StatementGroups],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    tfoot .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
  `,
  template: `
    <app-action-bar
      label="Compte de résultat"
      [description]="simple()
        ? 'Ce que l’association a reçu (produits) et dépensé (charges) pendant la période. La différence est le résultat : un excédent si vous avez reçu plus que dépensé, un déficit sinon. Seules les opérations enregistrées dans les comptes sont comptées.'
        : 'Ce que l’association a gagné (produits) et dépensé (charges) pendant l’exercice. La différence est le résultat : un excédent si on a gagné plus qu’on n’a dépensé, un déficit sinon. Seules les écritures comptabilisées sont prises en compte.'"
    >
      @if (yearId()) {
        <app-export-link path="income-statement" [params]="{ fiscalYearId: yearId() }" [print]="true" />
      }
    </app-action-bar>
    <section class="panel filters">
      <mat-form-field appearance="outline">
        <mat-label>{{ simple() ? 'Période (exercice)' : 'Exercice' }}</mat-label>
        <mat-select [value]="yearId()" (selectionChange)="choose($event.value)">
          @for (year of years(); track year.id) {
            <mat-option [value]="year.id">{{ year.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </section>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @if (loading()) {
      <app-skeleton variant="table" />
    } @else if (years().length === 0) {
      <app-no-period />
    } @else if (data(); as statement) {
      @if (statement.draftEntries > 0) {
        <p class="muted" role="status">
          @if (simple()) {
            {{ statement.draftEntries }} opération(s) en brouillon ne sont pas comptées : enregistrez-les définitivement pour qu'elles y figurent.
          } @else {
            {{ statement.draftEntries }} brouillon(s) d'écriture ne sont pas pris en compte : comptabilisez-les pour qu'ils y figurent.
          }
        </p>
      }
      @if (statement.unclassified.length > 0) {
        <p class="alert" role="alert">
          @if (simple()) {
            {{ statement.unclassified.length }} poste(s) ne sont rangés dans aucune rubrique : cet état est incomplet. Montrez-le à votre expert-comptable.
          } @else {
            {{ statement.unclassified.length }} compte(s) ne rentrent dans aucune rubrique (classe 8) : cet état est incomplet.
          }
          @for (account of statement.unclassified; track account.number) {
            <span> {{ account.number }} {{ account.label }} ({{ amount(account.amount) }}) ; </span>
          }
        </p>
      }
      @if (!statement.previous) {
        <p class="muted">{{ simple() ? 'Il n’y a pas de période précédente : la colonne de comparaison est absente.' : 'Aucun exercice précédent : la colonne de comparaison est absente.' }}</p>
      }
      <section class="panel">
        <app-statement-groups
          caption="Compte de résultat"
          [groups]="statement.sections"
          [yearLabel]="statement.fiscalYear.label"
          [previousLabel]="statement.previous?.label ?? null"
        >
          <tfoot>
            @for (line of statement.intermediate; track line.code) {
              <tr>
                <th scope="row">{{ line.label }}</th>
                <td class="amount">{{ amount(line.amount) }}</td>
                @if (statement.previous) {
                  <td class="amount">{{ line.previous === null ? '—' : amount(line.previous) }}</td>
                }
              </tr>
            }
            <tr>
              <th scope="row">
                {{ simple() ? 'Résultat de la période' : 'Résultat de l’exercice' }}
                <div class="muted">{{ resultKind(statement.result) }}</div>
              </th>
              <td class="amount" [class.danger-text]="statement.result.startsWith('-')"><strong>{{ amount(statement.result) }}</strong></td>
              @if (statement.previous) {
                <td class="amount">{{ statement.previousResult === null ? '—' : amount(statement.previousResult) }}</td>
              }
            </tr>
          </tfoot>
        </app-statement-groups>
      </section>
      @if (statement.defaulted.length > 0) {
        <p class="muted">
          Ces comptes n'ont pas de rubrique choisie : ils sont rangés d'après leur numéro (classement par défaut, à faire relire par
          votre trésorier ou votre expert-comptable) :
          @for (account of statement.defaulted; track account.number) {
            <span>{{ account.number }} {{ account.label }}{{ $last ? '.' : ', ' }}</span>
          }
        </p>
      }
    }
  `,
})
export class IncomeStatementPage extends StatementPageBase<IncomeStatementInfo> {
  protected readonly api = inject(AdminApiService);
  protected readonly amount = formatEuroAmount;

  constructor() {
    super();
    void this.init();
  }

  protected fetch(fiscalYearId: string): Promise<IncomeStatementInfo> {
    return this.api.incomeStatement(fiscalYearId);
  }

  protected resultKind(result: string): string {
    const value = Number(result);
    return value > 0 ? 'Excédent : on a gagné plus qu\'on n\'a dépensé.' : value < 0 ? 'Déficit : on a dépensé plus qu\'on n\'a gagné.' : 'Équilibre : autant gagné que dépensé.';
  }
}
