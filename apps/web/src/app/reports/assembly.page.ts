import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { defaultYear } from '../accounting/report-filters';
import { formatEuroAmount } from '../accounting/amount';
import {
  AdminApiService,
  type BalanceSheetInfo,
  type FiscalYearInfo,
  type GrantInfo,
  type IncomeStatementInfo,
  type TreasuryStatementInfo,
} from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { NoPeriod } from '../ui/no-period';
import { PageHeader } from '../ui/page-header';
import { Skeleton } from '../ui/skeleton';
import { StatementGroups } from './statements';

/**
 * Dossier de l'assemblée générale (#23) : les états de la période réunis en un seul document imprimable, avec un résumé en une
 * phrase. **Aucun calcul propre** : tout vient des services de rapports existants (compte de résultat, bilan, trésorerie) et de la
 * liste des subventions ; si la période n'est pas clôturée, le dossier est marqué provisoire. Aucune affirmation de conformité.
 */
@Component({
  selector: 'app-assembly-page',
  imports: [FrDatePipe, MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, NoPeriod, PageHeader, RouterLink, Skeleton, StatementGroups],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .sign {
      display: grid;
      gap: 32px;
      grid-template-columns: 1fr 1fr;
      margin-top: 24px;
    }
    .sign div {
      border-top: 1px solid var(--mat-sys-outline);
      padding-top: 6px;
    }
    .summary {
      font: var(--mat-sys-title-medium);
      margin: 0 0 8px;
    }
    @media print {
      .panel {
        break-inside: avoid-page;
      }
    }
  `,
  template: `
    <app-page-header
      title="Dossier de l’assemblée générale"
      icon="groups"
      description="Les comptes de la période réunis en un seul document à imprimer ou à enregistrer en PDF pour l’assemblée générale : le résumé, ce que l’association a reçu et dépensé, ce qu’elle possède et doit, l’argent sur les comptes et les subventions."
    >
      <button mat-flat-button type="button" [disabled]="!ready()" (click)="print()">
        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">print</mat-icon> Imprimer / enregistrer en PDF
      </button>
    </app-page-header>

    <section class="panel filters">
      <mat-form-field appearance="outline">
        <mat-label>Période</mat-label>
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
    } @else if (income(); as incomeStatement) {
      @let balance = sheet()!;
      @let cash = treasury()!;
      @if (year()?.status !== 'CLOSED') {
        <p class="alert" role="status">
          Dossier <strong>provisoire</strong> : la période n’est pas encore clôturée, les chiffres peuvent encore changer. Une fois la période clôturée,
          les comptes sont arrêtés et le procès-verbal d’approbation se joint dans
          <a routerLink="/rapports/figes">Rapports figés</a>.
        </p>
      }
      <section class="panel" aria-label="Résumé">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">summarize</mat-icon><span>{{ year()?.label }} — le résumé</span></h3>
        <p class="summary">
          Sur cette période, l’association a reçu {{ amount(incomeStatement.products) }} et dépensé {{ amount(incomeStatement.charges) }}.
          {{ resultSentence(incomeStatement.result) }}
          À la fin de la période, il lui reste {{ amount(cash.totals.closing) }} sur ses comptes de banque et de caisse.
        </p>
        <p class="muted">Du {{ year()?.start | frDate }} au {{ year()?.end | frDate }}.</p>
        @if (incomeStatement.draftEntries > 0) {
          <p class="muted">{{ incomeStatement.draftEntries }} opération(s) en brouillon ne sont pas comptées dans ces chiffres.</p>
        }
      </section>

      <section class="panel" aria-label="Ce que l’association a reçu et dépensé">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">trending_up</mat-icon><span>Ce que l’association a reçu et dépensé (compte de résultat)</span></h3>
        <app-statement-groups
          caption="Compte de résultat"
          [groups]="incomeStatement.sections"
          [yearLabel]="incomeStatement.fiscalYear.label"
          [previousLabel]="incomeStatement.previous?.label ?? null"
        />
        <p class="total-line"><strong>{{ resultSentence(incomeStatement.result) }}</strong></p>
      </section>

      <section class="panel" aria-label="Ce que l’association possède et doit">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">balance</mat-icon><span>Ce que l’association possède et doit (bilan)</span></h3>
        <app-statement-groups caption="Ce que l’association possède (actif)" [groups]="balance.assets" [yearLabel]="balance.fiscalYear.label" [previousLabel]="balance.previous?.label ?? null" />
        <p class="total-line"><strong>Total de ce qu’elle possède : {{ amount(balance.totalAssets) }}</strong></p>
        <app-statement-groups caption="D’où cela vient (passif)" [groups]="balance.liabilities" [yearLabel]="balance.fiscalYear.label" [previousLabel]="balance.previous?.label ?? null" />
        <p class="total-line"><strong>Total : {{ amount(balance.totalLiabilities) }}</strong></p>
        @if (!balance.balanced) {
          <p class="alert" role="alert">Les deux totaux ne sont pas égaux (écart de {{ amount(balance.difference) }}) : montrez ce bilan à votre expert-comptable avant de le présenter.</p>
        }
      </section>

      <section class="panel" aria-label="L’argent sur les comptes">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_balance</mat-icon><span>L’argent sur les comptes (trésorerie)</span></h3>
        @if (cash.rows.length === 0) {
          <p class="muted">Aucun mouvement enregistré dans les comptes de banque ou de caisse sur cette période.</p>
        } @else {
          <table class="table">
            <caption class="sr-only">Argent sur les comptes</caption>
            <thead>
              <tr>
                <th scope="col">Compte</th>
                <th scope="col" class="amount">Au départ</th>
                <th scope="col" class="amount">Reçu</th>
                <th scope="col" class="amount">Dépensé</th>
                <th scope="col" class="amount">À la fin</th>
              </tr>
            </thead>
            <tbody>
              @for (row of cash.rows; track row.number) {
                <tr>
                  <td>{{ row.financialAccountName ?? row.label }}</td>
                  <td class="amount">{{ amount(row.opening) }}</td>
                  <td class="amount">{{ amount(row.receipts) }}</td>
                  <td class="amount">{{ amount(row.payments) }}</td>
                  <td class="amount"><strong>{{ amount(row.closing) }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (grants(); as list) {
        <section class="panel" aria-label="Les subventions">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">payments</mat-icon><span>Les subventions</span></h3>
          @if (list.length === 0) {
            <p class="muted">Aucune subvention accordée à ce jour.</p>
          } @else {
            <table class="table">
              <caption class="sr-only">Subventions accordées</caption>
              <thead>
                <tr>
                  <th scope="col">Financeur et objet</th>
                  <th scope="col" class="amount">Accordé</th>
                  <th scope="col" class="amount">Déjà reçu</th>
                  <th scope="col">Situation</th>
                </tr>
              </thead>
              <tbody>
                @for (grant of list; track grant.id) {
                  <tr>
                    <td>{{ grant.funder.name }} — {{ grant.title }}</td>
                    <td class="amount">{{ amount(grant.grantedAmount ?? '0.00') }}</td>
                    <td class="amount">{{ amount(grant.received) }}</td>
                    <td>{{ grant.status === 'CLOSED' ? 'Terminée' : 'En cours' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }

      <section class="panel" aria-label="Approbation des comptes">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">draw</mat-icon><span>Approbation des comptes</span></h3>
        <p>Les comptes de la période « {{ year()?.label }} » ont été présentés à l’assemblée générale du ……… / ……… / ………… et approuvés.</p>
        <div class="sign">
          <div>Le président ou la présidente</div>
          <div>Le trésorier ou la trésorière</div>
        </div>
        <p class="muted">
          Document de gestion établi à partir des opérations enregistrées dans l’application ; il ne remplace pas l’avis d’un expert-comptable.
        </p>
      </section>
    }
  `,
})
export class AssemblyPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);

  protected readonly amount = formatEuroAmount;
  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly yearId = signal('');
  protected readonly year = computed(() => this.years().find((y) => y.id === this.yearId()) ?? null);
  protected readonly income = signal<IncomeStatementInfo | null>(null);
  protected readonly sheet = signal<BalanceSheetInfo | null>(null);
  protected readonly treasury = signal<TreasuryStatementInfo | null>(null);
  protected readonly grants = signal<GrantInfo[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly ready = computed(() => !!this.income() && !!this.sheet() && !!this.treasury());
  private requestSeq = 0;

  constructor() {
    void this.init();
  }

  protected resultSentence(result: string): string {
    const cents = Number(result);
    const abs = formatEuroAmount(result.replace('-', ''));
    return cents > 0 ? `Elle termine la période avec un excédent de ${abs} (elle a reçu plus qu’elle n’a dépensé).` : cents < 0 ? `Elle termine la période avec un déficit de ${abs} (elle a dépensé plus qu’elle n’a reçu).` : 'Elle termine la période à l’équilibre : autant reçu que dépensé.';
  }

  protected print(): void {
    window.print();
  }

  protected async choose(id: string): Promise<void> {
    this.yearId.set(id);
    await this.show();
  }

  private async init(): Promise<void> {
    try {
      const years = await this.api.listFiscalYears();
      this.years.set(years);
      const initial = defaultYear(years);
      if (initial) {
        this.yearId.set(initial.id);
        await this.show();
      }
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les périodes de comptabilité.').message);
    } finally {
      this.loading.set(false);
    }
  }

  /** Charge d'un coup les trois états de la période ; une réponse tardive d'une autre période est ignorée. */
  private async show(): Promise<void> {
    const seq = ++this.requestSeq;
    const id = this.yearId();
    this.loading.set(true);
    this.error.set(null);
    try {
      const [income, sheet, treasury] = await Promise.all([this.api.incomeStatement(id), this.api.balanceSheet(id), this.api.treasuryStatement(id)]);
      // Les subventions sont facultatives : sans le droit de les lire, la section est simplement absente.
      const grants = this.auth.can('grants:view') ? await this.api.listGrants().catch(() => null) : null;
      if (seq !== this.requestSeq) return;
      this.income.set(income);
      this.sheet.set(sheet);
      this.treasury.set(treasury);
      this.grants.set(grants ? grants.filter((g) => g.status === 'GRANTED' || g.status === 'CLOSED') : null);
    } catch (failure) {
      if (seq !== this.requestSeq) return;
      this.error.set(describeHttpError(failure, 'Impossible de préparer le dossier. Réessayez dans un instant.').message);
    } finally {
      if (seq === this.requestSeq) this.loading.set(false);
    }
  }
}
