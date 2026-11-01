import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { formatApiAmount } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { Notifier } from '../ui/notifier.service';
import { AdminApiService, type AccountInfo, type ClosingReportInfo, type FiscalYearInfo } from './admin-api.service';

export interface ClosingDialogData {
  year: FiscalYearInfo;
  accounts: AccountInfo[];
}

/**
 * Clôture d'un exercice, en boîte de dialogue : contrôles, fermeture à la saisie (annulable), puis clôture définitive qui
 * reporte les soldes dans l'exercice suivant. La boîte reste ouverte entre les étapes ; la page recharge à sa fermeture.
 */
@Component({
  selector: 'app-closing-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatSelectModule],
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
    .steps {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 12px;
    }
  `,
  template: `
    <h2 mat-dialog-title>Clôture de l'exercice {{ data.year.label }}</h2>
    <mat-dialog-content>
      <p class="steps">
        Clôturer, c'est arrêter les comptes de la période : les soldes sont reportés dans l'exercice suivant. Vous pouvez
        fermer la saisie d'abord pour vérifier tranquillement, puis annuler si vous avez oublié quelque chose.
      </p>

      @if (error(); as message) {
        <div class="alert" role="alert"><p>{{ message }}</p></div>
      }

      @if (report(); as r) {
        @if (r.status === 'CLOSED') {
          <p class="success">Cet exercice est clôturé : ses soldes ont été reportés dans l'exercice suivant. Il ne peut plus être rouvert.</p>
        } @else {
          <ul class="checks">
            @for (check of r.checks; track check.code) {
              <li [class.danger-text]="check.level === 'BLOCKING'">
                <mat-icon fontSet="material-icons-outlined">{{ check.level === 'BLOCKING' ? 'block' : 'info' }}</mat-icon>
                <span class="sr-only">{{ check.level === 'BLOCKING' ? 'À régler avant de continuer : ' : 'Bon à savoir : ' }}</span>{{ check.message }}
              </li>
            }
          </ul>
          @if (r.checks.length === 0) {
            <p class="success">Rien ne bloque la clôture.</p>
          }
          @if (r.preview; as p) {
            <p class="muted">
              Sera reporté : {{ p.accountCount }} compte(s) de bilan.
              @switch (p.result.kind) {
                @case ('SURPLUS') {
                  Résultat de l'exercice : excédent de {{ amount(p.result.amount) }} €.
                }
                @case ('DEFICIT') {
                  Résultat de l'exercice : déficit de {{ amount(p.result.amount) }} €.
                }
                @default {
                  Résultat de l'exercice : nul.
                }
              }
            </p>
          }

          @if (r.status === 'OPEN') {
            <p class="muted">
              Saisissez d'abord vos ajustements de fin d'année. « Fermer à la saisie » empêche ensuite toute comptabilisation
              dans l'exercice ; vous pourrez l'annuler tant que la clôture n'est pas définitive.
            </p>
            <button mat-flat-button type="button" [disabled]="busy() || !r.canStart" (click)="start()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock_clock</mat-icon> Fermer à la saisie
            </button>
          } @else {
            <form [formGroup]="form" (ngSubmit)="close()" novalidate>
              @if (r.preview?.result?.kind === 'SURPLUS') {
                <mat-form-field appearance="outline">
                  <mat-label>Où reporter l'excédent ?</mat-label>
                  <mat-select formControlName="surplusAccountId" required>
                    @for (account of equityAccounts(); track account.id) {
                      <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
                    }
                  </mat-select>
                  <mat-hint>Un compte de fonds propres (ex. 120 « Report à nouveau excédentaire »).</mat-hint>
                </mat-form-field>
              }
              @if (r.preview?.result?.kind === 'DEFICIT') {
                <mat-form-field appearance="outline">
                  <mat-label>Où reporter le déficit ?</mat-label>
                  <mat-select formControlName="deficitAccountId" required>
                    @for (account of equityAccounts(); track account.id) {
                      <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
                    }
                  </mat-select>
                  <mat-hint>Un compte de fonds propres (ex. 129 « Report à nouveau déficitaire »).</mat-hint>
                </mat-form-field>
              }
              <mat-checkbox formControlName="confirmed">
                Je comprends que la clôture est définitive : l'exercice ne pourra plus être rouvert.
              </mat-checkbox>
              <p class="muted">L'affectation du résultat par l'assemblée générale reste une écriture distincte, à saisir ensuite.</p>
              <div class="actions">
                <button mat-flat-button type="submit" [disabled]="busy() || !r.canClose || !ready()">
                  <mat-icon fontSet="material-icons-outlined" aria-hidden="true">lock</mat-icon> Clôturer définitivement
                </button>
                <button mat-button type="button" [disabled]="busy()" (click)="cancel()">Annuler la fermeture</button>
              </div>
            </form>
          }
        }
      } @else if (!error()) {
        <p class="muted">Chargement…</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="true">Fermer</button>
    </mat-dialog-actions>
  `,
})
export class ClosingDialog {
  private readonly api = inject(AdminApiService);
  private readonly notifier = inject(Notifier);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<ClosingDialogData>(MAT_DIALOG_DATA);

  protected readonly report = signal<ClosingReportInfo | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly amount = formatApiAmount;

  protected readonly equityAccounts = computed(() => this.data.accounts.filter((a) => a.active && /^[1-5]/.test(a.number)));
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

  constructor() {
    this.form.valueChanges.subscribe(() => this.formChanged.update((n) => n + 1));
    void this.load();
  }

  protected start(): Promise<void> {
    return this.run(async () => {
      this.report.set(await this.api.startClosing(this.data.year.id));
      this.notifier.success("Exercice fermé à la saisie. Vérifiez, puis clôturez ou annulez la fermeture.");
    });
  }

  protected cancel(): Promise<void> {
    return this.run(async () => {
      this.report.set(await this.api.cancelClosing(this.data.year.id));
      this.notifier.success('Fermeture annulée : la saisie est de nouveau possible.');
    });
  }

  protected close(): Promise<void> {
    const value = this.form.getRawValue();
    return this.run(async () => {
      await this.api.closeFiscalYear(this.data.year.id, {
        surplusAccountId: value.surplusAccountId || null,
        deficitAccountId: value.deficitAccountId || null,
      });
      this.report.set(await this.api.closingReport(this.data.year.id));
      this.notifier.success("Exercice clôturé. Les à-nouveaux sont comptabilisés dans l'exercice suivant.");
    });
  }

  private async load(): Promise<void> {
    try {
      this.report.set(await this.api.closingReport(this.data.year.id));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Impossible de charger les contrôles de clôture. Réessayez dans un instant.").message);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'opération a échoué. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
