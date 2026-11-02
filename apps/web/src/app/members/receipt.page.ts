import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type ReceiptInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { PageHeader } from '../ui/page-header';

/** Reçu simple d'une adhésion, imprimable. Il récapitule les règlements ; il n'est jamais un reçu fiscal. */
@Component({
  selector: 'app-receipt-page',
  imports: [RouterLink, MatButtonModule, MatIconModule, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .notice {
      border-left: 4px solid var(--mat-sys-outline);
      margin: 16px 0 0;
      padding: 4px 12px;
    }
  `,
  template: `
    <app-page-header
      title="Reçu de cotisation"
      icon="receipt_long"
      description="Un récapitulatif simple de ce qui a été payé pour une adhésion. Imprimez-le ou enregistrez-le en PDF pour le remettre au membre."
    >
      <a mat-stroked-button routerLink="/membres/campagnes">
        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">arrow_back</mat-icon> Retour aux campagnes
      </a>
      @if (receipt()) {
        <button mat-flat-button type="button" (click)="print()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">print</mat-icon> Imprimer / enregistrer en PDF
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @if (receipt(); as r) {
      <section class="panel" aria-label="Reçu">
        <h3>{{ r.association.name }}</h3>
        @if (r.association.address || r.association.city) {
          <p class="muted">{{ r.association.address }} {{ r.association.postalCode }} {{ r.association.city }}</p>
        }
        <p>
          Reçu de <strong>{{ r.member }}</strong> pour l'adhésion « {{ r.campaign.name }} » (du {{ r.campaign.startsOn }} au {{ r.campaign.endsOn }}).
        </p>
        <table class="table">
          <caption class="sr-only">Règlements</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Nature</th>
              <th scope="col" class="amount">Montant</th>
            </tr>
          </thead>
          <tbody>
            @for (payment of r.payments; track $index) {
              <tr>
                <td>{{ payment.date }}</td>
                <td>{{ payment.kind === 'REFUND' ? 'Remboursement' : 'Règlement' }}</td>
                <td class="amount">{{ payment.kind === 'REFUND' ? '−' : '' }}{{ amount(payment.amount) }} €</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colspan="2">Total reçu</th>
              <td class="amount"><strong>{{ amount(r.paid) }} €</strong></td>
            </tr>
          </tfoot>
        </table>
        <p>
          Cotisation attendue : {{ amount(r.expectedAmount) }} € ·
          @if (Number(r.balance) > 0) { reste dû : {{ amount(r.balance) }} € } @else if (Number(r.balance) < 0) { trop-perçu : {{ amount(r.balance.replace('-', '')) }} € } @else { cotisation réglée }
        </p>
        <p class="muted">Établi le {{ r.issuedOn }}.</p>
        <p class="notice">{{ r.notice }}</p>
      </section>
    }
  `,
})
export class ReceiptPage {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly receipt = signal<ReceiptInfo | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;
  protected readonly Number = Number;

  constructor() {
    void this.load();
  }

  protected print(): void {
    window.print();
  }

  private async load(): Promise<void> {
    try {
      this.receipt.set(await this.api.receipt(this.route.snapshot.paramMap.get('id') ?? ''));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger le reçu.').message);
    }
  }
}
