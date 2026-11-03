import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FiscalYearInfo, type ThirdPartyBalancesInfo, type ThirdPartyInfo, type ThirdPartyKindInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { formatEuroAmount } from './amount';
import { ThirdPartyDialog } from './third-party-dialog';

const KIND_LABELS: Record<ThirdPartyKindInfo, string> = {
  MEMBER: 'Adhérent',
  FUNDER: 'Financeur',
  SUPPLIER: 'Fournisseur',
  OTHER: 'Autre',
};

/**
 * Tiers (ADR 0030) : qui vous doit de l'argent et à qui vous en devez, personne par personne, pour un exercice. Lecture
 * seule tirée des écritures (rien n'est stocké) ; on y ajoute et on y archive les tiers.
 */
@Component({
  selector: 'app-third-parties-page',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, ActionBar],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .detail {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  template: `
    <app-action-bar
      label="Actions des tiers"
      description="Qui vous doit de l’argent, et à qui en devez-vous ? Ce tableau est tiré de vos écritures : il se remplit quand vous indiquez « Qui ? » sur une ligne d’un compte de tiers (adhérents, subventions, fournisseurs) ou dans la situation de départ."
    >
      @if (canAdd()) {
        <button mat-flat-button type="button" (click)="add()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">person_add</mat-icon> Ajouter un tiers
        </button>
      }
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="inline">
        <mat-label>Exercice</mat-label>
        <mat-select [value]="selectedYear()" (selectionChange)="choose($event.value)" aria-label="Exercice">
          @for (year of years(); track year.id) {
            <mat-option [value]="year.id">{{ year.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (report(); as data) {
      @if (data.carryWarning) {
        <p class="alert" role="status">{{ data.carryWarning }}</p>
      }

      <section class="panel" aria-label="Sommes par personne">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">groups</mat-icon><span>Sommes par personne — exercice {{ data.fiscalYear.label }}</span></h3>
        @if (data.rows.length === 0) {
          <p>
            Aucune somme à recevoir ou à payer n’est suivie par personne sur cet exercice. Pour commencer, choisissez un tiers sur les lignes de
            vos écritures de comptes de tiers (adhérents, subventions à recevoir, fournisseurs), ou indiquez-les dans la situation de départ.
          </p>
        } @else {
          <table class="table">
            <caption class="sr-only">Sommes à recevoir et à payer par personne</caption>
            <thead>
              <tr>
                <th scope="col">Personne ou organisme</th>
                <th scope="col" class="amount">Elle vous doit</th>
                <th scope="col" class="amount">Vous lui devez</th>
              </tr>
            </thead>
            <tbody>
              @for (row of data.rows; track row.id) {
                <tr>
                  <th scope="row">
                    {{ row.name }} <span class="chip">{{ kindLabel(row.kind) }}</span>
                    <div class="detail">{{ accountsOf(row) }}</div>
                  </th>
                  <td class="amount">{{ row.owedToYou === '0.00' ? '' : format(row.owedToYou) }}</td>
                  <td class="amount">{{ row.youOwe === '0.00' ? '' : format(row.youOwe) }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td class="amount">{{ format(data.totals.owedToYou) }}</td>
                <td class="amount">{{ format(data.totals.youOwe) }}</td>
              </tr>
            </tfoot>
          </table>
        }
        @if (data.untracked.lines > 0) {
          <p class="muted">
            {{ data.untracked.lines }} ligne(s) de comptes de tiers n’ont pas de tiers indiqué ({{ format(data.untracked.net) }} au total, positif
            = on vous doit). Elles ne sont pas dans ce tableau : indiquez « Qui ? » dans l’écriture pour les y faire apparaître.
          </p>
        }
      </section>
    }

    <section class="panel" aria-label="Tous les tiers">
      <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">contacts</mat-icon><span>Tous les tiers</span></h3>
      @if (parties().length === 0) {
        <p>Aucun tiers pour l’instant. Ajoutez-en un avec le bouton ci-dessus : un adhérent, un financeur, un fournisseur…</p>
      } @else {
        <table class="table">
          <caption class="sr-only">Liste des tiers</caption>
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Type</th>
              <th scope="col">Note</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (party of parties(); track party.id) {
              <tr>
                <th scope="row">{{ party.name }}</th>
                <td>{{ kindLabel(party.kind) }}</td>
                <td>{{ party.note }}</td>
                <td>
                  @if (canArchive()) {
                    <button mat-button type="button" [attr.aria-label]="'Archiver ' + party.name" (click)="archive(party)">Archiver</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="muted">Un tiers archivé n’est plus proposé pour de nouvelles lignes ; il reste lisible dans les écritures déjà saisies.</p>
      }
    </section>
  `,
})
export class ThirdPartiesPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly selectedYear = signal<string | null>(null);
  protected readonly report = signal<ThirdPartyBalancesInfo | null>(null);
  protected readonly parties = signal<ThirdPartyInfo[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly canAdd = computed(() => this.auth.can('entries:create'));
  protected readonly canArchive = computed(() => this.auth.can('settings.accounting:admin'));

  constructor() {
    void this.load();
  }

  protected kindLabel(kind: ThirdPartyKindInfo): string {
    return KIND_LABELS[kind];
  }

  protected format(value: string): string {
    return formatEuroAmount(value);
  }

  protected accountsOf(row: { accounts: { number: string; label: string }[] }): string {
    return row.accounts.map((a) => `${a.number} ${a.label}`).join(' · ');
  }

  protected async choose(yearId: string): Promise<void> {
    this.selectedYear.set(yearId);
    await this.loadReport(yearId);
  }

  protected async add(): Promise<void> {
    const created = await this.dialogs.open<ThirdPartyInfo>(ThirdPartyDialog, { size: 'md' });
    if (created) {
      this.notifier.success(`« ${created.name} » ajouté aux tiers.`);
      await this.loadParties();
    }
  }

  protected async archive(party: ThirdPartyInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Archiver « ${party.name} » ?`,
      message: 'Ce tiers ne sera plus proposé pour de nouvelles lignes. Il reste affiché dans les écritures déjà saisies, et cela ne se défait pas : vous pourrez en créer un nouveau si besoin.',
      confirmLabel: 'Archiver',
    });
    if (!confirmed) return;
    try {
      await this.api.archiveThirdParty(party.id);
      this.notifier.success(`« ${party.name} » archivé.`);
      await this.loadParties();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le tiers n'a pas pu être archivé. Réessayez dans un instant.").message);
    }
  }

  private async load(): Promise<void> {
    try {
      const [years] = await Promise.all([this.api.listFiscalYears(), this.loadParties()]);
      this.years.set([...years].sort((a, b) => b.start.localeCompare(a.start)));
      await this.loadReport(undefined);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les tiers.').message);
    }
  }

  private async loadParties(): Promise<void> {
    this.parties.set(await this.api.listThirdParties());
  }

  private async loadReport(yearId: string | undefined): Promise<void> {
    this.error.set(null);
    try {
      const report = await this.api.thirdPartyBalances(yearId);
      this.report.set(report);
      this.selectedYear.set(report.fiscalYear.id);
    } catch (failure) {
      this.report.set(null);
      this.error.set(describeHttpError(failure, 'Impossible de charger les sommes par personne.').message);
    }
  }
}
