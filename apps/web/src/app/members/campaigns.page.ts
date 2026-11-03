import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatEuroAmount } from '../accounting/amount';
import { AdminApiService, type BulkEnrollInfo, type CampaignInfo, type MemberCategoryInfo, type MemberInfo, type MembershipInfo, type ReminderInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { BrandingService } from '../branding/branding.service';
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
import { PaymentsDialog, type PaymentsDialogData } from './payments-dialog';
import { BulkEnrollDialog, RenewCampaignDialog, type BulkEnrollDialogData, type RenewCampaignDialogData } from './renewal-dialogs';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { Skeleton } from '../ui/skeleton';

const STATUS_LABELS = { PENDING: 'En attente', EFFECTIVE: 'Effective', CANCELLED: 'Annulée' } as const;
const ORIGIN_LABELS = { PAYMENT: 'règlement', VALIDATION: 'validation', START_DATE: 'date de début', EXEMPTION: 'exonération' } as const;

/** Saisons d'adhésion, tarifs et adhésions des membres (ADR 0023). */
@Component({
  selector: 'app-campaigns-page',
  imports: [Skeleton, FrDatePipe, MatButtonModule, MatIconModule, ActionBar],
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
      label="Actions des saisons"
      description="Une saison est une période d'adhésion (par exemple d'un 29 septembre au 28 septembre suivant) avec ses tarifs. Chaque membre y a une adhésion : la cotisation attendue y est notée, sans rien comptabiliser tant qu'elle n'est pas payée."
    >
      @if (canManage()) {
        <button mat-flat-button type="button" (click)="newCampaign()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouvelle saison
        </button>
      }
    </app-action-bar>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <app-skeleton variant="cards" />
    } @else if (campaigns().length === 0) {
      <section class="panel">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">event_repeat</mat-icon><span>Aucune saison</span></h3>
        <p>Créez votre première saison d'adhésion, ajoutez-y ses tarifs, puis inscrivez les membres.</p>
      </section>
    } @else {
      <ul class="cards">
        @for (campaign of campaigns(); track campaign.id) {
          <li class="card-item">
            <div>
              <strong>{{ campaign.name }}</strong>
              <div class="muted">Du {{ campaign.startsOn | frDate }} au {{ campaign.endsOn | frDate }} · {{ campaign.membershipCount }} adhésion(s)</div>
              <div class="muted">{{ modeLabel(campaign.effectiveMode) }}</div>
            </div>
            <button mat-stroked-button type="button" [attr.aria-label]="'Ouvrir la saison ' + campaign.name" (click)="open(campaign.id)">
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
              <button mat-stroked-button type="button" (click)="editCampaign(campaign)">Modifier la saison</button>
              <button mat-stroked-button type="button" [disabled]="campaign.tariffs.length === 0" (click)="renewCampaign(campaign)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">event_repeat</mat-icon> Préparer la saison suivante
              </button>
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
                  <td class="amount">{{ amount(tariff.amount) }}</td>
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
          <div class="actions">
            <button mat-stroked-button type="button" (click)="toggleReminders(campaign)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">notifications_active</mat-icon> Cotisations restant dues
            </button>
          @if (canManage()) {
            <button mat-stroked-button type="button" [disabled]="campaign.tariffs.length === 0" (click)="enrollMany(campaign)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">groups</mat-icon> Inscrire plusieurs membres
            </button>
            <button mat-flat-button type="button" [disabled]="campaign.tariffs.length === 0" (click)="newMembership(campaign)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">person_add</mat-icon> Nouvelle adhésion
            </button>
          }
          </div>
        </div>
        @if (reminders(); as due) {
          <div class="reminders" aria-label="Cotisations restant dues">
            @if (due.items.length === 0) {
              <p class="success" role="status">Toutes les cotisations de cette saison sont réglées.</p>
            } @else {
              <p>
                <strong>{{ due.items.length }}</strong> cotisation(s) restent à payer, pour un total de <strong>{{ amount(due.totalDue) }}</strong>.
                <a mat-button [href]="'/api/campaigns/' + campaign.id + '/reminders/csv'" download>Exporter la liste (CSV)</a>
              </p>
              @if (emails(due).length > 0) {
                <p class="actions">
                  <button mat-stroked-button type="button" (click)="copyEmails(due)">
                    <mat-icon fontSet="material-icons-outlined" aria-hidden="true">content_copy</mat-icon> Copier les {{ emails(due).length }} adresse(s) email
                  </button>
                  @if (mailto(due); as link) {
                    <a mat-stroked-button [href]="link">
                      <mat-icon fontSet="material-icons-outlined" aria-hidden="true">mail</mat-icon> Écrire un rappel dans ma messagerie
                    </a>
                  } @else {
                    <span class="muted">Trop d’adresses pour un seul message : copiez-les et collez-les dans votre messagerie.</span>
                  }
                </p>
                <p class="muted">
                  Le message est préparé dans votre messagerie, avec les adresses en copie cachée (les membres ne voient pas les adresses des autres) ;
                  relisez-le avant de l’envoyer. {{ due.items.length - emails(due).length }} personne(s) n’ont pas d’adresse email : utilisez la liste ci-dessous ou l’export.
                </p>
              }
              <ul>
                @for (item of due.items; track item.membership.id) {
                  <li>{{ item.membership.memberName }} — {{ amount(item.membership.balance) }}@if (item.email) { · {{ item.email }} }@if (item.phone) { · {{ item.phone }} }</li>
                }
              </ul>
            }
          </div>
        }
        @if (memberships().length === 0) {
          <p class="muted">Aucune adhésion pour cette saison.</p>
        } @else {
          <table class="table">
            <caption class="sr-only">Adhésions</caption>
            <thead>
              <tr>
                <th scope="col">Membre</th>
                <th scope="col">Tarif</th>
                <th scope="col" class="amount">Attendu</th>
                <th scope="col" class="amount">Payé</th>
                <th scope="col" class="amount">Reste dû</th>
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
                  <td class="amount">{{ amount(membership.expectedAmount) }}</td>
                  <td class="amount">{{ amount(membership.paid) }}</td>
                  <td class="amount" [class.danger-text]="membership.overpaid || (membership.status !== 'CANCELLED' && membership.balance !== '0.00')">
                    @if (membership.status === 'CANCELLED') {
                      —
                    } @else if (membership.overpaid) {
                      Trop-perçu {{ amount(membership.balance.replace('-', '')) }}
                    } @else {
                      {{ amount(membership.balance) }}
                    }
                  </td>
                  <td>
                    @if (membership.status === 'EFFECTIVE') {
                      <span class="status ok">{{ statusLabel(membership.status) }}</span>
                      <div class="muted">depuis le {{ membership.effectiveOn | frDate }} ({{ originLabel(membership) }})</div>
                    } @else if (membership.status === 'CANCELLED') {
                      <span class="muted">{{ statusLabel(membership.status) }}</span>
                      <div class="muted">{{ membership.cancelReason }}</div>
                    } @else {
                      <span class="chip">{{ statusLabel(membership.status) }}</span>
                    }
                  </td>
                  <td class="row-actions">
                    @if (membership.status !== 'CANCELLED') {
                      <button mat-button type="button" [attr.aria-label]="'Règlements de ' + membership.memberName" (click)="payments(membership)">Règlements</button>
                    }
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
  /** Cotisations restant dues, quand le panneau est ouvert. */
  protected readonly reminders = signal<ReminderInfo | null>(null);
  private readonly categories = signal<MemberCategoryInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatEuroAmount;
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
    this.reminders.set(null);
    await this.run(async () => this.memberships.set(await this.api.listMemberships(id)), 'Impossible de charger les adhésions.');
  }

  private readonly branding = inject(BrandingService);

  /** Adresses des personnes à relancer (une fois chacune), sans les membres qui n'en ont pas. */
  protected emails(due: ReminderInfo): string[] {
    return [...new Set(due.items.flatMap((item) => (item.email ? [item.email] : [])))];
  }

  /**
   * Lien « nouveau message » prérempli : destinataires en copie cachée, texte courtois sans montant individuel. Au-delà d'environ
   * 1 800 caractères, les messageries tronquent le lien : on propose alors la copie des adresses seule (`null`).
   */
  protected mailto(due: ReminderInfo): string | null {
    const subject = `Rappel de cotisation — ${due.campaignName}`;
    const body = [
      'Bonjour,',
      '',
      `Sauf erreur de notre part, votre cotisation « ${due.campaignName} » n’a pas encore été réglée. Si vous l’avez déjà payée, merci d’ignorer ce message.`,
      '',
      'Merci d’avance,',
      this.branding.branding().appName,
    ].join('\n');
    const link = `mailto:?bcc=${encodeURIComponent(this.emails(due).join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return link.length <= 1800 ? link : null;
  }

  protected async copyEmails(due: ReminderInfo): Promise<void> {
    const text = this.emails(due).join('; ');
    try {
      await navigator.clipboard.writeText(text);
      this.notifier.success(`${this.emails(due).length} adresse(s) copiée(s) : collez-les dans le champ « Cci » de votre message.`);
    } catch {
      // Presse-papiers refusé (page non sécurisée, droit refusé) : on montre le texte pour qu'il se copie à la main.
      this.notifier.notice(`La copie automatique n’a pas fonctionné. Adresses : ${text}`);
    }
  }

  protected async toggleReminders(campaign: CampaignInfo): Promise<void> {
    if (this.reminders()) {
      this.reminders.set(null);
      return;
    }
    await this.run(async () => this.reminders.set(await this.api.reminders(campaign.id)), 'Impossible de calculer les cotisations restant dues.');
  }

  protected async payments(membership: MembershipInfo): Promise<void> {
    const updated = await this.dialogs.open<MembershipInfo, PaymentsDialogData>(PaymentsDialog, {
      size: 'lg',
      dismissible: true,
      data: { membership, canManage: this.canManage() },
    });
    if (updated) await this.refresh();
  }

  /** Copie les réglages et les tarifs d'une saison dans la suivante, puis l'ouvre : il reste à y inscrire les membres. */
  protected async renewCampaign(campaign: CampaignInfo): Promise<void> {
    const created = await this.dialogs.open<CampaignInfo, RenewCampaignDialogData>(RenewCampaignDialog, { size: 'md', data: { source: campaign } });
    if (!created) return;
    await this.reload();
    await this.open(created.id);
    this.notifier.success(`Saison « ${created.name} » créée avec ${created.tariffs.length} tarif(s). Vérifiez les tarifs, puis inscrivez-y les membres.`);
  }

  /** Inscrit plusieurs membres d'un coup ; dit combien de cotisations sont créées et combien étaient déjà inscrits. */
  protected async enrollMany(campaign: CampaignInfo): Promise<void> {
    const result = await this.dialogs.open<BulkEnrollInfo, BulkEnrollDialogData>(BulkEnrollDialog, { size: 'lg', data: { campaign } });
    if (!result) return;
    await this.refresh();
    const skipped = result.skipped.length > 0 ? ` ${result.skipped.length} membre(s) étaient déjà inscrits et n’ont pas été modifiés.` : '';
    this.notifier.success(`${result.created} cotisation(s) créée(s), pour un total attendu de ${formatEuroAmount(result.expectedTotal)}.${skipped}`);
  }

  protected async newCampaign(): Promise<void> {
    const created = await this.dialogs.open<CampaignInfo, CampaignDialogData>(CampaignDialog, { size: 'md', data: { campaign: null } });
    if (!created) return;
    this.notifier.success(`Saison « ${created.name} » créée : ajoutez-lui ses tarifs.`);
    await this.reload();
    await this.open(created.id);
  }

  protected async editCampaign(campaign: CampaignInfo): Promise<void> {
    const saved = await this.dialogs.open<CampaignInfo, CampaignDialogData>(CampaignDialog, { size: 'md', data: { campaign } });
    if (!saved) return;
    this.notifier.success('Saison enregistrée.');
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
      message: 'Aucune adhésion ne l\'utilise : il disparaît simplement de la saison.',
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
    if (this.reminders() && id) this.reminders.set(await this.api.reminders(id));
  }

  private async init(): Promise<void> {
    try {
      await this.reload();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les saisons.').message);
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
