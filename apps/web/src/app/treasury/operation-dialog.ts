import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FinancialAccountInfo, type FiscalYearInfo, type GuidedOperationResult, type OperationCategoryInfo, type ProjectInfo } from '../admin/admin-api.service';
import { centsToApi, formatCents, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { formatDate, todayLocalIso } from '../ui/dates';
import { ThemeService } from '../theme/theme.service';
import { FormDialog } from '../ui/form-dialog';
import { OperationLink, type LinkPick, type LinkTarget } from './operation-link';

/** Ce que la saisie renvoie : l'opération, et le sort du rattachement demandé (cotisation, subvention) s'il y en avait un. */
export type OperationDialogResult = GuidedOperationResult & { attachment?: { ok: true; summary: string } | { ok: false; message: string } };

export interface OperationDialogData {
  direction: 'IN' | 'OUT';
  /** Comptes actifs sur lesquels on peut enregistrer. */
  accounts: FinancialAccountInfo[];
  categories: OperationCategoryInfo[];
  projects: ProjectInfo[];
  /** Périodes de comptabilité connues, pour avertir dès le choix de la date ; vide si la personne ne peut pas les lire. */
  fiscalYears: FiscalYearInfo[];
  /** Compte proposé d'office (celui qui est ouvert), s'il y en a un. */
  accountId: string | null;
  /** L'utilisateur peut-il comptabiliser tout de suite ? Sinon l'opération reste un brouillon à relire. */
  canPost: boolean;
}

/**
 * « J'ai reçu de l'argent » / « J'ai dépensé de l'argent » (ADR 0028) : un seul formulaire en langage courant. Le logiciel
 * en tire la transaction et l'écriture à partie double ; l'aperçu montre ce que verra l'expert-comptable.
 */
@Component({
  selector: 'app-operation-dialog',
  imports: [ReactiveFormsModule, FormDialog, OperationLink, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="incoming ? 'J’ai reçu de l’argent' : 'J’ai dépensé de l’argent'"
        [description]="
          incoming
            ? 'Cotisation, don, subvention, vente… Indiquez sur quel compte l’argent est arrivé, combien et pourquoi : le logiciel s’occupe de la comptabilité.'
            : 'Achat, loyer, assurance… Indiquez de quel compte l’argent est sorti, combien et pourquoi : le logiciel s’occupe de la comptabilité.'
        "
        [submitLabel]="data.canPost ? 'Enregistrer l’opération' : 'Envoyer pour validation'"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>{{ incoming ? 'Sur quel compte l’argent est-il arrivé ?' : 'De quel compte l’argent est-il sorti ?' }}</mat-label>
            <mat-select formControlName="accountId" required>
              @for (account of data.accounts; track account.id) {
                <mat-option [value]="account.id">{{ account.name }}</mat-option>
              }
            </mat-select>
            @if (form.controls.accountId.hasError('required')) {
              <mat-error>Choisissez le compte concerné.</mat-error>
            }
          </mat-form-field>
        </div>
        @if (dateNotice(); as notice) {
          <p class="notice" [class.blocking]="notice.blocking" role="status">{{ notice.message }}</p>
        }
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Montant (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="amount" placeholder="25,00" autocomplete="off" required />
            <mat-hint>Toujours positif : le sens est déjà choisi.</mat-hint>
            @if (form.controls.amount.touched && amountCents() === null) {
              <mat-error>Écrivez un montant avec des chiffres, par exemple 25,00.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" formControlName="date" required />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>{{ incoming ? 'D’où vient cet argent ?' : 'À quoi a servi cet argent ?' }}</mat-label>
          <mat-select formControlName="categoryId" required>
            @for (category of choices; track category.id) {
              <mat-option [value]="category.id">{{ category.label }}</mat-option>
            }
          </mat-select>
          <mat-hint>{{ selectedCategory()?.hint || 'Choisissez la catégorie qui ressemble le plus à cette opération.' }}</mat-hint>
          @if (form.controls.categoryId.hasError('required')) {
            <mat-error>Choisissez une catégorie.</mat-error>
          }
        </mat-form-field>
        @if (incoming && selectedCategory()?.usage; as usage) {
          <app-operation-link [usage]="usage" (picked)="onLink($event)" />
        }
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <input matInput formControlName="label" [placeholder]="incoming ? 'Cotisation de Marie Dupont' : 'Facture de l’assureur'" autocomplete="off" required />
          <mat-hint>Ce qui vous permettra de retrouver l’opération plus tard.</mat-hint>
          @if (form.controls.label.hasError('required')) {
            <mat-error>Décrivez l’opération en quelques mots.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Pour quel projet ? (facultatif)</mat-label>
          <mat-select formControlName="projectId">
            <mat-option value="">Fonctionnement général (par défaut)</mat-option>
            @for (project of projects; track project.id) {
              <mat-option [value]="project.id">{{ project.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>Un projet regroupe les opérations d’une même action (festival, ateliers…) pour savoir ce qu’elle coûte.</mat-hint>
        </mat-form-field>

        @if (preview(); as lines) {
          <section class="preview" aria-label="Récapitulatif de l’opération">
            <p class="summary" role="status">{{ summary() }}</p>
            <details [open]="!simple()">
              <summary><strong>Ce que verra l’expert-comptable</strong></summary>
            <p class="muted">
              Chaque opération est notée deux fois dans les comptes, c’est ce qu’on appelle la « partie double » : une fois où l’argent est
              passé, une fois pour dire pourquoi. Vous n’avez rien à saisir de plus.
            </p>
            <table>
              <thead>
                <tr><th scope="col">Compte</th><th scope="col" class="amount">Débit</th><th scope="col" class="amount">Crédit</th></tr>
              </thead>
              <tbody>
                @for (line of lines; track line.account) {
                  <tr>
                    <td>{{ line.account }}</td>
                    <td class="amount">{{ line.debit }}</td>
                    <td class="amount">{{ line.credit }}</td>
                  </tr>
                }
              </tbody>
            </table>
            </details>
            <p class="muted">
              @if (data.canPost) {
                L’opération sera enregistrée définitivement. Si vous vous trompez, vous pourrez l’annuler : une opération inverse est alors
                ajoutée, l’historique reste lisible.
              } @else {
                Vous n’avez pas le droit d’enregistrer définitivement : l’opération sera envoyée pour validation, en brouillon. Une personne autorisée la relira puis l’enregistrera ; rien n’est compté dans les rapports avant.
              }
            </p>
          </section>
        }
      </app-form-dialog>
    </form>
  `,
  styles: `
    .preview {
      background: var(--app-surface-variant, var(--mat-sys-surface-container));
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 16px;
    }
    .notice {
      border-left: 4px solid var(--mat-sys-tertiary, var(--app-border));
      margin: 0;
      padding: 4px 12px;
    }
    .notice.blocking {
      border-left-color: var(--mat-sys-error);
    }
    .preview p {
      margin: 0;
    }
    .preview .summary {
      font-weight: 500;
    }
    .preview summary {
      cursor: pointer;
    }
    .preview table {
      border-collapse: collapse;
      width: 100%;
    }
    .preview th,
    .preview td {
      padding: 4px 6px;
      text-align: left;
    }
    .preview .amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `,
})
export class OperationDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<OperationDialog, OperationDialogResult>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<OperationDialogData>(MAT_DIALOG_DATA);

  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  protected readonly incoming = this.data.direction === 'IN';
  protected readonly choices = this.data.categories.filter((c) => c.direction === this.data.direction && c.active);
  protected readonly projects = this.data.projects.filter((p) => p.status !== 'ARCHIVED' && !p.permanent);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    accountId: [this.data.accountId ?? (this.data.accounts.length === 1 ? this.data.accounts[0]!.id : ''), [Validators.required]],
    amount: [''],
    date: [todayLocalIso()],
    categoryId: ['', [Validators.required]],
    label: ['', [Validators.required]],
    projectId: [''],
  });
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly amountCents = computed(() => parseAmountToCents(this.values().amount));
  protected readonly selectedCategory = computed(() => this.choices.find((c) => c.id === this.values().categoryId));

  /** Aperçu des deux lignes d'écriture, dès que le compte, la catégorie et un montant valide sont choisis. */
  protected readonly preview = computed(() => {
    const account = this.data.accounts.find((a) => a.id === this.values().accountId);
    const category = this.selectedCategory();
    const cents = this.amountCents();
    if (!account || !category || cents === null || cents <= 0) return null;
    const amount = formatCents(cents);
    const bank = { account: `${account.accountNumber} · ${account.name}`, debit: this.incoming ? amount : '', credit: this.incoming ? '' : amount };
    const other = { account: `${category.account.number} · ${category.account.label}`, debit: this.incoming ? '' : amount, credit: this.incoming ? amount : '' };
    return [bank, other];
  });

  /**
   * Avertit dès le choix de la date (trois temps : ce qui se passe, pourquoi, que faire) au lieu d'attendre le refus du serveur.
   * Un refus certain (période fermée ou clôturée, ou date hors de toute période) bloque l'envoi ; une date très lointaine prévient seulement.
   */
  protected readonly dateNotice = computed<{ message: string; blocking: boolean } | null>(() => {
    const date = this.values().date;
    const years = this.data.fiscalYears;
    if (!date || years.length === 0) return null;
    const year = years.find((y) => y.start <= date && date <= y.end);
    if (!year) {
      const first = [...years].sort((a, b) => a.start.localeCompare(b.start))[0]!;
      const last = [...years].sort((a, b) => b.end.localeCompare(a.end))[0]!;
      return {
        blocking: true,
        message: `Le ${formatDate(date)} n’est dans aucune période de comptabilité : vos périodes vont du ${formatDate(first.start)} au ${formatDate(last.end)}. Une opération doit tomber dans une période. Choisissez une autre date, ou ajoutez la période manquante dans l’assistant « Démarrer ».`,
      };
    }
    if (year.status !== 'OPEN') {
      return {
        blocking: true,
        message: `La période du ${formatDate(year.start)} au ${formatDate(year.end)} n’accepte plus de nouvelles opérations (${year.status === 'CLOSED' ? 'elle est clôturée' : 'la saisie est fermée'}). Cela protège des comptes déjà arrêtés. Choisissez une date dans la période en cours.`,
      };
    }
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() + 1);
    if (date > todayLocalIso(limit)) {
      return { blocking: false, message: `Le ${formatDate(date)} est dans plus d’un an : vérifiez l’année de la date.` };
    }
    return null;
  });

  /** Une phrase courante : où va l'argent et dans quelle catégorie il est rangé, sans numéro de compte ni débit/crédit. */
  protected readonly summary = computed(() => {
    const account = this.data.accounts.find((a) => a.id === this.values().accountId);
    const category = this.selectedCategory();
    const cents = this.amountCents();
    if (!account || !category || cents === null || cents <= 0) return '';
    const amount = formatCents(cents);
    return this.incoming
      ? `${amount} € arriveront sur « ${account.name} » et seront classés dans « ${category.label} ».`
      : `${amount} € sortiront de « ${account.name} » et seront classés dans « ${category.label} ».`;
  });

  /** Rattachement choisi (cotisation ou subvention) ; `null` quand la personne n'en veut pas. */
  private readonly link = signal<LinkTarget | null>(null);
  /** Dernières valeurs proposées par le rattachement : on ne remplace que ce que la personne n'a pas écrit elle-même. */
  private autoLabel = '';
  private autoAmount = '';

  protected onLink(pick: LinkPick): void {
    this.link.set(pick.target);
    const current = this.form.getRawValue();
    if (pick.label && (current.label.trim() === '' || current.label === this.autoLabel)) {
      this.autoLabel = pick.label;
      this.form.patchValue({ label: pick.label });
    }
    if (pick.amountCents && (current.amount.trim() === '' || current.amount === this.autoAmount)) {
      this.autoAmount = formatCents(pick.amountCents);
      this.form.patchValue({ amount: this.autoAmount });
    }
  }

  private async attach(target: LinkTarget, transactionId: string, amount: string): Promise<OperationDialogResult['attachment']> {
    try {
      if (target.kind === 'MEMBERSHIP') {
        await this.api.allocatePayment(target.membershipId, { transactionId, amount, kind: 'PAYMENT' });
        return { ok: true, summary: `Cotisation de ${target.memberName} (${target.campaignName}) rattachée.` };
      }
      await this.api.recordGrantPayment(target.grantId, { transactionId, amount, scheduleId: target.scheduleId });
      return { ok: true, summary: `Versement noté dans le suivi de la subvention « ${target.title} » (${target.funderName}).` };
    } catch (failure) {
      return { ok: false, message: describeHttpError(failure, 'Le rattachement n’a pas pu se faire.').message };
    }
  }

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    this.form.markAllAsTouched();
    if (this.form.invalid || cents === null || cents <= 0 || !raw.date) {
      this.error.set('Vérifiez les champs signalés : le compte, un montant supérieur à zéro (par exemple 25,00), la date, la catégorie et une description sont nécessaires.');
      this.details.set([]);
      return;
    }
    const notice = this.dateNotice();
    if (notice?.blocking) {
      this.error.set(notice.message);
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const result = await this.api.recordOperation({
        financialAccountId: raw.accountId,
        direction: this.data.direction,
        amount: centsToApi(cents),
        date: raw.date,
        label: raw.label.trim(),
        categoryId: raw.categoryId,
        ...(raw.projectId && { projectId: raw.projectId }),
        post: this.data.canPost,
      });
      // L'argent est enregistré : un refus du rattachement ne le défait pas (deux mécanismes distincts, ADR 0023/0024/0028).
      const target = this.link();
      const attachment = target ? await this.attach(target, result.transactionId, centsToApi(cents)) : undefined;
      this.reference.close({ ...result, ...(attachment && { attachment }) });
    } catch (failure) {
      const described = describeHttpError(failure, "L'opération n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
