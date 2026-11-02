import { Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type TreasuryStatementInfo } from '../admin/admin-api.service';
import { ActionBar } from '../ui/action-bar';
import { ExportLink } from './export-link';
import { StatementPageBase } from './statement-page';

/** État de trésorerie : pour chaque compte de banque ou de caisse, d'où l'on part, ce qui est entré et sorti, où l'on arrive. */
@Component({
  selector: 'app-treasury-statement-page',
  imports: [MatFormFieldModule, MatIconModule, MatSelectModule, ActionBar, ExportLink],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-action-bar
      label="Actions de l'état de trésorerie"
      description="Pour chaque compte de banque ou de caisse : le solde au début de l'exercice, l'argent entré (encaissements), l'argent sorti (décaissements) et le solde à la fin. Un virement d'un de vos comptes à un autre apparaît comme une sortie d'un côté et une entrée de l'autre : ils s'annulent dans le total."
    >
      @if (yearId()) {
        <app-export-link path="treasury" [params]="{ fiscalYearId: yearId() }" [print]="true" />
      }
    </app-action-bar>
    <section class="panel filters">
      <mat-form-field appearance="outline">
        <mat-label>Exercice</mat-label>
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
      <p class="muted">Calcul en cours…</p>
    } @else if (years().length === 0) {
      <p class="muted">Aucun exercice n'est encore créé : créez-le dans Paramètres › Comptabilité.</p>
    } @else if (data(); as statement) {
      @if (statement.carryWarning; as warning) {
        <p class="alert" role="status">{{ warning }}</p>
      }
      @if (statement.draftEntries > 0) {
        <p class="muted" role="status">{{ statement.draftEntries }} brouillon(s) d'écriture ne sont pas pris en compte.</p>
      }
      @if (!statement.previous) {
        <p class="muted">Aucun exercice précédent : la colonne de comparaison est absente.</p>
      }
      @if (statement.rows.length === 0) {
        <section class="panel">
          <p class="muted">Aucun mouvement comptabilisé sur un compte de banque ou de caisse pour cet exercice.</p>
        </section>
      } @else {
        <section class="panel">
          <table class="table">
            <caption class="sr-only">État de trésorerie</caption>
            <thead>
              <tr>
                <th scope="col">Compte</th>
                <th scope="col" class="amount">Solde de départ</th>
                <th scope="col" class="amount">Encaissements</th>
                <th scope="col" class="amount">Décaissements</th>
                <th scope="col" class="amount">Solde de clôture</th>
                @if (statement.previous) {
                  <th scope="col" class="amount">Clôture {{ statement.previous.label }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of statement.rows; track row.number) {
                <tr>
                  <td>
                    {{ row.financialAccountName ?? row.label }}
                    <div class="muted">compte {{ row.number }}</div>
                  </td>
                  <td class="amount">{{ amount(row.opening) }}</td>
                  <td class="amount">{{ amount(row.receipts) }}</td>
                  <td class="amount">{{ amount(row.payments) }}</td>
                  <td class="amount"><strong>{{ amount(row.closing) }}</strong></td>
                  @if (statement.previous) {
                    <td class="amount">{{ row.previous ? amount(row.previous.closing) : '—' }}</td>
                  }
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td class="amount">{{ amount(statement.totals.opening) }}</td>
                <td class="amount">{{ amount(statement.totals.receipts) }}</td>
                <td class="amount">{{ amount(statement.totals.payments) }}</td>
                <td class="amount"><strong>{{ amount(statement.totals.closing) }}</strong></td>
                @if (statement.previous) {
                  <td class="amount">{{ statement.previousTotals ? amount(statement.previousTotals.closing) : '—' }}</td>
                }
              </tr>
            </tfoot>
          </table>
        </section>
      }
    }
  `,
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
  `,
})
export class TreasuryStatementPage extends StatementPageBase<TreasuryStatementInfo> {
  protected readonly api = inject(AdminApiService);
  protected readonly amount = formatApiAmount;

  constructor() {
    super();
    void this.init();
  }

  protected fetch(fiscalYearId: string): Promise<TreasuryStatementInfo> {
    return this.api.treasuryStatement(fiscalYearId);
  }
}
