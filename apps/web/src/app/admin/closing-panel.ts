import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { describeHttpError } from '../auth/error-messages';
import { formatApiAmount } from '../accounting/amount';
import { AdminApiService, type AccountInfo, type ClosingReportInfo, type FiscalYearInfo } from './admin-api.service';

/**
 * Clôture d'un exercice : contrôles, fermeture à la saisie (annulable), puis clôture définitive qui reporte les soldes
 * dans l'exercice suivant. Les ajustements se saisissent avant la fermeture.
 */
@Component({
  selector: 'app-closing-panel',
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatSelectModule],
  styleUrl: './admin-pages.scss',
  template: `
    <section class="panel" [attr.aria-label]="'Clôture de ' + year().label">
      <div class="head">
        <h4>Clôture de l'exercice {{ year().label }}</h4>
        <button mat-button type="button" (click)="closed.emit()">Fermer</button>
      </div>

      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @if (notice(); as message) {
        <p class="success" role="status">{{ message }}</p>
      }

      @if (report(); as r) {
        @if (r.status === 'CLOSED') {
          <p class="muted">Cet exercice est clôturé : ses soldes ont été reportés dans l'exercice suivant.</p>
        } @else {
          <ul class="checks">
            @for (check of r.checks; track check.code) {
              <li [class.danger-text]="check.level === 'BLOCKING'">
                <mat-icon fontSet="material-icons-outlined">{{ check.level === 'BLOCKING' ? 'block' : 'info' }}</mat-icon>
                <span class="sr-only">{{ check.level === 'BLOCKING' ? 'Bloquant : ' : 'Avertissement : ' }}</span>{{ check.message }}
              </li>
            }
          </ul>
          @if (r.checks.length === 0) {
            <p class="success">Aucun point bloquant.</p>
          }
          @if (r.preview; as p) {
            <p class="muted">
              À reporter : {{ p.accountCount }} compte(s) de bilan.
              @switch (p.result.kind) {
                @case ('SURPLUS') {
                  Excédent de {{ amount(p.result.amount) }} €.
                }
                @case ('DEFICIT') {
                  Déficit de {{ amount(p.result.amount) }} €.
                }
                @default {
                  Résultat nul.
                }
              }
            </p>
          }

          @if (r.status === 'OPEN') {
            <p class="muted">
              Saisissez d'abord vos ajustements de clôture. « Fermer à la saisie » empêche ensuite toute comptabilisation
              dans l'exercice ; vous pouvez l'annuler tant que la clôture n'est pas définitive.
            </p>
            <div class="actions">
              <button mat-flat-button type="button" [disabled]="busy() || !r.canStart" (click)="start()"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock_clock</mat-icon> Fermer à la saisie</button>
            </div>
          } @else {
            <form class="panel" [formGroup]="form" (ngSubmit)="close()" novalidate>
              @if (r.preview?.result?.kind === 'SURPLUS') {
                <mat-form-field appearance="outline">
                  <mat-label>Compte d'excédent (report du résultat)</mat-label>
                  <mat-select formControlName="surplusAccountId" required>
                    @for (account of equityAccounts(); track account.id) {
                      <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
              @if (r.preview?.result?.kind === 'DEFICIT') {
                <mat-form-field appearance="outline">
                  <mat-label>Compte de déficit (report du résultat)</mat-label>
                  <mat-select formControlName="deficitAccountId" required>
                    @for (account of equityAccounts(); track account.id) {
                      <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
              <mat-checkbox formControlName="confirmed">
                Je comprends que la clôture est définitive : l'exercice ne pourra plus être rouvert.
              </mat-checkbox>
              <p class="muted">L'affectation du résultat par l'assemblée générale reste une écriture distincte, à saisir ensuite.</p>
              <div class="actions">
                <button mat-flat-button type="submit" [disabled]="busy() || !r.canClose || !ready()"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock</mat-icon> Clôturer définitivement</button>
                <button mat-button type="button" [disabled]="busy()" (click)="cancel()">Annuler la fermeture</button>
              </div>
            </form>
          }
        }
      } @else if (!error()) {
        <p class="muted">Chargement…</p>
      }
    </section>
  `,
  styles: `
    .checks {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    .checks li {
      align-items: center;
      display: flex;
      gap: 8px;
      padding: 2px 0;
    }
  `,
})
export class ClosingPanel {
  private readonly api = inject(AdminApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly year = input.required<FiscalYearInfo>();
  readonly accounts = input.required<AccountInfo[]>();
  /** Émis quand l'état de l'exercice a changé : la liste parente doit se recharger. */
  readonly changed = output<void>();
  readonly closed = output<void>();

  protected readonly report = signal<ClosingReportInfo | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly amount = formatApiAmount;

  protected readonly equityAccounts = computed(() => this.accounts().filter((a) => a.active && /^[1-5]/.test(a.number)));
  protected readonly form = this.fb.group({ surplusAccountId: [''], deficitAccountId: [''], confirmed: [false] });
  private readonly formChanged = signal(0);
  protected readonly ready = computed(() => {
    this.formChanged();
    const kind = this.report()?.preview?.result.kind;
    const value = this.form.getRawValue();
    if (!value.confirmed) return false;
    if (kind === 'SURPLUS') return value.surplusAccountId !== '';
    if (kind === 'DEFICIT') return value.deficitAccountId !== '';
    return true;
  });

  private readonly yearId = computed(() => this.year().id);

  constructor() {
    this.form.valueChanges.subscribe(() => this.formChanged.update((n) => n + 1));
    effect(() => {
      void this.load(this.yearId());
    });
  }

  protected start(): Promise<void> {
    return this.run(async () => {
      this.report.set(await this.api.startClosing(this.year().id));
      this.notice.set("Exercice fermé à la saisie. Vérifiez puis clôturez, ou annulez la fermeture.");
    });
  }

  protected cancel(): Promise<void> {
    return this.run(async () => {
      this.report.set(await this.api.cancelClosing(this.year().id));
      this.notice.set('Fermeture annulée : la saisie est de nouveau possible.');
    });
  }

  protected close(): Promise<void> {
    const value = this.form.getRawValue();
    return this.run(async () => {
      await this.api.closeFiscalYear(this.year().id, {
        surplusAccountId: value.surplusAccountId || null,
        deficitAccountId: value.deficitAccountId || null,
      });
      this.report.set(await this.api.closingReport(this.year().id));
      this.notice.set("Exercice clôturé. Les à-nouveaux sont comptabilisés dans l'exercice suivant.");
    });
  }

  private async load(id: string): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    try {
      this.report.set(await this.api.closingReport(id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les contrôles de clôture.').message);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      this.changed.emit();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'opération a échoué. Réessayez.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
