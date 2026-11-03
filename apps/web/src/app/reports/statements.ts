import { Component, input } from '@angular/core';
import { formatEuroAmount } from '../accounting/amount';
import type { ComparedGroupInfo } from '../admin/admin-api.service';

/**
 * Groupes de rubriques d'un état de synthèse, avec la colonne de l'exercice précédent. Sans exercice précédent, la colonne
 * n'existe pas (jamais de zéros trompeurs).
 */
@Component({
  selector: 'app-statement-groups',
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .group-title th {
      background: var(--app-surface-variant, var(--mat-sys-surface-container-low));
      font-weight: 600;
    }
    .group-help {
      color: var(--mat-sys-on-surface-variant);
      font-weight: 400;
    }
    .total th,
    .total td {
      font-weight: 600;
    }
    .negative {
      color: var(--mat-sys-error);
    }
  `,
  template: `
    <table class="table">
      <caption class="sr-only">{{ caption() }}</caption>
      <thead>
        <tr>
          <th scope="col">Rubrique</th>
          <th scope="col" class="amount">{{ yearLabel() }}</th>
          @if (previousLabel(); as previous) {
            <th scope="col" class="amount">{{ previous }}</th>
          }
        </tr>
      </thead>
      @for (group of groups(); track group.code) {
        <tbody>
          <tr class="group-title">
            <th scope="colgroup" [attr.colspan]="previousLabel() ? 3 : 2">
              {{ group.label }}
              <div class="group-help">{{ group.help }}</div>
            </th>
          </tr>
          @for (row of group.rows; track row.code) {
            <tr>
              <td>{{ row.label }}</td>
              <td class="amount" [class.negative]="row.amount.startsWith('-')">{{ amount(row.amount) }}</td>
              @if (previousLabel()) {
                <td class="amount" [class.negative]="row.previous?.startsWith('-')">{{ row.previous === null ? '—' : amount(row.previous) }}</td>
              }
            </tr>
          }
          <tr class="total">
            <th scope="row">Total — {{ group.label }}</th>
            <td class="amount" [class.negative]="group.total.startsWith('-')">{{ amount(group.total) }}</td>
            @if (previousLabel()) {
              <td class="amount">{{ group.previousTotal === null ? '—' : amount(group.previousTotal) }}</td>
            }
          </tr>
        </tbody>
      }
      <ng-content select="tfoot" />
    </table>
  `,
})
export class StatementGroups {
  readonly groups = input.required<ComparedGroupInfo[]>();
  readonly caption = input('État de synthèse');
  readonly yearLabel = input.required<string>();
  /** Libellé de la colonne N−1, ou `null` quand il n'y a pas d'exercice précédent. */
  readonly previousLabel = input<string | null>(null);
  protected readonly amount = formatEuroAmount;
}
