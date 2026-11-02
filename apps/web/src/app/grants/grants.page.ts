import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type FunderInfo, type GrantInfo, type GrantStatus } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { PageHeader } from '../ui/page-header';
import { FunderDialog } from './funder-dialog';
import { GrantFinance } from './grant-finance';
import { FUNDER_TYPE_LABELS, GRANT_STATUS_LABELS, RESIDUAL_LABELS } from './grant-labels';
import { AllocationsDialog, GrantCloseDialog, GrantDecisionDialog, GrantDialog, GrantReasonDialog } from './grant-dialogs';

/**
 * Subventions : les dossiers déposés auprès des financeurs, de la demande à la clôture. C'est un suivi de gestion : rien
 * n'est écrit dans la comptabilité. Un responsable limité à un projet ne voit que les subventions qui le financent.
 */
@Component({
  selector: 'app-grants-page',
  imports: [GrantFinance, MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    tr.selected td {
      background: var(--app-surface-muted);
    }
    .note {
      display: block;
      font-size: 0.85em;
      color: var(--mat-sys-on-surface-variant);
    }
    dl.facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 16px;
      margin: 8px 0 16px;
    }
    dl.facts dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dl.facts dd {
      margin: 0;
      white-space: pre-line;
    }
  `,
  template: `
    <app-page-header
      title="Subventions"
      icon="payments"
      description="Les dossiers déposés auprès de vos financeurs : demandés, instruits, accordés ou refusés, puis clôturés. C'est un suivi : rien n'est écrit dans la comptabilité."
    >
      @if (canManage()) {
        <button mat-flat-button type="button" (click)="createGrant()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Demander une subvention
        </button>
        <button mat-stroked-button type="button" (click)="createFunder()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add_business</mat-icon> Nouveau financeur
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    <section class="panel" aria-label="Subventions">
      <div class="head">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">list_alt</mat-icon><span>Subventions</span></h3>
        <div class="actions">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>État</mat-label>
            <mat-select [value]="filter()" (selectionChange)="changeFilter($event.value)" aria-label="Filtrer par état">
              <mat-option value="">Tous les états</mat-option>
              @for (status of statuses; track status.value) {
                <mat-option [value]="status.value">{{ status.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      </div>
      @if (loading()) {
        <p class="muted">Chargement…</p>
      } @else if (grants().length === 0) {
        <p class="muted">
          @if (filter()) {
            Aucune subvention dans cet état.
          } @else if (canManage()) {
            Aucune subvention pour l'instant. Ajoutez d'abord le financeur (une mairie, une région, une fondation…), puis cliquez sur « Demander une subvention ».
          } @else {
            Aucune subvention n'est visible pour vous. Vous voyez celles qui financent vos projets.
          }
        </p>
      } @else {
        <table class="table">
          <caption class="sr-only">Subventions</caption>
          <thead>
            <tr>
              <th scope="col">Objet</th>
              <th scope="col">Financeur</th>
              <th scope="col">État</th>
              <th scope="col" class="amount">Demandé</th>
              <th scope="col" class="amount">Accordé</th>
              <th scope="col" class="amount">Reçu</th>
              <th scope="col">Projets</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (grant of grants(); track grant.id) {
              <tr [class.selected]="grant.id === selected()?.id">
                <td>
                  {{ grant.title }}
                  @if (grant.reference) {
                    <span class="note">Réf. {{ grant.reference }}</span>
                  }
                </td>
                <td>{{ grant.funder.name }}</td>
                <td><span class="chip">{{ statusLabel(grant.status) }}</span></td>
                <td class="amount">{{ amount(grant.requestedAmount) }}</td>
                <td class="amount">{{ grant.grantedAmount === null ? '—' : amount(grant.grantedAmount) }}</td>
                <td class="amount">{{ grant.grantedAmount === null ? '—' : amount(grant.received) }}</td>
                <td>{{ projectCodes(grant) }}</td>
                <td class="row-actions">
                  <button mat-button type="button" [attr.aria-label]="'Ouvrir ' + grant.title" (click)="open(grant)">Ouvrir</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    @if (selected(); as grant) {
      <section class="panel" [attr.aria-label]="'Détail de ' + grant.title">
        <div class="head">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">receipt_long</mat-icon><span>{{ grant.title }}</span></h3>
          <div class="actions">
            @if (canManage()) {
              <button mat-stroked-button type="button" (click)="edit(grant)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit</mat-icon> Modifier
              </button>
              @if (grant.status === 'REQUESTED' || grant.status === 'UNDER_REVIEW') {
                <button mat-stroked-button type="button" (click)="allocate(grant)">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">account_tree</mat-icon> Projets financés
                </button>
              }
              @if (grant.status === 'REQUESTED') {
                <button mat-stroked-button type="button" (click)="review(grant)">Passer en instruction</button>
              }
              @if (grant.status === 'REQUESTED' || grant.status === 'UNDER_REVIEW') {
                <button mat-flat-button type="button" (click)="decide(grant)">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">check</mat-icon> Enregistrer l'accord
                </button>
                <button mat-button type="button" (click)="reason(grant, 'refuse')">Enregistrer un refus</button>
                <button mat-button type="button" (click)="reason(grant, 'cancel')">Annuler la demande</button>
              }
              @if (grant.status === 'GRANTED') {
                <button mat-flat-button type="button" (click)="close(grant)">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock</mat-icon> Clôturer
                </button>
              }
            }
            <button mat-button type="button" (click)="selected.set(null)">Fermer</button>
          </div>
        </div>
        <p class="muted">{{ explain(grant) }}</p>
        <dl class="facts">
          <dt>Financeur</dt>
          <dd>{{ grant.funder.name }} ({{ funderType(grant) }})</dd>
          @if (grant.reference) {
            <dt>Référence</dt>
            <dd>{{ grant.reference }}</dd>
          }
          <dt>État</dt>
          <dd>{{ statusLabel(grant.status) }}</dd>
          <dt>Montant demandé</dt>
          <dd>{{ amount(grant.requestedAmount) }} €{{ grant.requestedOn ? ' (demande du ' + grant.requestedOn + ')' : '' }}</dd>
          @if (grant.grantedAmount !== null) {
            <dt>Montant accordé</dt>
            <dd>{{ amount(grant.grantedAmount) }} € (décision du {{ grant.decidedOn }})</dd>
          }
          @if (grant.periodStart || grant.periodEnd) {
            <dt>Période financée</dt>
            <dd>du {{ grant.periodStart ?? '…' }} au {{ grant.periodEnd ?? '…' }}</dd>
          }
          @if (grant.status === 'REFUSED') {
            <dt>Refus</dt>
            <dd>{{ grant.decidedOn }} — {{ grant.reason }}</dd>
          }
          @if (grant.status === 'CANCELLED') {
            <dt>Annulation</dt>
            <dd>{{ grant.reason }}</dd>
          }
          @if (grant.status === 'CLOSED' && grant.residual) {
            <dt>Clôture</dt>
            <dd>{{ grant.closedOn }} — {{ residualLabel(grant) }}{{ grant.residualNote ? ' : ' + grant.residualNote : '' }}</dd>
          }
          @if (grant.conditions) {
            <dt>Conditions</dt>
            <dd>{{ grant.conditions }}</dd>
          }
          @if (grant.note) {
            <dt>Note</dt>
            <dd>{{ grant.note }}</dd>
          }
        </dl>
        <table class="table">
          <caption class="sr-only">Projets financés</caption>
          <thead>
            <tr>
              <th scope="col">Projet financé</th>
              <th scope="col" class="amount">Part</th>
            </tr>
          </thead>
          <tbody>
            @for (part of grant.allocations; track part.projectId) {
              <tr>
                <td>{{ part.projectCode }} — {{ part.projectName }}</td>
                <td class="amount">{{ amount(part.amount) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="2" class="muted">Aucun projet n'est encore indiqué. Il faudra en indiquer au moins un pour enregistrer l'accord.</td>
              </tr>
            }
          </tbody>
          @if (grant.allocations.length > 0) {
            <tfoot>
              <tr>
                <td>Total réparti</td>
                <td class="amount">{{ amount(grant.allocatedTotal) }}</td>
              </tr>
            </tfoot>
          }
        </table>
      </section>
      @if (grant.status === 'GRANTED' || grant.status === 'CLOSED') {
        <app-grant-finance [grant]="grant" [canManage]="canManage()" (changed)="refresh()" />
      }
    }

    @if (showFunders()) {
      <section class="panel" aria-label="Financeurs">
        <div class="head">
          <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">domain</mat-icon><span>Financeurs</span></h3>
        </div>
        <p class="muted">Les organismes qui accordent des subventions. Un financeur archivé ne reçoit plus de nouvelle demande, mais ses subventions restent consultables.</p>
        @if (funders().length === 0) {
          <p class="muted">Aucun financeur. @if (canManage()) { Cliquez sur « Nouveau financeur » pour ajouter le premier. }</p>
        } @else {
          <table class="table">
            <caption class="sr-only">Financeurs</caption>
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Type</th>
                <th scope="col">Contact</th>
                <th scope="col" class="amount">Subventions</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (funder of funders(); track funder.id) {
                <tr>
                  <td>
                    {{ funder.name }}
                    @if (funder.archived) {
                      <span class="chip">Archivé</span>
                    }
                  </td>
                  <td>{{ funderTypeLabel(funder) }}</td>
                  <td>{{ contact(funder) }}</td>
                  <td class="amount">{{ funder.grantCount }}</td>
                  <td class="row-actions">
                    @if (canManage()) {
                      <button mat-button type="button" [attr.aria-label]="'Modifier ' + funder.name" (click)="editFunder(funder)">Modifier</button>
                      @if (!funder.archived) {
                        <button mat-button type="button" [attr.aria-label]="'Archiver ' + funder.name" (click)="archiveFunder(funder)">Archiver</button>
                      }
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
export class GrantsPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  protected readonly grants = signal<GrantInfo[]>([]);
  protected readonly funders = signal<FunderInfo[]>([]);
  protected readonly selected = signal<GrantInfo | null>(null);
  protected readonly filter = signal<GrantStatus | ''>('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;
  protected readonly statuses = (Object.keys(GRANT_STATUS_LABELS) as GrantStatus[]).map((value) => ({ value, label: GRANT_STATUS_LABELS[value] }));

  protected readonly canManage = computed(() => {
    this.auth.permissions();
    return this.auth.can('grants:manage');
  });
  /** La liste des financeurs est réservée au droit global : un responsable limité à un projet ne la voit pas. */
  protected readonly showFunders = computed(() => {
    this.auth.permissions();
    return this.auth.can('grants:view');
  });

  constructor() {
    void this.load();
  }

  protected statusLabel(status: GrantStatus): string {
    return GRANT_STATUS_LABELS[status];
  }

  protected funderType(grant: GrantInfo): string {
    return FUNDER_TYPE_LABELS[grant.funder.type];
  }

  protected funderTypeLabel(funder: FunderInfo): string {
    return FUNDER_TYPE_LABELS[funder.type];
  }

  protected residualLabel(grant: GrantInfo): string {
    return grant.residual ? RESIDUAL_LABELS[grant.residual] : '';
  }

  protected contact(funder: FunderInfo): string {
    return [funder.contactName, funder.email, funder.phone].filter(Boolean).join(' · ') || '—';
  }

  protected projectCodes(grant: GrantInfo): string {
    return grant.allocations.map((a) => a.projectCode).join(', ') || '—';
  }

  /** Une phrase qui dit où en est le dossier et ce qu'on peut faire ensuite. */
  protected explain(grant: GrantInfo): string {
    switch (grant.status) {
      case 'REQUESTED':
        return "Le dossier est déposé. Passez-le en instruction quand le financeur l'étudie, puis enregistrez sa décision. Dites dès que possible quels projets il finance.";
      case 'UNDER_REVIEW':
        return 'Le financeur étudie le dossier. Enregistrez sa décision dès que vous la connaissez : un accord ou un refus.';
      case 'GRANTED':
        return "La subvention est accordée : le montant, la date et la répartition ne changent plus. Quand elle est terminée, clôturez-la en indiquant ce qu'il advient du reliquat.";
      case 'REFUSED':
        return 'Le financeur a refusé ce dossier. Il reste ici avec son motif.';
      case 'CLOSED':
        return 'Cette subvention est terminée. Le sort du reliquat est conservé ci-dessous.';
      case 'CANCELLED':
        return 'Cette demande a été abandonnée. Elle reste ici avec son motif.';
    }
  }

  protected async changeFilter(value: GrantStatus | ''): Promise<void> {
    this.filter.set(value);
    await this.load();
  }

  protected async open(grant: GrantInfo): Promise<void> {
    try {
      this.selected.set(await this.api.getGrant(grant.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger cette subvention.').message);
    }
  }

  protected async createGrant(): Promise<void> {
    const created = await this.dialogs.open<GrantInfo>(GrantDialog, { size: 'lg', data: { grant: null } });
    if (created) await this.done(`Demande « ${created.title} » enregistrée.`, created.id);
  }

  protected async edit(grant: GrantInfo): Promise<void> {
    const saved = await this.dialogs.open<GrantInfo>(GrantDialog, { size: 'lg', data: { grant } });
    if (saved) await this.done(`Subvention « ${saved.title} » enregistrée.`, saved.id);
  }

  protected async allocate(grant: GrantInfo): Promise<void> {
    const saved = await this.dialogs.open<GrantInfo>(AllocationsDialog, { size: 'lg', data: { grant } });
    if (saved) await this.done('Répartition entre les projets enregistrée.', saved.id);
  }

  protected async review(grant: GrantInfo): Promise<void> {
    try {
      await this.api.reviewGrant(grant.id);
      await this.done(`« ${grant.title} » est en instruction.`, grant.id);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "La subvention n'a pas pu passer en instruction. Réessayez dans un instant.").message);
    }
  }

  protected async decide(grant: GrantInfo): Promise<void> {
    const saved = await this.dialogs.open<GrantInfo>(GrantDecisionDialog, { size: 'lg', data: { grant } });
    if (saved) await this.done(`Accord enregistré : ${formatApiAmount(saved.grantedAmount ?? '0.00')} € pour « ${saved.title} ».`, saved.id);
  }

  protected async reason(grant: GrantInfo, mode: 'refuse' | 'cancel'): Promise<void> {
    const saved = await this.dialogs.open<GrantInfo>(GrantReasonDialog, { size: 'md', data: { grant, mode } });
    if (saved) await this.done(mode === 'refuse' ? 'Refus enregistré.' : 'Demande annulée.', saved.id);
  }

  protected async close(grant: GrantInfo): Promise<void> {
    const saved = await this.dialogs.open<GrantInfo>(GrantCloseDialog, { size: 'md', data: { grant } });
    if (saved) await this.done(`Subvention « ${saved.title} » clôturée.`, saved.id);
  }

  protected async createFunder(): Promise<void> {
    const created = await this.dialogs.open<FunderInfo>(FunderDialog, { size: 'md', data: { funder: null } });
    if (created) await this.done(`Financeur « ${created.name} » ajouté.`);
  }

  protected async editFunder(funder: FunderInfo): Promise<void> {
    const saved = await this.dialogs.open<FunderInfo>(FunderDialog, { size: 'md', data: { funder } });
    if (saved) await this.done(`Financeur « ${saved.name} » enregistré.`);
  }

  protected async archiveFunder(funder: FunderInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Archiver ${funder.name} ?`,
      message:
        `${funder.name} ne pourra plus recevoir de nouvelle demande de subvention.\n` +
        'Ses subventions existantes restent consultables. Un financeur archivé ne se réactive pas.',
      confirmLabel: 'Archiver',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.api.archiveFunder(funder.id);
      await this.done(`Financeur « ${funder.name} » archivé.`);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le financeur n'a pas pu être archivé. Réessayez dans un instant.").message);
    }
  }

  /** Recharge la liste et le détail après un versement ou une échéance, sans bandeau (le panneau a le sien). */
  protected async refresh(): Promise<void> {
    await this.load();
    const target = this.selected()?.id;
    if (target) this.selected.set(await this.api.getGrant(target));
  }

  private async done(message: string, show?: string): Promise<void> {
    this.notifier.success(message);
    await this.load();
    const target = show ?? this.selected()?.id;
    if (target) {
      try {
        this.selected.set(await this.api.getGrant(target));
      } catch {
        this.selected.set(null);
      }
    }
  }

  private async load(): Promise<void> {
    this.error.set(null);
    try {
      const status = this.filter();
      this.grants.set(await this.api.listGrants(status ? { status } : {}));
      if (this.showFunders()) this.funders.set(await this.api.listFunders());
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les subventions.').message);
    } finally {
      this.loading.set(false);
    }
  }
}
