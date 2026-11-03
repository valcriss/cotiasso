import { Component, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type OpeningSituationInfo, type OpeningSituationResultInfo, type ThirdPartyInfo } from '../admin/admin-api.service';
import { formatEuroCents, centsToApi, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

export interface OpeningSituationDialogData {
  situation: OpeningSituationInfo;
  /** Tiers existants proposés pour « Qui ? » ; vide si la personne ne peut pas les consulter. */
  thirdParties?: ThirdPartyInfo[];
}

/**
 * Situation de départ (ADR 0029) : la photo de l'association le jour où l'on commence. L'argent des comptes est repris tel
 * quel ; on ajoute ce qu'on nous doit et ce que l'association doit ; le logiciel calcule ce qui reste (le fonds de
 * l'association), que la personne confirme et explique. Rien n'est caché : aucun compte d'équilibrage automatique.
 */
@Component({
  selector: 'app-opening-situation-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styles: `
    .block {
      margin: 0 0 20px;
    }
    .block h4 {
      font: var(--mat-sys-title-small);
      margin: 0 0 4px;
    }
    .block p {
      margin: 0 0 8px;
    }
    .line {
      align-items: baseline;
      display: grid;
      gap: 12px;
      grid-template-columns: 1fr auto;
    }
    .item {
      display: grid;
      gap: 8px 12px;
      grid-template-columns: minmax(180px, 2fr) minmax(200px, 3fr) minmax(110px, 1fr) auto;
    }
    .who {
      display: flex;
      flex-direction: column;
    }
    .num {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .total {
      border-top: 1px solid var(--app-border);
      font-weight: 500;
      padding-top: 8px;
    }
    .equity {
      background: var(--app-surface-muted);
      border-radius: var(--app-radius);
      padding: 12px 16px;
    }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Votre situation de départ"
        [description]="'Une photo de votre association au ' + dateLabel() + ' : l’argent que vous avez, ce qu’on vous doit et ce que vous devez. C’est le point de départ de vos comptes ; vous n’avez pas à reprendre l’historique avant cette date.'"
        [submitLabel]="nothingToCarry() ? 'Je pars de zéro, rien à enregistrer' : 'Enregistrer dans les comptes'"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        @if (data.situation.misaligned.length > 0) {
          <p class="alert" role="alert">
            Le solde de départ de {{ misalignedNames() }} n’est pas daté du {{ dateLabel() }}. Toute la situation doit porter la même date :
            changez la date de départ de ce compte dans la page Comptes (tant qu’il n’a aucun mouvement), puis revenez ici.
          </p>
        }

        <section class="block" aria-label="Argent en banque et en caisse">
          <h4>1. L’argent que vous avez</h4>
          <p class="muted">Repris de vos comptes bancaires et caisses. Pour corriger un montant, modifiez le compte dans la page Comptes.</p>
          @for (account of data.situation.accounts; track account.id) {
            <div class="line"><span>{{ account.name }}</span><span class="num">{{ format(account.openingBalance) }}</span></div>
          }
          <div class="line total"><span>Total de l’argent</span><span class="num">{{ formatEuroCents(cash()) }}</span></div>
        </section>

        <section class="block" aria-label="Sommes qu'on vous doit">
          <h4>2. Ce qu’on vous doit</h4>
          <p class="muted">Cotisations pas encore payées, subvention décidée mais pas encore versée… Laissez vide s’il n’y a rien.</p>
          <div formArrayName="receivables">
            @for (row of receivables.controls; track $index; let index = $index) {
              <div class="item" [formGroupName]="index">
                <mat-form-field appearance="outline">
                  <mat-label>De quoi s’agit-il ?</mat-label>
                  <mat-select formControlName="kind">
                    @for (kind of kinds('RECEIVABLE'); track kind.key) {
                      <mat-option [value]="kind.key">{{ kind.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <div class="who">
                  <mat-form-field appearance="outline">
                    <mat-label>Qui vous doit cela ?</mat-label>
                    <mat-select formControlName="thirdPartyId">
                      <mat-option value="">Quelqu’un de nouveau (j’écris son nom)</mat-option>
                      @for (party of parties; track party.id) {
                        <mat-option [value]="party.id">{{ party.name }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  @if (row.controls.thirdPartyId.value === '') {
                    <mat-form-field appearance="outline">
                      <mat-label>Nom</mat-label>
                      <input matInput formControlName="label" placeholder="Marie Dupont" autocomplete="off" />
                    </mat-form-field>
                  }
                </div>
                <mat-form-field appearance="outline">
                  <mat-label>Montant (€)</mat-label>
                  <input matInput inputmode="decimal" formControlName="amount" placeholder="0,00" autocomplete="off" />
                </mat-form-field>
                <button mat-icon-button type="button" aria-label="Retirer cette ligne" (click)="remove(receivables, index)">
                  <mat-icon fontSet="material-icons-outlined">delete</mat-icon>
                </button>
              </div>
            }
          </div>
          <button mat-stroked-button type="button" (click)="add(receivables, 'RECEIVABLE')" [disabled]="kinds('RECEIVABLE').length === 0">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une somme qu’on me doit
          </button>
          @if (kinds('RECEIVABLE').length === 0) {
            <p class="muted">Ces lignes ne sont pas disponibles : le plan de comptes n’a pas les comptes nécessaires (installez les catégories de départ).</p>
          }
        </section>

        <section class="block" aria-label="Sommes que vous devez">
          <h4>3. Ce que vous devez</h4>
          <p class="muted">Factures reçues mais pas encore payées, sommes à rembourser… Laissez vide s’il n’y a rien.</p>
          <div formArrayName="payables">
            @for (row of payables.controls; track $index; let index = $index) {
              <div class="item" [formGroupName]="index">
                <mat-form-field appearance="outline">
                  <mat-label>De quoi s’agit-il ?</mat-label>
                  <mat-select formControlName="kind">
                    @for (kind of kinds('PAYABLE'); track kind.key) {
                      <mat-option [value]="kind.key">{{ kind.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <div class="who">
                  <mat-form-field appearance="outline">
                    <mat-label>À qui devez-vous cela ?</mat-label>
                    <mat-select formControlName="thirdPartyId">
                      <mat-option value="">Quelqu’un de nouveau (j’écris son nom)</mat-option>
                      @for (party of parties; track party.id) {
                        <mat-option [value]="party.id">{{ party.name }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  @if (row.controls.thirdPartyId.value === '') {
                    <mat-form-field appearance="outline">
                      <mat-label>Nom</mat-label>
                      <input matInput formControlName="label" placeholder="Imprimerie Martin" autocomplete="off" />
                    </mat-form-field>
                  }
                </div>
                <mat-form-field appearance="outline">
                  <mat-label>Montant (€)</mat-label>
                  <input matInput inputmode="decimal" formControlName="amount" placeholder="0,00" autocomplete="off" />
                </mat-form-field>
                <button mat-icon-button type="button" aria-label="Retirer cette ligne" (click)="remove(payables, index)">
                  <mat-icon fontSet="material-icons-outlined">delete</mat-icon>
                </button>
              </div>
            }
          </div>
          <button mat-stroked-button type="button" (click)="add(payables, 'PAYABLE')" [disabled]="kinds('PAYABLE').length === 0">
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une somme que je dois
          </button>
        </section>

        @if (nothingToCarry()) {
          <p class="muted" role="status">
            Vous n’avez indiqué ni argent au départ, ni somme à recevoir, ni somme à payer : votre association part de zéro. C’est tout à fait
            normal pour une association qui démarre. Il n’y a rien à enregistrer ; vous pourrez saisir vos premières opérations ensuite.
          </p>
        }

        <section class="block equity" aria-label="Fonds de l'association">
          <h4>4. Ce qui reste : le fonds de l’association</h4>
          <p>
            Argent + ce qu’on vous doit − ce que vous devez =
            <strong class="num">{{ formatEuroCents(equityCents()) }}</strong>. C’est la valeur de l’association à cette date, ce qu’elle possède
            en propre (on parle de « fonds associatifs » ou de « report à nouveau »).
          </p>
          @if (equityCents() !== 0) {
            <mat-form-field appearance="outline">
              <mat-label>Où le ranger ?</mat-label>
              <mat-select formControlName="equityAccountId">
                @for (account of data.situation.equityAccounts; track account.id) {
                  <mat-option [value]="account.id">{{ account.number }} — {{ account.label }}</mat-option>
                }
              </mat-select>
              <mat-hint>« Fonds associatifs » convient dans la plupart des cas. Votre expert-comptable pourra préciser.</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>D’où vient ce fonds ?</mat-label>
              <input matInput formControlName="explanation" placeholder="Fonds apportés à la création de l’association" autocomplete="off" />
              <mat-hint>Quelques mots : l’expert-comptable les retrouvera dans l’écriture.</mat-hint>
              @if (form.controls.explanation.touched && form.controls.explanation.hasError('minlength')) {
                <mat-error>Écrivez au moins 5 caractères.</mat-error>
              }
            </mat-form-field>
          }
          @if (equityCents() < 0) {
            <p class="muted">Le fonds est négatif : l’association doit plus qu’elle ne possède. C’est possible, mais vérifiez vos montants.</p>
          }
        </section>

        <section class="block" aria-label="Ce que verra l'expert-comptable">
          <h4>Ce que verra l’expert-comptable</h4>
          <p class="muted">
            Une seule écriture dans le journal des à-nouveaux, au {{ dateLabel() }}. À gauche (débit) : l’argent et ce qu’on vous doit,
            {{ formatEuroCents(debit()) }}. À droite (crédit) : ce que vous devez et le fonds de l’association, {{ formatEuroCents(credit()) }}.
            Les deux totaux sont égaux.
          </p>
        </section>
      </app-form-dialog>
    </form>
  `,
})
export class OpeningSituationDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<OpeningSituationDialog, OpeningSituationResultInfo | { skipped: true }>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<OpeningSituationDialogData>(MAT_DIALOG_DATA);
  protected readonly formatEuroCents = formatEuroCents;
  protected readonly parties = (this.data.thirdParties ?? []).filter((p) => !p.archived);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    receivables: this.fb.array([] as ReturnType<OpeningSituationDialog['row']>[]),
    payables: this.fb.array([] as ReturnType<OpeningSituationDialog['row']>[]),
    equityAccountId: [this.data.situation.suggestedEquityAccountId ?? ''],
    explanation: ['', [Validators.minLength(5), Validators.maxLength(120)]],
  });
  protected get receivables(): FormArray<ReturnType<OpeningSituationDialog['row']>> {
    return this.form.controls.receivables;
  }
  protected get payables(): FormArray<ReturnType<OpeningSituationDialog['row']>> {
    return this.form.controls.payables;
  }

  /** Un compteur qui force le recalcul des totaux quand une ligne change (les formulaires réactifs ne sont pas des signaux). */
  private readonly tick = signal(0);

  protected readonly cash = computed(() =>
    this.data.situation.accounts.reduce((sum, account) => sum + this.signedCents(account.openingBalance), 0),
  );
  protected readonly receivableCents = computed(() => (this.tick(), this.sum(this.receivables)));
  protected readonly payableCents = computed(() => (this.tick(), this.sum(this.payables)));
  protected readonly equityCents = computed(() => this.cash() + this.receivableCents() - this.payableCents());
  /** Aucun solde de départ et aucune ligne saisie : l'association part de zéro, il n'y a rien à écrire. */
  protected readonly nothingToCarry = computed(
    () => (this.tick(), this.data.situation.accounts.every((a) => this.signedCents(a.openingBalance) === 0) && this.receivables.length === 0 && this.payables.length === 0),
  );
  protected readonly debit = computed(() => this.positiveCash() + this.receivableCents() + Math.max(0, -this.equityCents()));
  protected readonly credit = computed(() => this.negativeCash() + this.payableCents() + Math.max(0, this.equityCents()));
  protected readonly dateLabel = computed(() => (this.data.situation.date ?? '').split('-').reverse().join('/'));
  protected readonly misalignedNames = computed(() => this.data.situation.misaligned.map((a) => `« ${a.name} »`).join(', '));

  constructor() {
    this.form.valueChanges.subscribe(() => this.tick.update((n) => n + 1));
  }

  protected kinds(side: 'RECEIVABLE' | 'PAYABLE') {
    return this.data.situation.kinds.filter((k) => k.side === side && k.available);
  }

  protected format(value: string): string {
    return formatEuroCents(this.signedCents(value));
  }

  protected row(side: 'RECEIVABLE' | 'PAYABLE') {
    return this.fb.group({
      kind: [this.kinds(side)[0]?.key ?? '', [Validators.required]],
      thirdPartyId: [''],
      label: ['', [Validators.maxLength(120)]],
      amount: ['', [Validators.required]],
    });
  }

  protected add(array: FormArray<ReturnType<OpeningSituationDialog['row']>>, side: 'RECEIVABLE' | 'PAYABLE'): void {
    array.push(this.row(side));
    this.form.markAsDirty();
    this.tick.update((n) => n + 1);
  }

  protected remove(array: FormArray<ReturnType<OpeningSituationDialog['row']>>, index: number): void {
    array.removeAt(index);
    this.form.markAsDirty();
    this.tick.update((n) => n + 1);
  }

  private signedCents(value: string): number {
    const negative = value.startsWith('-');
    const cents = parseAmountToCents(negative ? value.slice(1) : value) ?? 0;
    return negative ? -cents : cents;
  }
  private positiveCash(): number {
    return this.data.situation.accounts.reduce((sum, a) => sum + Math.max(0, this.signedCents(a.openingBalance)), 0);
  }
  private negativeCash(): number {
    return this.data.situation.accounts.reduce((sum, a) => sum + Math.max(0, -this.signedCents(a.openingBalance)), 0);
  }
  private sum(array: FormArray<ReturnType<OpeningSituationDialog['row']>>): number {
    return array.controls.reduce((total, group) => total + (parseAmountToCents(group.controls.amount.value) ?? 0), 0);
  }

  protected async save(): Promise<void> {
    this.form.markAllAsTouched();
    this.details.set([]);
    if (this.nothingToCarry()) {
      this.busy.set(true);
      try {
        await this.api.skipOpeningSituation();
        this.reference.close({ skipped: true });
      } catch (failure) {
        const described = describeHttpError(failure, "Votre choix n'a pas pu être enregistré. Réessayez dans un instant.");
        this.error.set(described.message);
        this.details.set(described.details);
      } finally {
        this.busy.set(false);
      }
      return;
    }
    if (this.data.situation.misaligned.length > 0 || !this.data.situation.date) {
      this.error.set('Alignez d’abord la date de départ des comptes (voir le message en haut), puis réessayez.');
      return;
    }
    const lines = (array: FormArray<ReturnType<OpeningSituationDialog['row']>>) =>
      array.controls.map((group) => ({
        kind: group.controls.kind.value,
        thirdPartyId: group.controls.thirdPartyId.value,
        label: group.controls.label.value.trim(),
        amount: parseAmountToCents(group.controls.amount.value),
      }));
    const receivables = lines(this.receivables);
    const payables = lines(this.payables);
    const invalid = [...receivables, ...payables].some((l) => !l.kind || (!l.thirdPartyId && !l.label) || l.amount === null || l.amount <= 0);
    if (invalid) {
      this.error.set('Chaque ligne a besoin d’un type, d’une personne (choisie ou nommée) et d’un montant supérieur à zéro (par exemple 120,00). Retirez les lignes vides.');
      return;
    }
    const equity = this.equityCents();
    const { equityAccountId, explanation } = this.form.getRawValue();
    if (equity !== 0 && (!equityAccountId || explanation.trim().length < 5)) {
      this.error.set('Indiquez où ranger le fonds de l’association et d’où il vient (5 caractères au moins).');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.recordOpeningSituation({
          date: this.data.situation.date,
          receivables: receivables.map((l) => ({ kind: l.kind, ...(l.thirdPartyId ? { thirdPartyId: l.thirdPartyId } : { label: l.label }), amount: centsToApi(l.amount!) })),
          payables: payables.map((l) => ({ kind: l.kind, ...(l.thirdPartyId ? { thirdPartyId: l.thirdPartyId } : { label: l.label }), amount: centsToApi(l.amount!) })),
          equityAmount: centsToApi(equity),
          equityAccountId: equity !== 0 ? equityAccountId : null,
          explanation: equity !== 0 ? explanation.trim() : null,
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "La situation de départ n'a pas pu être enregistrée. Vos saisies sont conservées : réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
