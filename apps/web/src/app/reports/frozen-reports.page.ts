import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { defaultYear } from '../accounting/report-filters';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type FiscalYearInfo, type FrozenReportDetailInfo, type FrozenReportSummaryInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { LinkedDocuments } from '../documents/linked-documents';
import { ActionBar } from '../ui/action-bar';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { ApproveDialog, FreezeDialog, type ApproveDialogData, type FreezeDialogData } from './frozen-report-dialogs';
import { StatementGroups } from './statements';
import { NoPeriod } from '../ui/no-period';

/**
 * Rapports figés (ADR 0031) : les comptes de l'exercice tels qu'ils étaient à un moment donné, sans modification possible.
 * Ils se figent tout seuls à la fermeture et à la clôture de l'exercice, ou à la demande ; une correction produit une nouvelle
 * version qui dit laquelle elle remplace et pourquoi. L'assemblée générale peut les approuver (facultatif).
 */
@Component({
  selector: 'app-frozen-reports-page',
  imports: [NoPeriod, DatePipe, MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, ActionBar, LinkedDocuments, StatementGroups],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
  template: `
    <app-action-bar
      label="Actions des rapports figés"
      description="Les comptes de l’exercice tels qu’ils étaient à un moment précis, enregistrés pour ne plus changer : c’est ce qu’on présente à l’assemblée générale ou qu’on remet à l’expert-comptable. Ils se figent tout seuls à la fermeture et à la clôture de l’exercice ; vous pouvez aussi les figer à la demande."
    >
      @if (canFreeze() && yearId()) {
        <button mat-flat-button type="button" (click)="freeze()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock</mat-icon> Figer maintenant
        </button>
      }
      @if (detail()) {
        <button mat-stroked-button type="button" (click)="print()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">print</mat-icon> Imprimer / PDF
        </button>
      }
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="inline">
        <mat-label>Exercice</mat-label>
        <mat-select [value]="yearId()" (selectionChange)="chooseYear($event.value)" aria-label="Exercice">
          @for (year of years(); track year.id) {
            <mat-option [value]="year.id">{{ year.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (years().length === 0 && !loading()) {
      <app-no-period />
    } @else if (!loading() && versions().length === 0) {
      <section class="panel">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock</mat-icon><span>Aucun rapport figé pour cet exercice</span></h3>
        <p>
          Quand vous fermerez l’exercice à la saisie, un arrêté provisoire sera figé automatiquement ; à la clôture, ce seront les comptes
          définitifs.
          @if (canFreeze()) {
            Vous pouvez aussi cliquer sur « Figer maintenant » pour garder une photographie de l’état actuel.
          }
        </p>
      </section>
    }

    @if (versions().length > 0) {
      <ul class="cards" aria-label="Versions des rapports figés">
        @for (version of versions(); track version.id) {
          <li class="card-item">
            <div>
              <strong>Version {{ version.number }} — {{ version.label }}</strong>
              <div class="meta">
                Figée le {{ version.createdAt | date: 'dd/MM/yyyy HH:mm' }} ·
                {{ version.provisional ? 'Provisoire (exercice non clôturé)' : 'Définitive (exercice clôturé)' }} ·
                {{ version.latest ? 'Version à jour' : 'Remplacée par une version plus récente' }}
                @if (version.supersedesNumber !== null) {
                  · Remplace la version {{ version.supersedesNumber }}
                }
              </div>
              @if (version.reason) {
                <div class="meta">Motif : {{ version.reason }}</div>
              }
              @if (version.approval; as approval) {
                <div class="success">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">verified</mat-icon>
                  Approuvés par l’assemblée générale du {{ approval.meetingDate | date: 'dd/MM/yyyy' }}{{ approval.note ? ' — ' + approval.note : '' }}
                </div>
              }
            </div>
            <div class="actions">
              <button mat-stroked-button type="button" [attr.aria-label]="'Consulter la version ' + version.number" (click)="open(version)">
                {{ detail()?.id === version.id ? 'Ouverte' : 'Consulter' }}
              </button>
              @if (canApprove(version)) {
                <button mat-stroked-button type="button" [attr.aria-label]="'Approuver la version ' + version.number" (click)="approve(version)">
                  Approuver par l’assemblée
                </button>
              }
            </div>
          </li>
        }
      </ul>
    }

    @if (detail(); as report) {
      @if (!report.intact) {
        <p class="alert" role="alert">
          Attention : le contenu enregistré de cette version ne correspond plus à son empreinte. Il a pu être modifié directement dans la base de données.
          Ne vous fiez pas à ces chiffres et prévenez la personne qui héberge l’application.
        </p>
      }
      <section class="panel" [attr.aria-label]="'Version ' + report.number">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">fact_check</mat-icon><span>Exercice {{ report.content.meta.fiscalYear.label }} — version {{ report.number }}</span></h3>
        <p class="muted">
          {{ report.provisional ? 'Rapports provisoires : l’exercice n’était pas clôturé.' : 'Rapports définitifs : l’exercice était clôturé.' }}
          Établis le {{ report.content.meta.generatedAt | date: 'dd/MM/yyyy HH:mm' }} · empreinte {{ report.sha256.slice(0, 12) }}… · calcul n° {{ report.calcVersion }}.
          Ce n’est pas un archivage à valeur légale : l’empreinte permet seulement de vérifier que le contenu n’a pas été modifié.
        </p>
        @if (report.content.meta.draftEntries > 0) {
          <p class="muted" role="status">{{ report.content.meta.draftEntries }} brouillon(s) n’étaient pas comptés à ce moment-là.</p>
        }
        @if (report.content.incomeStatement.carryWarning; as warning) {
          <p class="alert" role="status">{{ warning }}</p>
        }
      </section>

      <section class="panel" aria-label="Compte de résultat figé">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">trending_up</mat-icon><span>Compte de résultat</span></h3>
        <app-statement-groups
          caption="Compte de résultat figé"
          [groups]="report.content.incomeStatement.sections"
          [yearLabel]="report.content.incomeStatement.fiscalYear.label"
          [previousLabel]="report.content.incomeStatement.previous?.label ?? null"
        />
        <p class="total-line">
          <strong>Résultat : {{ amount(report.content.incomeStatement.result) }} €</strong>
          @if (report.content.incomeStatement.previousResult !== null) {
            <span class="muted"> (précédent : {{ amount(report.content.incomeStatement.previousResult) }} €)</span>
          }
        </p>
      </section>

      <section class="panel" aria-label="Bilan figé">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">balance</mat-icon><span>Bilan</span></h3>
        <app-statement-groups
          caption="Actif figé"
          [groups]="report.content.balanceSheet.assets"
          [yearLabel]="report.content.balanceSheet.fiscalYear.label"
          [previousLabel]="report.content.balanceSheet.previous?.label ?? null"
        />
        <p class="total-line"><strong>Total de l’actif : {{ amount(report.content.balanceSheet.totalAssets) }} €</strong></p>
        <app-statement-groups
          caption="Passif figé"
          [groups]="report.content.balanceSheet.liabilities"
          [yearLabel]="report.content.balanceSheet.fiscalYear.label"
          [previousLabel]="report.content.balanceSheet.previous?.label ?? null"
        />
        <p class="total-line"><strong>Total du passif : {{ amount(report.content.balanceSheet.totalLiabilities) }} €</strong></p>
        @if (!report.content.balanceSheet.balanced) {
          <p class="alert" role="status">L’actif et le passif n’étaient pas égaux à ce moment-là (écart de {{ amount(report.content.balanceSheet.difference) }} €).</p>
        }
      </section>

      <section class="panel" aria-label="Trésorerie figée">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_balance</mat-icon><span>Trésorerie</span></h3>
        @if (report.content.treasury.rows.length === 0) {
          <p class="muted">Aucun mouvement sur un compte de banque ou de caisse.</p>
        } @else {
          <table class="table">
            <caption class="sr-only">État de trésorerie figé</caption>
            <thead>
              <tr>
                <th scope="col">Compte</th>
                <th scope="col" class="amount">Solde de départ</th>
                <th scope="col" class="amount">Encaissements</th>
                <th scope="col" class="amount">Décaissements</th>
                <th scope="col" class="amount">Solde de clôture</th>
              </tr>
            </thead>
            <tbody>
              @for (row of report.content.treasury.rows; track row.number) {
                <tr>
                  <td>{{ row.financialAccountName ?? row.label }}</td>
                  <td class="amount">{{ amount(row.opening) }}</td>
                  <td class="amount">{{ amount(row.receipts) }}</td>
                  <td class="amount">{{ amount(row.payments) }}</td>
                  <td class="amount"><strong>{{ amount(row.closing) }}</strong></td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td class="amount">{{ amount(report.content.treasury.totals.opening) }}</td>
                <td class="amount">{{ amount(report.content.treasury.totals.receipts) }}</td>
                <td class="amount">{{ amount(report.content.treasury.totals.payments) }}</td>
                <td class="amount"><strong>{{ amount(report.content.treasury.totals.closing) }}</strong></td>
              </tr>
            </tfoot>
          </table>
        }
      </section>

      <app-linked-documents objectType="frozen-report" [objectId]="report.id" [name]="'Rapports figés, version ' + report.number" [canDeposit]="canDeposit()" />
    }
  `,
})
export class FrozenReportsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly amount = formatApiAmount;
  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly yearId = signal('');
  protected readonly versions = signal<FrozenReportSummaryInfo[]>([]);
  protected readonly detail = signal<FrozenReportDetailInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly canFreeze = computed(() => this.auth.can('fiscal-years:close'));
  protected readonly canDeposit = computed(() => this.auth.can('documents:create'));
  private readonly year = computed(() => this.years().find((y) => y.id === this.yearId()) ?? null);

  constructor() {
    void this.init();
  }

  protected canApprove(version: FrozenReportSummaryInfo): boolean {
    return this.canFreeze() && !version.provisional && version.latest && version.approval === null;
  }

  protected async chooseYear(id: string): Promise<void> {
    this.yearId.set(id);
    this.detail.set(null);
    await this.loadVersions();
  }

  protected async open(version: FrozenReportSummaryInfo): Promise<void> {
    this.error.set(null);
    try {
      this.detail.set(await this.api.getFrozenReport(version.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Impossible d'ouvrir cette version.").message);
    }
  }

  protected async freeze(): Promise<void> {
    const year = this.year();
    if (!year) return;
    const created = await this.dialogs.open<FrozenReportSummaryInfo, FreezeDialogData>(FreezeDialog, {
      size: 'md',
      data: { yearId: year.id, yearLabel: year.label, hasVersions: this.versions().length > 0, provisional: year.status !== 'CLOSED' },
    });
    if (!created) return;
    this.notifier.success(`Rapports figés : version ${created.number}.`);
    await this.loadVersions();
    await this.open(created);
  }

  protected async approve(version: FrozenReportSummaryInfo): Promise<void> {
    const year = this.year();
    if (!year) return;
    const approved = await this.dialogs.open<FrozenReportSummaryInfo, ApproveDialogData>(ApproveDialog, { size: 'md', data: { report: version, yearLabel: year.label } });
    if (!approved) return;
    this.notifier.success('Approbation enregistrée. Déposez maintenant le procès-verbal dans « Documents » ci-dessous.');
    await this.loadVersions();
    await this.open(approved);
  }

  protected print(): void {
    window.print();
  }

  private async init(): Promise<void> {
    try {
      const years = await this.api.listFiscalYears();
      this.years.set(years);
      const initial = defaultYear(years);
      if (initial) {
        this.yearId.set(initial.id);
        await this.loadVersions();
      }
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les exercices.').message);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadVersions(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.versions.set(await this.api.listFrozenReports(this.yearId()));
    } catch (failure) {
      this.versions.set([]);
      this.error.set(describeHttpError(failure, 'Impossible de charger les rapports figés.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
