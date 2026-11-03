import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FinancialAccountInfo, type FiscalYearInfo } from '../admin/admin-api.service';
import { centsToApi, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { DateField } from '../ui/date-field';

/** Dernier jour d'une période de 12 mois qui commence à `start` (AAAA-MM-JJ), en dates UTC : aucun décalage d'heure. */
export function endOfTwelveMonths(start: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]) + 1, Number(match[2]) - 1, Number(match[3]) - 1));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** « Exercice 2026 » ou « Exercice 2026-2027 » selon que la période tient dans une année civile. */
export function yearLabel(start: string, end: string): string {
  const first = start.slice(0, 4);
  const last = end.slice(0, 4);
  return first === last ? `Exercice ${first}` : `Exercice ${first}-${last}`;
}

/** Période de la comptabilité (exercice), en langage courant. Renvoie l'exercice créé. */
@Component({
  selector: 'app-start-year-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="La période de votre comptabilité"
        description="Une association arrête ses comptes une fois par an, sur une période qu’on appelle un « exercice ». Le plus souvent, c’est l’année civile (1er janvier au 31 décembre) ; certaines associations suivent l’année scolaire. Rien n’est définitif : vous pourrez créer les exercices suivants plus tard."
        submitLabel="Valider la période"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <div class="row">
          <app-date-field label="Premier jour" formControlName="start" errorText="Indiquez le premier jour de la période." required />
          <app-date-field label="Dernier jour" formControlName="end" hint="Rempli pour 12 mois ; modifiez-le si votre période est plus courte ou plus longue." errorText="Indiquez le dernier jour de la période." required />
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class StartYearDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<StartYearDialog, FiscalYearInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    start: [`${new Date().getFullYear()}-01-01`, [Validators.required]],
    end: [`${new Date().getFullYear()}-12-31`, [Validators.required]],
  });

  constructor() {
    this.form.controls.start.valueChanges.subscribe((start) => {
      const end = endOfTwelveMonths(start);
      if (end) this.form.controls.end.setValue(end);
    });
  }

  protected async save(): Promise<void> {
    const { start, end } = this.form.getRawValue();
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('Indiquez le premier et le dernier jour de la période.');
      this.details.set([]);
      return;
    }
    if (end < start) {
      this.error.set('Le dernier jour est avant le premier. Vérifiez les deux dates.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.createFiscalYear({ label: yearLabel(start, end), start, end }));
    } catch (failure) {
      const described = describeHttpError(failure, "La période n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface StartAccountDialogData {
  /** Comptes financiers déjà créés : un compte du plan ne sert qu'à un seul d'entre eux. */
  existing: FinancialAccountInfo[];
  /** Date de départ proposée (début de l'exercice quand on repart d'une situation d'ouverture) ; sinon aujourd'hui. */
  defaultDate?: string | null;
}

/**
 * Ajout d'un compte bancaire ou d'une caisse sans parler de plan comptable : le logiciel choisit (ou crée) le compte
 * de classe 5 qui lui correspond. Renvoie le compte créé.
 */
@Component({
  selector: 'app-start-account-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Ajouter un compte bancaire ou une caisse"
        description="C’est l’endroit où se trouve l’argent de l’association. Vous enregistrerez ensuite ce qui y entre et ce qui en sort."
        submitLabel="Ajouter ce compte"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>De quoi s’agit-il ?</mat-label>
          <mat-select formControlName="type">
            <mat-option value="BANK">Un compte en banque</mat-option>
            <mat-option value="CASH">Une caisse (espèces)</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Nom du compte</mat-label>
          <input matInput formControlName="name" placeholder="Compte courant" autocomplete="off" required />
          @if (form.controls.name.hasError('required')) {
            <mat-error>Donnez un nom à ce compte, par exemple « Compte courant ».</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <app-date-field label="Date de départ" formControlName="openedOn" hint="Le jour où commence votre suivi dans l’application." required />
          <mat-form-field appearance="outline">
            <mat-label>Combien y a-t-il dessus ce jour-là ? (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="openingBalance" placeholder="0,00" autocomplete="off" />
            <mat-hint>Le solde de votre relevé de banque. Laissez 0 si le compte est vide.</mat-hint>
            @if (form.controls.openingBalance.touched && opening() === null) {
              <mat-error>Écrivez un montant avec des chiffres, par exemple 1250,00.</mat-error>
            }
          </mat-form-field>
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class StartAccountDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<StartAccountDialog, FinancialAccountInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly data = inject<StartAccountDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    type: ['BANK' as 'BANK' | 'CASH'],
    name: ['', [Validators.required]],
    openedOn: [this.data.defaultDate ?? new Date().toISOString().slice(0, 10), [Validators.required]],
    openingBalance: ['0'],
  });

  protected opening(): number | null {
    return parseAmountToCents(this.form.controls.openingBalance.value.replace(/^-/, ''));
  }

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.openingBalance);
    this.form.markAllAsTouched();
    if (this.form.invalid || cents === null) {
      this.error.set('Vérifiez le nom du compte, la date de départ et le montant (par exemple 1250,00).');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const accountId = await this.planAccountFor(raw.type, raw.name.trim());
      this.reference.close(
        await this.api.createFinancialAccount({
          name: raw.name.trim(),
          type: raw.type,
          reference: null,
          accountId,
          openedOn: raw.openedOn,
          openingBalance: centsToApi(cents),
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "Le compte n'a pas pu être ajouté. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }

  /** Premier compte de classe 5 libre (512… pour une banque, 530… pour une caisse), créé au besoin. */
  private async planAccountFor(type: 'BANK' | 'CASH', name: string): Promise<string> {
    const base = type === 'BANK' ? '512' : '530';
    const used = new Set(this.data.existing.map((a) => a.accountId));
    const plan = await this.api.listAccounts();
    const free = plan.find((account) => account.active && account.number.startsWith(base) && !used.has(account.id));
    if (free) return free.id;
    const taken = new Set(plan.map((account) => account.number));
    if (!taken.has(base)) return (await this.api.createAccount({ number: base, label: type === 'BANK' ? 'Banque' : 'Caisse' })).id;
    for (let suffix = 1; suffix < 100; suffix++) {
      const number = `${base}${suffix}`;
      if (!taken.has(number)) return (await this.api.createAccount({ number, label: `${type === 'BANK' ? 'Banque' : 'Caisse'} — ${name}` })).id;
    }
    throw new Error('Plus de numéro de compte disponible.');
  }
}
