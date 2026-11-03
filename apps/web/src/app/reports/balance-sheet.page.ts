import { Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type BalanceSheetInfo } from '../admin/admin-api.service';
import { ActionBar } from '../ui/action-bar';
import { NoPeriod } from '../ui/no-period';
import { ExportLink } from './export-link';
import { StatementPageBase } from './statement-page';
import { StatementGroups } from './statements';
import { Skeleton } from '../ui/skeleton';

/** Bilan : ce que l'association possède (actif) et d'où ça vient (passif), à la fin de l'exercice. */
@Component({
  selector: 'app-balance-sheet-page',
  imports: [Skeleton, NoPeriod, MatFormFieldModule, MatIconModule, MatSelectModule, ActionBar, ExportLink, StatementGroups],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-action-bar
      label="Bilan"
      [description]="simple()
        ? 'Une photo de l’association à la fin de la période : d’un côté ce qu’elle possède et ce qu’on lui doit (actif), de l’autre d’où cela vient : ses fonds propres, son résultat et ses dettes (passif). Les deux totaux doivent être égaux.'
        : 'Une photo de l’association à la fin de l’exercice : à gauche ce qu’elle possède et ce qu’on lui doit (actif), à droite d’où cela vient : ses fonds propres, son résultat et ses dettes (passif). Les deux totaux doivent être égaux.'"
    >
      @if (yearId()) {
        <app-export-link path="balance-sheet" [params]="{ fiscalYearId: yearId() }" [print]="true" />
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
    } @else if (data(); as sheet) {
      @if (sheet.carryWarning; as warning) {
        <p class="alert" role="status">{{ warning }}</p>
      }
      @if (sheet.draftEntries > 0) {
        <p class="muted" role="status">
          @if (simple()) {
            {{ sheet.draftEntries }} opération(s) en brouillon ne sont pas comptées : enregistrez-les définitivement pour qu'elles y figurent.
          } @else {
            {{ sheet.draftEntries }} brouillon(s) d'écriture ne sont pas pris en compte : comptabilisez-les pour qu'ils y figurent.
          }
        </p>
      }
      @if (!sheet.balanced) {
        <p class="alert" role="alert">
          L'actif et le passif ne sont pas égaux (écart de {{ amount(sheet.difference) }} €).
          @if (sheet.unclassified.length > 0) {
            {{ simple() ? 'Certains postes ne sont rangés dans aucune rubrique (à montrer à votre expert-comptable) :' : 'Des comptes de classe 8 ne rentrent dans aucune rubrique :' }}
            @for (account of sheet.unclassified; track account.number) {
              <span>{{ account.number }} {{ account.label }} ({{ amount(account.amount) }}) ; </span>
            }
          }
        </p>
      } @else {
        <p class="success" role="status">Le bilan est équilibré : l'actif égale le passif ({{ amount(sheet.totalAssets) }} €).</p>
      }
      @if (!sheet.previous) {
        <p class="muted">{{ simple() ? 'Il n’y a pas de période précédente : la colonne de comparaison est absente.' : 'Aucun exercice précédent : la colonne de comparaison est absente.' }}</p>
      }
      <section class="panel">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_balance_wallet</mat-icon><span>Actif</span></h3>
        <app-statement-groups caption="Actif" [groups]="sheet.assets" [yearLabel]="sheet.fiscalYear.label" [previousLabel]="sheet.previous?.label ?? null" />
        <p class="total-line"><strong>Total de l'actif : {{ amount(sheet.totalAssets) }} €</strong>@if (sheet.previousTotalAssets !== null) { <span class="muted"> (précédent : {{ amount(sheet.previousTotalAssets) }} €)</span> }</p>
      </section>
      <section class="panel">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">savings</mat-icon><span>Passif</span></h3>
        <app-statement-groups caption="Passif" [groups]="sheet.liabilities" [yearLabel]="sheet.fiscalYear.label" [previousLabel]="sheet.previous?.label ?? null" />
        <p class="total-line"><strong>Total du passif : {{ amount(sheet.totalLiabilities) }} €</strong>@if (sheet.previousTotalLiabilities !== null) { <span class="muted"> (précédent : {{ amount(sheet.previousTotalLiabilities) }} €)</span> }</p>
      </section>
    }
  `,
})
export class BalanceSheetPage extends StatementPageBase<BalanceSheetInfo> {
  protected readonly api = inject(AdminApiService);
  protected readonly amount = formatApiAmount;

  constructor() {
    super();
    void this.init();
  }

  protected fetch(fiscalYearId: string): Promise<BalanceSheetInfo> {
    return this.api.balanceSheet(fiscalYearId);
  }
}
