import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ThemeService } from '../theme/theme.service';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import {
  AdminApiService,
  type FinancialAccountInfo,
  type ImportDecisionBody,
  type ImportInfo,
  type ImportLineInfo,
} from '../admin/admin-api.service';
import { formatApiAmount } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { AuthService } from '../auth/auth.service';
import { Notifier } from '../ui/notifier.service';
import { FrDatePipe } from '../ui/fr-date.pipe';

const STATUS_LABELS: Record<ImportLineInfo['status'], string> = {
  NEW: 'Nouvelle',
  DUPLICATE: 'Déjà importée',
  PROBABLE_MATCH: 'Ressemble à une saisie',
  ERROR: 'En erreur',
};

/** Valeur de décision d'une ligne à rapprocher : « LINK:<transaction> », « CREATE » ou « SKIP » ; vide tant que non choisie. */
const LINK = 'LINK:';

/**
 * Import d'un relevé OFX en deux temps : on dépose le fichier (analyse, rien n'est créé), on relit le classement des
 * lignes, on tranche les rapprochements proposés, puis on confirme. Une ligne qui ressemble à une saisie manuelle exige
 * un choix explicite : jamais de fusion automatique.
 */
@Component({
  selector: 'app-import-panel',
  imports: [FrDatePipe, FormsModule, MatButtonModule, MatCheckboxModule, MatIconModule],
  styleUrl: '../admin/admin-pages.scss',
  styles: `
    .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 12px;
    }
    select {
      background: var(--app-surface);
      border: 1px solid var(--app-field-border);
      border-radius: 8px;
      color: inherit;
      font: var(--mat-sys-body-medium);
      max-width: 100%;
      padding: 6px 8px;
    }
    select.todo {
      border-color: var(--mat-sys-error);
    }
  `,
  template: `
    <section class="panel" aria-label="Import d'un relevé OFX">
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }

      @if (!batch()) {
        <p class="muted">
          Le fichier est d'abord analysé : aucune transaction n'est créée avant votre confirmation. Formats pris en charge :
          OFX 1.x et 2.x, comptes bancaires en euro.
        </p>
        <div class="actions">
          <label class="muted" for="ofx-file">Fichier de relevé (.ofx)</label>
          <input id="ofx-file" type="file" accept=".ofx,.qfx,.xml,.txt" [disabled]="busy()" (change)="pick($event)" />
        </div>
      } @else {
        @let b = batch()!;
        <p class="muted">
          {{ b.fileName }} · {{ b.format === 'XML' ? 'OFX 2.x' : 'OFX 1.x' }}
          @if (b.periodStart && b.periodEnd) {
            · du {{ b.periodStart | frDate }} au {{ b.periodEnd | frDate }}
          }
          @if (b.accountHint) {
            · compte se terminant par {{ b.accountHint }}
          }
        </p>
        @if (b.documentId) {
          <p class="muted">
            Le fichier d'origine est conservé comme document restreint, pour garder la preuve de cet import.
            @if (canOpenOriginal()) {
              <a [href]="originalUrl(b.documentId)">Télécharger le fichier d'origine</a>
            }
          </p>
        }
        <div class="counts">
          <span class="chip">{{ b.summary.total }} opération(s)</span>
          <span class="chip">{{ b.summary.new }} nouvelle(s)</span>
          <span class="chip">{{ b.summary.probableMatch }} {{ simple() ? 'à relier' : 'à rapprocher' }}</span>
          <span class="chip">{{ b.summary.duplicate }} déjà importée(s)</span>
          <span class="chip">{{ b.summary.error }} en erreur</span>
        </div>

        <table class="table">
          <caption class="sr-only">Lignes du relevé</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">{{ simple() ? 'Description' : 'Libellé' }}</th>
              <th scope="col" class="amount">Montant</th>
              <th scope="col">État</th>
              <th scope="col">Décision</th>
            </tr>
          </thead>
          <tbody>
            @for (line of b.lines; track line.id) {
              <tr>
                <td>{{ (line.operationDate | frDate) || '—' }}</td>
                <td>
                  {{ line.label || '—' }}
                  @if (line.reference) {
                    <div class="muted">{{ simple() ? 'N° banque' : 'Réf.' }} {{ line.reference }}</div>
                  }
                </td>
                <td class="amount">{{ line.amount ? amount(line.amount) : '—' }}</td>
                <td>{{ statusLabel(line.status) }}</td>
                <td>
                  @switch (line.status) {
                    @case ('NEW') {
                      <select [attr.aria-label]="'Décision de la ligne ' + line.position" [ngModel]="choice(line)" (ngModelChange)="decide(line, $event)">
                        <option value="CREATE">Créer la transaction</option>
                        <option value="SKIP">Ignorer</option>
                      </select>
                    }
                    @case ('PROBABLE_MATCH') {
                      <select
                        [class.todo]="choice(line) === ''"
                        [attr.aria-label]="'Décision de la ligne ' + line.position"
                        [ngModel]="choice(line)"
                        (ngModelChange)="decide(line, $event)"
                      >
                        <option value="">— Choisir —</option>
                        @for (candidate of line.candidates; track candidate.transactionId) {
                          <option [value]="link + candidate.transactionId">
                            Rattacher à « {{ candidate.label }} » ({{ candidate.operationDate | frDate }})
                          </option>
                        }
                        <option value="CREATE">Paiement distinct : créer quand même</option>
                        <option value="SKIP">Ignorer</option>
                      </select>
                    }
                    @case ('DUPLICATE') {
                      <span class="muted">Ignorée : déjà enregistrée</span>
                    }
                    @default {
                      <span class="danger-text">{{ line.errors.join(' ') }}</span>
                    }
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        @if (b.ledgerBalance) {
          <mat-checkbox [checked]="recordStatement()" (change)="recordStatement.set($event.checked)">
            Enregistrer aussi le solde du relevé ({{ amount(b.ledgerBalance) }} €@if (b.ledgerBalanceDate) {
              au {{ b.ledgerBalanceDate | frDate }}
            })
          </mat-checkbox>
          <p class="muted">Une preuve datée : elle mesure l'écart avec le solde calculé, elle ne {{ simple() ? 'vérifie pas' : 'rapproche pas' }} le compte.</p>
        }

        @if (pending() > 0) {
          <p class="muted" role="status">{{ pending() }} ligne(s) à {{ simple() ? 'relier' : 'rapprocher' }} attendent votre choix.</p>
        }
        <div class="actions">
          <button mat-flat-button type="button" [disabled]="busy() || pending() > 0" (click)="confirm()">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">task_alt</mat-icon> Confirmer l'import
          </button>
          <button mat-button type="button" [disabled]="busy()" (click)="cancel()">Annuler l'analyse</button>
        </div>
      }
    </section>
  `,
})
export class ImportPanel {
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  private readonly api = inject(AdminApiService);
  private readonly notifier = inject(Notifier);
  private readonly auth = inject(AuthService);

