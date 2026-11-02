import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AdminApiService,
  type FinancialAccountInfo,
  type PointableTransactionInfo,
  type ReconciliationInfo,
  type StatementInfo,
} from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { ThemeService } from '../theme/theme.service';
import { PageHeader } from '../ui/page-header';
import { StatementDialog, type StatementDialogData } from './statement-dialog';

/**
 * Rapprochement bancaire (ADR 0018) : page dédiée, trop vaste pour une boîte de dialogue. On choisit un relevé, on
 * coche les transactions qui y figurent jusqu'à ce que l'écart soit nul, puis on valide.
 */
@Component({
  selector: 'app-reconciliation-page',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatSelectModule, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .figures {
      display: grid;
      gap: 12px 24px;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      margin: 12px 0 0;
    }
    .figure dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .figure dd {
      font: var(--mat-sys-title-large);
      font-variant-numeric: tabular-nums;
      margin: 2px 0 0;
    }
    .figure .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .gap-zero {
      color: var(--app-success, var(--mat-sys-primary));
    }
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .negative {
      color: var(--mat-sys-error);
    }
    .checks {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
    }
    .checks li {
      margin: 6px 0;
    }
    .history {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .history li {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      justify-content: space-between;
      padding: 8px 0;
    }
    .start-form {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
  template: `
    <app-page-header
      [title]="(simple() ? 'Vérification avec la banque' : 'Rapprochement') + (account() ? ' de ' + account()!.name : simple() ? '' : ' bancaire')"
      icon="fact_check"
      [description]="simple()
        ? 'Comparez vos mouvements au relevé de la banque : cochez ceux qui y figurent jusqu’à ce que l’écart soit zéro. Cela permet de repérer un oubli ou une erreur. Ce qui n’y est pas encore (un chèque non débité…) reste simplement non coché.'
        : 'Comparez vos transactions au relevé de la banque : cochez celles qui y figurent jusqu’à ce que l’écart soit zéro. Ce qui n’y est pas encore (un chèque non débité…) reste simplement non coché.'"
    >
      <a mat-stroked-button routerLink="/comptes">
        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">arrow_back</mat-icon> Retour aux comptes
      </a>
      @if (canWrite() && account() && !account()!.archivedOn) {
        <button mat-stroked-button type="button" (click)="recordStatement()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">receipt_long</mat-icon> Enregistrer un solde de relevé
        </button>
      }
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (loading()) {
      <p class="muted">Chargement…</p>
    } @else if (current(); as rec) {
      <section class="panel" aria-label="Rapprochement en cours">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">fact_check</mat-icon><span>Relevé au {{ rec.periodEnd }}</span></h3>
        <dl class="figures">
          <div class="figure">
            <dt>Solde du relevé</dt>
            <dd>{{ amount(rec.closingBalance) }} €</dd>
            <div class="hint">Le solde de fin indiqué par votre banque.</div>
          </div>
          <div class="figure">
            <dt>{{ simple() ? 'Solde vérifié' : 'Solde rapproché' }}</dt>
            <dd>{{ amount(rec.pointedBalance) }} €</dd>
            <div class="hint">{{ amount(rec.openingBalance) }} € au départ + {{ rec.pointedCount }} {{ simple() ? 'mouvement(s) coché(s)' : 'transaction(s) cochée(s)' }}</div>
          </div>
          <div class="figure">
            <dt>Écart</dt>
            <dd [class.gap-zero]="gapIsZero()" [class.danger-text]="!gapIsZero()">{{ amount(rec.gap) }} €</dd>
            <div class="hint">{{ gapIsZero() ? 'Ça tombe juste.' : 'Doit être à zéro pour valider.' }}</div>
          </div>
          <div class="figure">
            <dt>En circulation</dt>
            <dd>{{ rec.outstandingCount }}</dd>
            <div class="hint">
              {{ amount(rec.outstandingTotal) }} € enregistrés mais pas sur ce relevé (chèque non débité, virement en route…).
            </div>
          </div>
        </dl>
        @if (rec.checks.length > 0) {
          <ul class="checks">
            @for (check of rec.checks; track check.code) {
              <li>
                <span [class]="check.level === 'BLOCKING' ? 'alert' : 'muted'" [attr.role]="check.level === 'BLOCKING' ? 'alert' : null">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ check.level === 'BLOCKING' ? 'error' : 'info' }}</mat-icon>
                  {{ check.message }}
                </span>
              </li>
            }
          </ul>
        }
      </section>

      @if (canWrite()) {
        <section class="panel" aria-label="Actions du rapprochement">
          <div class="actions">
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="pointImported()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">playlist_add_check</mat-icon> Cocher les transactions importées
            </button>
            <button mat-flat-button type="button" [disabled]="busy() || !rec.canValidate" (click)="validate()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">task_alt</mat-icon> {{ simple() ? 'Valider la vérification' : 'Valider le rapprochement' }}
            </button>
            <button mat-button class="danger" type="button" [disabled]="busy()" (click)="abandon()">Abandonner</button>
          </div>
          <p class="muted">
            Les transactions importées de votre banque sont par nature sur un relevé : un clic pour les cocher toutes. Les
            saisies à la main se cochent une à une.
          </p>
        </section>
      }

      <section class="panel" aria-label="Transactions à cocher">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">checklist</mat-icon><span>Transactions jusqu'au {{ rec.periodEnd }}</span></h3>
        @if (items().length === 0) {
          <p class="muted">{{ simple() ? 'Aucun mouvement à vérifier jusqu’à cette date. Importez le relevé de votre banque ou enregistrez les mouvements manquants.' : 'Aucune transaction à rapprocher jusqu’à cette date. Importez le relevé de votre banque ou saisissez les mouvements manquants.' }}</p>
        } @else {
          <table class="table">
            <caption class="sr-only">Transactions à cocher</caption>
            <thead>
              <tr>
                <th scope="col">Sur le relevé</th>
                <th scope="col">Date</th>
                <th scope="col">Libellé</th>
                <th scope="col">{{ simple() ? 'Situation' : 'Comptabilisation' }}</th>
                <th scope="col" class="amount">Montant</th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.transaction.id) {
                <tr>
                  <td>
                    <mat-checkbox
                      [checked]="item.pointed"
                      [disabled]="busy() || !canWrite()"
                      [attr.aria-label]="'Pointer ' + item.transaction.label"
                      (change)="toggle(item, $event.checked)"
                    />
                  </td>
                  <td>{{ item.transaction.operationDate }}</td>
                  <td>
                    {{ item.transaction.label }}
                    @if (item.transaction.bankIdentified) {
                      <span class="chip">Banque</span>
                    }
                  </td>
                  <td>
                    @switch (item.transaction.accounting) {
                      @case ('POSTED') {
                        <span class="status ok">Comptabilisée</span>
                      }
                      @case ('IN_PROGRESS') {
                        <span class="muted">En cours</span>
                      }
                      @default {
                        <span [class]="item.pointed ? 'danger-text' : 'muted'">À comptabiliser</span>
                      }
                    }
                  </td>
                  <td class="amount" [class.negative]="item.transaction.amount.startsWith('-')">{{ amount(item.transaction.amount) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    } @else if (account()) {
      <section class="panel" aria-label="Nouveau rapprochement">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">play_circle</mat-icon><span>Commencer un rapprochement</span></h3>
        @if (!canWrite()) {
          <p class="muted">Vous pouvez consulter les rapprochements, mais pas en commencer : demandez à la personne qui tient les comptes.</p>
        } @else if (available().length === 0) {
          <p>
            Pour rapprocher le compte, il faut d'abord enregistrer le solde indiqué sur un relevé de votre banque, plus récent
            que {{ lastValidated() ? 'le ' + lastValidated() : 'le début du compte' }}. Utilisez « Enregistrer un solde de relevé »
            ci-dessus.
          </p>
        } @else {
          <p class="muted">
            Choisissez le relevé à contrôler. Le solde de départ est
            {{ lastValidated() ? 'celui du dernier rapprochement validé' : "le solde d'ouverture du compte" }}.
          </p>
          <form class="start-form" [formGroup]="startForm" (ngSubmit)="start()">
            <mat-form-field appearance="outline">
              <mat-label>Relevé</mat-label>
              <mat-select formControlName="statementId" required>
                @for (statement of available(); track statement.id) {
                  <mat-option [value]="statement.id">Au {{ statement.periodEnd }} — solde {{ amount(statement.closingBalance) }} €</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <button mat-flat-button type="submit" [disabled]="busy()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">play_arrow</mat-icon> Commencer
            </button>
          </form>
        }
      </section>
    }

    @if (!loading() && history().length > 0) {
      <section class="panel" aria-label="Historique des rapprochements">
        <h3><mat-icon fontSet="material-icons-outlined" aria-hidden="true">history</mat-icon><span>Rapprochements précédents</span></h3>
        <ul class="history">
          @for (rec of history(); track rec.id) {
            <li>
              <span>
                @if (rec.status === 'VALIDATED') {
                  <span class="status ok"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">verified</mat-icon> Rapproché au {{ rec.periodEnd }}</span>
                } @else {
                  <span class="muted">Annulé (relevé du {{ rec.periodEnd }})</span>
                }
                · solde {{ amount(rec.closingBalance) }} €, {{ rec.pointedCount }} transaction(s)
              </span>
              @if (rec.id === lastValidatedId() && !current() && canWrite()) {
                <button mat-button class="danger" type="button" [attr.aria-label]="'Annuler le rapprochement du ' + rec.periodEnd" [disabled]="busy()" (click)="cancel(rec)">
                  Annuler ce rapprochement
                </button>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class ReconciliationPage {
  private readonly api = inject(AdminApiService);
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly account = signal<FinancialAccountInfo | null>(null);
  private readonly reconciliations = signal<ReconciliationInfo[]>([]);
  private readonly statements = signal<StatementInfo[]>([]);
  protected readonly items = signal<PointableTransactionInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;
  protected readonly startForm = this.fb.group({ statementId: [''] });

  protected readonly canWrite = computed(() => {
    this.auth.permissions();
    return this.auth.can('imports:post');
  });
  protected readonly current = computed(() => this.reconciliations().find((r) => r.status === 'IN_PROGRESS') ?? null);
  protected readonly history = computed(() => this.reconciliations().filter((r) => r.status !== 'IN_PROGRESS'));
  private readonly lastValidatedRec = computed(() => this.reconciliations().find((r) => r.status === 'VALIDATED') ?? null);
  protected readonly lastValidated = computed(() => this.lastValidatedRec()?.periodEnd ?? null);
  protected readonly lastValidatedId = computed(() => this.lastValidatedRec()?.id ?? null);
  protected readonly gapIsZero = computed(() => Number(this.current()?.gap ?? '0') === 0);
  /** Relevés qu'on peut encore rapprocher : plus récents que le dernier rapprochement validé et pas déjà rapprochés. */
  protected readonly available = computed(() => {
    const taken = new Set(this.reconciliations().filter((r) => r.status !== 'CANCELLED').map((r) => r.statementId));
    const last = this.lastValidated();
    return this.statements().filter((s) => !taken.has(s.id) && (!last || s.periodEnd > last));
  });

  constructor() {
    void this.load();
  }

  protected async start(): Promise<void> {
    const { statementId } = this.startForm.getRawValue();
    if (!statementId) {
      this.error.set('Choisissez le relevé à rapprocher, puis cliquez sur « Commencer ».');
      return;
    }
    await this.run(async () => {
      await this.api.startReconciliation(this.account()!.id, statementId);
      this.notifier.success('Rapprochement commencé : cochez les transactions qui figurent sur le relevé.');
      await this.reload();
    }, "Le rapprochement n'a pas pu commencer.");
  }

  protected async toggle(item: PointableTransactionInfo, checked: boolean): Promise<void> {
    const rec = this.current();
    if (!rec) return;
    await this.run(async () => {
      const updated = checked
        ? await this.api.pointTransactions(rec.id, [item.transaction.id])
        : await this.api.unpointTransactions(rec.id, [item.transaction.id]);
      this.reconciliations.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      this.items.update((list) => list.map((x) => (x.transaction.id === item.transaction.id ? { ...x, pointed: checked } : x)));
    }, "Le pointage n'a pas pu être enregistré.");
  }

  protected async pointImported(): Promise<void> {
    const rec = this.current();
    if (!rec) return;
    await this.run(async () => {
      const before = rec.pointedCount;
      const updated = await this.api.pointImportedTransactions(rec.id);
      const added = updated.pointedCount - before;
      this.notifier.success(added > 0 ? `${added} transaction(s) importée(s) cochée(s).` : 'Aucune transaction importée à cocher.');
      await this.reload();
    }, 'Les transactions importées n’ont pas pu être cochées.');
  }

  protected async validate(): Promise<void> {
    const rec = this.current();
    if (!rec) return;
    const confirmed = await this.dialogs.confirm({
      title: this.simple() ? 'Valider cette vérification ?' : 'Valider ce rapprochement ?',
      message: this.simple()
        ? `Le compte sera déclaré vérifié avec le relevé du ${rec.periodEnd} (solde ${this.amount(rec.closingBalance)} €). Les ${rec.pointedCount} mouvements cochés ne pourront plus être modifiés ni supprimés. En cas d’erreur, vous pourrez annuler cette vérification tant qu’elle est la dernière du compte.`
        : `Le compte sera déclaré rapproché avec le relevé du ${rec.periodEnd} (solde ${this.amount(rec.closingBalance)} €). Les ${rec.pointedCount} transactions cochées ne pourront plus être modifiées ni supprimées. En cas d’erreur, vous pourrez annuler ce rapprochement tant qu’il est le dernier du compte.`,
      confirmLabel: 'Valider',
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.validateReconciliation(rec.id);
      this.notifier.success(this.simple() ? 'Vérification validée : le compte est vérifié avec la banque.' : 'Rapprochement validé : le compte est rapproché.');
      await this.reload();
    }, "Le rapprochement n'a pas pu être validé.");
  }

  protected async abandon(): Promise<void> {
    const rec = this.current();
    if (!rec) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Abandonner ce rapprochement ?',
      message: 'Les transactions cochées seront décochées. Rien d’autre n’est modifié : vous pourrez recommencer quand vous voulez.',
      confirmLabel: 'Abandonner',
      cancelLabel: 'Continuer',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.cancelReconciliation(rec.id);
      this.notifier.success('Rapprochement abandonné.');
      await this.reload();
    }, "Le rapprochement n'a pas pu être abandonné.");
  }

  protected async cancel(rec: ReconciliationInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Annuler ce rapprochement ?',
      message: `Le rapprochement du ${rec.periodEnd} sera annulé : ses ${rec.pointedCount} transactions pourront de nouveau être modifiées. L'annulation est conservée dans l'historique. À faire seulement si vous avez constaté une erreur.`,
      confirmLabel: 'Annuler le rapprochement',
      cancelLabel: 'Garder',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.cancelReconciliation(rec.id);
      this.notifier.success('Rapprochement annulé.');
      await this.reload();
    }, "Le rapprochement n'a pas pu être annulé.");
  }

  protected async recordStatement(): Promise<void> {
    const account = this.account();
    if (!account) return;
    const saved = await this.dialogs.open<boolean, StatementDialogData>(StatementDialog, { size: 'sm', data: { account } });
    if (!saved) return;
    this.notifier.success('Solde de relevé enregistré.');
    await this.reload();
  }

  private async reload(): Promise<void> {
    const account = this.account();
    if (!account) return;
    const [reconciliations, statements] = await Promise.all([this.api.listReconciliations(account.id), this.api.listStatements(account.id)]);
    this.reconciliations.set(reconciliations);
    this.statements.set(statements);
    const current = reconciliations.find((r) => r.status === 'IN_PROGRESS');
    this.items.set(current ? await this.api.reconciliationTransactions(current.id) : []);
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    try {
      const found = (await this.api.listFinancialAccounts()).find((a) => a.id === id);
      if (!found) {
        this.error.set("Ce compte n'existe pas ou n'est plus disponible.");
        return;
      }
      this.account.set(found);
      await this.reload();
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger le rapprochement.').message);
    } finally {
      this.loading.set(false);
    }
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
