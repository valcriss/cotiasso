import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type CampaignInfo, type MemberCategoryInfo, type MemberInfo, type MembershipInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { ActionBar } from '../ui/action-bar';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import {
  CampaignDialog,
  CancelMembershipDialog,
  MODE_LABELS,
  MembershipDialog,
  TariffDialog,
  type CampaignDialogData,
  type CancelMembershipDialogData,
  type MembershipDialogData,
  type TariffDialogData,
} from './campaign-dialogs';

const STATUS_LABELS = { PENDING: 'En attente', EFFECTIVE: 'Effective', CANCELLED: 'Annulée' } as const;
const ORIGIN_LABELS = { PAYMENT: 'règlement', VALIDATION: 'validation', START_DATE: 'date de début', EXEMPTION: 'exonération' } as const;

/** Campagnes d'adhésion, tarifs et adhésions des membres (ADR 0023). */
@Component({
  selector: 'app-campaigns-page',
  imports: [MatButtonModule, MatIconModule, ActionBar],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
  `,
  template: `
    <app-action-bar
      label="Actions des campagnes"
      description="Une campagne est une période d'adhésion (par exemple d'un 29 septembre au 28 septembre suivant) avec ses tarifs. Chaque membre y a une adhésion : la cotisation attendue y est notée, sans rien comptabiliser tant qu'elle n'est pas payée."
    >
      @if (canManage()) {
        <button mat-flat-button type="button" (click)="newCampaign()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouvelle campagne
        </button>
      }
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (campaigns().length === 0) {
      <section class="panel">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">event_repeat</mat-icon><span>Aucune campagne</span></h3>
        <p>Créez votre première campagne d'adhésion, ajoutez-y ses tarifs, puis inscrivez les membres.</p>
      </section>
    } @else {
      <ul class="cards">
        @for (campaign of campaigns(); track campaign.id) {
          <li class="card-item">
            <div>
              <strong>{{ campaign.name }}</strong>
              <div class="muted">Du {{ campaign.startsOn }} au {{ campaign.endsOn }} · {{ campaign.membershipCount }} adhésion(s)</div>
              <div class="muted">{{ modeLabel(campaign.effectiveMode) }}</div>
            </div>
            <button mat-stroked-button type="button" [attr.aria-label]="'Ouvrir la campagne ' + campaign.name" (click)="open(campaign.id)">
              {{ selectedId() === campaign.id ? 'Ouverte' : 'Ouvrir' }}
            </button>
          </li>
        }
      </ul>
    }

    @if (selected(); as campaign) {
      <section class="panel" [attr.aria-label]="'Tarifs de ' + campaign.name">
        <div class="head">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">sell</mat-icon><span>Tarifs — {{ campaign.name }}</span></h3>
          <div class="actions">
            @if (canManage()) {
              <button mat-stroked-button type="button" (click)="editCampaign(campaign)">Modifier la campagne</button>
              <button mat-flat-button type="button" (click)="addTariff(campaign)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter un tarif
              </button>
            }
          </div>
        </div>
        @if (campaign.tariffs.length === 0) {
          <p class="muted">Aucun tarif : ajoutez-en un (plein tarif, tarif réduit…) pour pouvoir inscrire des membres.</p>
        } @else {
          <table class="table">
            <caption class="sr-only">Tarifs</caption>
            <thead>
              <tr>
                <th scope="col">Tarif</th>
                <th scope="col">Catégorie</th>
                <th scope="col" class="amount">Montant</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (tariff of campaign.tariffs; track tariff.id) {
                <tr>
                  <td>{{ tariff.label }}</td>
                  <td>{{ tariff.categoryName ?? 'Toutes' }}</td>
                  <td class="amount">{{ amount(tariff.amount) }} €</td>
                  <td class="row-actions">
                    @if (canManage()) {
                      <button mat-button type="button" [attr.aria-label]="'Modifier le tarif ' + tariff.label" (click)="editTariff(campaign, tariff)">Modifier</button>
                      @if (tariff.membershipCount === 0) {
                        <button mat-button type="button" [attr.aria-label]="'Retirer le tarif ' + tariff.label" (click)="removeTariff(tariff.id, tariff.label)">Retirer</button>
                      }
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="panel" [attr.aria-label]="'Adhésions de ' + campaign.name">
        <div class="head">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">how_to_reg</mat-icon><span>Adhésions</span></h3>
          @if (canManage()) {
            <button mat-flat-button type="button" [disabled]="campaign.tariffs.length === 0" (click)="newMembership(campaign)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">person_add</mat-icon> Nouvelle adhésion
            </button>
          }
        </div>
        @if (memberships().length === 0) {
          <p class="muted">Aucune adhésion pour cette campagne.</p>
        } @else {
          <table class="table">
            <caption class="sr-only">Adhésions</caption>
            <thead>
              <tr>
                <th scope="col">Membre</th>
                <th scope="col">Tarif</th>
                <th scope="col" class="amount">Attendu</th>
                <th scope="col">État</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (membership of memberships(); track membership.id) {
                <tr [class.disabled]="membership.status === 'CANCELLED'">
                  <td>{{ membership.memberName }}</td>
                  <td>
                    {{ membership.tariffLabel ?? '—' }}
                    @if (membership.exemptionReason) {
                      <div class="muted">{{ membership.exemptionReason }}</div>
                    }
                  </td>
                  <td class="amount">{{ amount(membership.expectedAmount) }} €</td>
                  <td>
                    @if (membership.status === 'EFFECTIVE') {
                      <span class="status ok">{{ statusLabel(membership.status) }}</span>
                      <div class="muted">depuis le {{ membership.effectiveOn }} ({{ originLabel(membership) }})</div>
                    } @else if (membership.status === 'CANCELLED') {
                      <span class="muted">{{ statusLabel(membership.status) }}</span>
                      <div class="muted">{{ membership.cancelReason }}</div>
                    } @else {
                      <span class="chip">{{ statusLabel(membership.status) }}</span>
                    }
                  </td>
                  <td class="row-actions">
                    @if (canManage() && membership.status !== 'CANCELLED') {
                      @if (membership.status === 'PENDING' && campaign.effectiveMode === 'VALIDATION') {
                        <button mat-button type="button" [attr.aria-label]="'Valider l\\'adhésion de ' + membership.memberName" [disabled]="busy()" (click)="validate(membership)">Valider</button>
                      }
                      <button mat-button type="button" class="danger" [attr.aria-label]="'Annuler l\\'adhésion de ' + membership.memberName" (click)="cancel(membership)">Annuler</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }
  `,
})
export class CampaignsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly campaigns = signal<CampaignInfo[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.campaigns().find((c) => c.id === this.selectedId()) ?? null);
  protected readonly memberships = signal<MembershipInfo[]>([]);
  private readonly categories = signal<MemberCategoryInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;
  protected readonly canManage = computed(() => {
    this.auth.permissions();
    return this.auth.can('members:manage');
  });

  constructor() {
    void this.init();
  }

  protected modeLabel = (mode: CampaignInfo['effectiveMode']) => MODE_LABELS[mode];
  protected statusLabel = (status: MembershipInfo['status']) => STATUS_LABELS[status];
  protected originLabel = (membership: MembershipInfo) => (membership.effectiveOrigin ? ORIGIN_LABELS[membership.effectiveOrigin] : '');

  protected async open(id: string): Promise<void> {
    this.selectedId.set(id);
    await this.run(async () => this.memberships.set(await this.api.listMemberships(id)), 'Impossible de charger les adhésions.');
  }

  protected async newCampaign(): Promise<void> {
    const created = await this.dialogs.open<CampaignInfo, CampaignDialogData>(CampaignDialog, { size: 'md', data: { campaign: null } });
    if (!created) return;
    this.notifier.success(`Campagne « ${created.name} » créée : ajoutez-lui ses tarifs.`);
    await this.reload();
    await this.open(created.id);
  }

  protected async editCampaign(campaign: CampaignInfo): Promise<void> {
    const saved = await this.dialogs.open<CampaignInfo, CampaignDialogData>(CampaignDialog, { size: 'md', data: { campaign } });
    if (!saved) return;
    this.notifier.success('Campagne enregistrée.');
    await this.reload();
  }

  protected async addTariff(campaign: CampaignInfo): Promise<void> {
    await this.tariffDialog(campaign, null, 'Tarif ajouté.');
  }

  protected async editTariff(campaign: CampaignInfo, tariff: CampaignInfo['tariffs'][number]): Promise<void> {
    await this.tariffDialog(campaign, tariff, 'Tarif enregistré.');
  }

  protected async removeTariff(id: string, label: string): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Retirer le tarif « ${label} » ?`,
      message: 'Aucune adhésion ne l\'utilise : il disparaît simplement de la campagne.',
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.removeTariff(id);
      this.notifier.success('Tarif retiré.');
      await this.reload();
    }, "Le tarif n'a pas pu être retiré.");
  }

  protected async newMembership(campaign: CampaignInfo): Promise<void> {
    const members = (await this.api.listMembers({ status: 'ACTIVE' }).catch(() => ({ members: [] as MemberInfo[] }))).members;
    const created = await this.dialogs.open<MembershipInfo, MembershipDialogData>(MembershipDialog, { size: 'md', data: { campaign, members } });
    if (!created) return;
    this.notifier.success(`Adhésion de ${created.memberName} enregistrée.`);
    await this.refresh();
  }

  protected validate(membership: MembershipInfo): Promise<void> {
    return this.run(async () => {
      await this.api.validateMembership(membership.id);
      this.notifier.success(`Adhésion de ${membership.memberName} validée.`);
      await this.refresh();
    }, "L'adhésion n'a pas pu être validée.");
  }

  protected async cancel(membership: MembershipInfo): Promise<void> {
    const cancelled = await this.dialogs.open<MembershipInfo, CancelMembershipDialogData>(CancelMembershipDialog, { size: 'md', data: { membership } });
    if (!cancelled) return;
    this.notifier.success('Adhésion annulée.');
    await this.refresh();
  }

  private async tariffDialog(campaign: CampaignInfo, tariff: CampaignInfo['tariffs'][number] | null, success: string): Promise<void> {
    const updated = await this.dialogs.open<CampaignInfo, TariffDialogData>(TariffDialog, {
      size: 'md',
      data: { campaignId: campaign.id, tariff, categories: this.categories() },
    });
    if (!updated) return;
    this.notifier.success(success);
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.campaigns.set(await this.api.listCampaigns());
  }

  private async refresh(): Promise<void> {
    await this.reload();
    const id = this.selectedId();
    if (id) this.memberships.set(await this.api.listMemberships(id));
  }

  private async init(): Promise<void> {
    try {
      await this.reload();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les campagnes.').message);
    } finally {
      this.loading.set(false);
    }
    this.categories.set(await this.api.listMemberCategories().catch(() => []));
  }

  private async run(action: () => Promise<void>, fallback: string): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      this.error.set(describeHttpError(failure, fallback).message);
    } finally {
      this.busy.set(false);
    }
  }
}