  /** Le fichier d'origine est un document restreint : il faut pouvoir lire les documents ET les documents restreints. */
  protected readonly canOpenOriginal = computed(() => {
    this.auth.permissions();
    return this.auth.can('documents:view') && this.auth.can('documents.restricted:view');
  });
  protected originalUrl(documentId: string): string {
    return this.api.documentDownloadUrl(documentId);
  }

  readonly account = input.required<FinancialAccountInfo>();
  /** Émis après une confirmation : les transactions et les soldes ont changé. */
  readonly imported = output<{ created: number; linked: number; skipped: number }>();

  protected readonly batch = signal<ImportInfo | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly recordStatement = signal(false);
  protected readonly link = LINK;
  protected readonly amount = formatApiAmount;

  /** Décisions choisies : ligne → valeur. Les lignes nouvelles prennent « créer » par défaut, pas les rapprochements. */
  private readonly decisions = signal<Record<string, string>>({});
  protected readonly pending = computed(
    () => this.batch()?.lines.filter((l) => l.status === 'PROBABLE_MATCH' && this.choice(l) === '').length ?? 0,
  );

  protected statusLabel(status: ImportLineInfo['status']): string {
    return STATUS_LABELS[status];
  }

  protected choice(line: ImportLineInfo): string {
    return this.decisions()[line.id] ?? (line.status === 'NEW' ? 'CREATE' : '');
  }

  protected decide(line: ImportLineInfo, value: string): void {
    this.decisions.update((current) => ({ ...current, [line.id]: value }));
  }

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      this.batch.set(await this.api.analyzeImport(this.account().id, file));
      this.decisions.set({});
      this.recordStatement.set(false);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le fichier n'a pas pu être analysé.").message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirm(): Promise<void> {
    const current = this.batch();
    if (!current) return;
    const decisions: ImportDecisionBody[] = [];
    for (const line of current.lines) {
      if (line.status !== 'NEW' && line.status !== 'PROBABLE_MATCH') continue;
      const value = this.choice(line);
      if (value.startsWith(LINK)) decisions.push({ lineId: line.id, action: 'LINK', transactionId: value.slice(LINK.length) });
      else if (value === 'CREATE' || value === 'SKIP') decisions.push({ lineId: line.id, action: value });
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      const done = await this.api.commitImport(current.id, { decisions, recordStatement: this.recordStatement() });
      const result = done.summary.result!;
      this.batch.set(null);
      this.notifier.success(`Import confirmé : ${result.created} créée(s), ${result.linked} ${this.simple() ? 'reliée(s)' : 'rapprochée(s)'}, ${result.skipped} ignorée(s).`);
      this.imported.emit(result);
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'import n'a pas pu être confirmé.").message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(): Promise<void> {
    const current = this.batch();
    if (!current) return;
    this.busy.set(true);
    try {
      await this.api.cancelImport(current.id);
      this.batch.set(null);
      this.notifier.success('Analyse annulée : aucune transaction créée.');
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'analyse n'a pas pu être annulée.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
