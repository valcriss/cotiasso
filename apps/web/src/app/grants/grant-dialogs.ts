import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { startWith } from 'rxjs';
import { AdminApiService, type FunderInfo, type GrantFinanceInfo, type GrantInfo, type GrantResidual, type ProjectInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { centsToApi, formatEuroAmount, formatCents, parseAmountToCents } from '../accounting/amount';
import { todayLocalIso } from '../ui/dates';
import { Dialogs } from '../ui/dialogs.service';
import { FormDialog } from '../ui/form-dialog';
import { allocationRows, allocationTotalCents, readAllocations, type AllocationRow } from './allocation-rows';
import { AllocationsFields } from './allocations-fields';
import { FunderDialog } from './funder-dialog';
import { RESIDUAL_LABELS } from './grant-labels';
import { DateField } from '../ui/date-field';

const today = todayLocalIso;
const amountValidator = (control: { value: string }) => {
  const cents = parseAmountToCents(control.value);
  return cents === null || cents <= 0 ? { amount: true } : null;
};
const toForm = (amount: string | null) => (amount === null ? '' : formatCents(parseAmountToCents(amount) ?? 0).replace(/\s/g, ''));

/** Charge les projets sur lesquels on peut répartir une subvention (les projets archivés n'en reçoivent plus). */
function useProjects(api: AdminApiService, keep: readonly string[] = []) {
  const projects = signal<ProjectInfo[]>([]);
  const unavailable = signal(false);
  void api
    .listProjects()
    .then((list) => projects.set(list.filter((p) => p.status !== 'ARCHIVED' || keep.includes(p.id))))
    .catch(() => unavailable.set(true));
  return { projects, unavailable };
}

export interface GrantDialogData {
  /** Subvention à modifier, ou `null` pour en demander une. */
  grant: GrantInfo | null;
}

/** Demander une subvention, ou modifier ce qui peut l'être selon son état. */
@Component({
  selector: 'app-grant-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, AllocationsFields, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="grant ? 'Modifier la subvention' : 'Demander une subvention'"
        [description]="description"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        @if (frozenNote) {
          <p class="muted">{{ frozenNote }}</p>
        }
        <mat-form-field appearance="outline">
          <mat-label>Financeur</mat-label>
          <mat-select formControlName="funderId" required>
            @for (funder of funders(); track funder.id) {
              <mat-option [value]="funder.id">{{ funder.name }}</mat-option>
            }
          </mat-select>
          @if (form.controls.funderId.hasError('required')) {
            <mat-error>Choisissez le financeur. S'il n'est pas dans la liste, ajoutez-le avec « Nouveau financeur ».</mat-error>
          }
        </mat-form-field>
        @if (!frozenNote) {
          <div>
            <button mat-button type="button" (click)="newFunder()">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Nouveau financeur
            </button>
          </div>
        }
        <mat-form-field appearance="outline">
          <mat-label>Objet de la subvention</mat-label>
          <input matInput formControlName="title" placeholder="Aide au fonctionnement 2026" required />
          @if (form.controls.title.hasError('required')) {
            <mat-error>Dites en quelques mots à quoi sert cette subvention.</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Référence du dossier (facultatif)</mat-label>
            <input matInput formControlName="reference" autocomplete="off" />
            <mat-hint>Le numéro donné par le financeur, s'il y en a un.</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Montant demandé (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="requestedAmount" placeholder="1000,00" autocomplete="off" required />
            @if (form.controls.requestedAmount.hasError('required') || form.controls.requestedAmount.hasError('amount')) {
              <mat-error>Saisissez un montant positif, par exemple 1000 ou 2500,50.</mat-error>
            }
          </mat-form-field>
        </div>
        <div class="row">
          <app-date-field label="Date de la demande (facultatif)" formControlName="requestedOn" />
          <app-date-field label="Période financée : du (facultatif)" formControlName="periodStart" />
          <app-date-field label="au (facultatif)" formControlName="periodEnd" />
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Conditions et obligations (facultatif)</mat-label>
          <textarea matInput rows="2" formControlName="conditions" placeholder="Bilan à rendre avant le 31 mars…"></textarea>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Note (facultatif)</mat-label>
          <textarea matInput rows="2" formControlName="note"></textarea>
        </mat-form-field>
        @if (!grant) {
          <h3>Projets financés (facultatif pour l'instant)</h3>
          <p class="muted">
            Vous pouvez dire dès maintenant quel projet cette subvention financera, avec une part chacun. Rien n'est exigé avant l'accord :
            vous pourrez le faire plus tard.
          </p>
          @if (projectsUnavailable()) {
            <p class="muted">La liste des projets n'est pas accessible avec vos droits.</p>
          }
          <app-allocations-fields [rows]="allocations" [projects]="projects()" />
        }
      </app-form-dialog>
    </form>
  `,
})
export class GrantDialog {
  private readonly api = inject(AdminApiService);
  private readonly dialogs = inject(Dialogs);
  private readonly reference = inject<MatDialogRef<GrantDialog, GrantInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly grant = inject<GrantDialogData>(MAT_DIALOG_DATA).grant;

  protected readonly funders = signal<FunderInfo[]>([]);
  private readonly loaded = useProjects(this.api);
  protected readonly projects = this.loaded.projects;
  protected readonly projectsUnavailable = this.loaded.unavailable;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly allocations: FormArray<AllocationRow> = allocationRows([]);

  /** Ce qui peut encore changer selon l'état : tout avant la décision, un peu après l'accord, la note seulement ensuite. */
  protected readonly frozenNote =
    this.grant?.status === 'GRANTED'
      ? "Cette subvention est accordée : le montant, les dates et le financeur ne changent plus (les avenants ne sont pas encore pris en charge). Vous pouvez compléter l'objet, la référence, les conditions et la note."
      : this.grant && ['REFUSED', 'CLOSED', 'CANCELLED'].includes(this.grant.status)
        ? 'Cette subvention est terminée : seule la note peut encore être complétée.'
        : '';
  protected readonly description = this.grant
    ? 'Modifiez les informations de cette subvention.'
    : "Une demande de subvention suit un dossier déposé auprès d'un financeur : demandée, instruite, puis accordée ou refusée. Ce suivi n'écrit rien dans la comptabilité.";

  protected readonly form = this.fb.group({
    funderId: [this.grant?.funder.id ?? '', [Validators.required]],
    title: [this.grant?.title ?? '', [Validators.required]],
    reference: [this.grant?.reference ?? ''],
    requestedAmount: [toForm(this.grant?.requestedAmount ?? null), [Validators.required, amountValidator]],
    requestedOn: [this.grant?.requestedOn ?? ''],
    periodStart: [this.grant?.periodStart ?? ''],
    periodEnd: [this.grant?.periodEnd ?? ''],
    conditions: [this.grant?.conditions ?? ''],
    note: [this.grant?.note ?? ''],
  });

  /** Ajoute le financeur sans quitter la demande : la boîte du financeur s'ouvre par-dessus, puis il est choisi d'office. */
  protected async newFunder(): Promise<void> {
    const created = await this.dialogs.open<FunderInfo>(FunderDialog, { size: 'md', data: { funder: null } });
    if (!created) return;
    this.funders.update((list) => [...list.filter((f) => f.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
    this.form.patchValue({ funderId: created.id });
    this.form.controls.funderId.markAsDirty();
  }

  constructor() {
    void this.api
      .listFunders()
      .then((list) => this.funders.set(list.filter((f) => !f.archived || f.id === this.grant?.funder.id)))
      .catch(() => undefined);
    const status = this.grant?.status;
    if (status === 'GRANTED') for (const key of ['funderId', 'requestedAmount', 'periodStart', 'periodEnd'] as const) this.form.controls[key].disable();
    if (status && ['REFUSED', 'CLOSED', 'CANCELLED'].includes(status)) {
      for (const key of Object.keys(this.form.controls) as (keyof typeof this.form.controls)[]) if (key !== 'note') this.form.controls[key].disable();
    }
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    if (this.allocations.invalid) {
      this.allocations.markAllAsTouched();
      this.error.set('Vérifiez la répartition entre les projets : chaque part a besoin d\'un projet et d\'un montant.');
      this.details.set([]);
      return;
    }
    const v = this.form.getRawValue();
    const enabled = (key: keyof typeof this.form.controls) => this.form.controls[key].enabled;
    const body = {
      ...(enabled('funderId') && { funderId: v.funderId }),
      title: v.title.trim(),
      reference: v.reference.trim() || null,
      ...(enabled('requestedAmount') && { requestedAmount: centsToApi(parseAmountToCents(v.requestedAmount) ?? 0) }),
      requestedOn: v.requestedOn || null,
      ...(enabled('periodStart') && { periodStart: v.periodStart || null }),
      ...(enabled('periodEnd') && { periodEnd: v.periodEnd || null }),
      conditions: v.conditions,
      note: v.note,
    };
    const onlyNote = this.grant && !enabled('title');
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const saved = this.grant
        ? await this.api.updateGrant(this.grant.id, onlyNote ? { note: v.note } : body)
        : await this.api.createGrant({
            ...body,
            funderId: v.funderId,
            requestedAmount: centsToApi(parseAmountToCents(v.requestedAmount) ?? 0),
            allocations: readAllocations(this.allocations),
          });
      this.reference.close(saved);
    } catch (failure) {
      const described = describeHttpError(failure, "La subvention n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Répartir une subvention entre des projets, tant qu'elle n'est pas décidée. */
@Component({
  selector: 'app-allocations-dialog',
  imports: [ReactiveFormsModule, FormDialog, AllocationsFields],
  template: `
    <form (submit)="$event.preventDefault(); save()" novalidate>
      <app-form-dialog
        title="Projets financés"
        [description]="
          'Indiquez quels projets « ' + grant.title + ' » finance, avec une part chacun. Tant que la subvention n\\'est pas accordée, la répartition reste libre ; à l\\'accord, la somme des parts devra égaler exactement le montant accordé.'
        "
        [dirty]="rows.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        @if (unavailable()) {
          <p class="muted">La liste des projets n'est pas accessible avec vos droits.</p>
        }
        <app-allocations-fields [rows]="rows" [projects]="projects()" [target]="{ label: 'Montant demandé', cents: requestedCents }" />
      </app-form-dialog>
    </form>
  `,
})
export class AllocationsDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<AllocationsDialog, GrantInfo>>(MatDialogRef);
  protected readonly grant = inject<{ grant: GrantInfo }>(MAT_DIALOG_DATA).grant;

  private readonly loaded = useProjects(this.api, this.grant.allocations.map((a) => a.projectId));
  protected readonly projects = this.loaded.projects;
  protected readonly unavailable = this.loaded.unavailable;
  protected readonly rows: FormArray<AllocationRow> = allocationRows(this.grant.allocations);
  protected readonly requestedCents = parseAmountToCents(this.grant.requestedAmount) ?? 0;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected async save(): Promise<void> {
    if (this.rows.invalid) {
      this.rows.markAllAsTouched();
      this.error.set("Vérifiez les parts signalées en rouge : chacune a besoin d'un projet et d'un montant.");
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.setGrantAllocations(this.grant.id, readAllocations(this.rows)));
    } catch (failure) {
      const described = describeHttpError(failure, "La répartition n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Enregistrer l'accord : montant accordé, date, et répartition qui doit le totaliser exactement. */
@Component({
  selector: 'app-grant-decision-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, AllocationsFields, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Enregistrer l'accord"
        description="Le financeur a dit oui. Indiquez le montant accordé et répartissez-le entre les projets : chaque euro accordé doit être affecté à un projet. Une fois l'accord enregistré, le montant, la date et la répartition ne changent plus."
        submitLabel="Enregistrer l'accord"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        [submitDisabled]="!balanced()"
      >
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Montant accordé (€)</mat-label>
            <input matInput inputmode="decimal" formControlName="grantedAmount" autocomplete="off" required />
            <mat-hint>Demandé : {{ requested }}.</mat-hint>
            @if (form.controls.grantedAmount.hasError('required') || form.controls.grantedAmount.hasError('amount')) {
              <mat-error>Saisissez un montant positif, par exemple 900 ou 1200,50.</mat-error>
            }
          </mat-form-field>
          <app-date-field label="Date de la décision" formControlName="decidedOn" errorText="Indiquez la date de la décision." required />
        </div>
        <h3>Répartition entre les projets</h3>
        @if (unavailable()) {
          <p class="muted">La liste des projets n'est pas accessible avec vos droits.</p>
        }
        <app-allocations-fields [rows]="rows" [projects]="projects()" [target]="target()" />
        @if (!balanced()) {
          <p class="muted">L'accord ne peut être enregistré que lorsque la répartition totalise exactement le montant accordé.</p>
        }
      </app-form-dialog>
    </form>
  `,
})
export class GrantDecisionDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<GrantDecisionDialog, GrantInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly grant = inject<{ grant: GrantInfo }>(MAT_DIALOG_DATA).grant;
  protected readonly requested = formatEuroAmount(this.grant.requestedAmount);

  private readonly loaded = useProjects(this.api, this.grant.allocations.map((a) => a.projectId));
  protected readonly projects = this.loaded.projects;
  protected readonly unavailable = this.loaded.unavailable;
  protected readonly rows: FormArray<AllocationRow> = allocationRows(this.grant.allocations);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);

  protected readonly form = this.fb.group({
    grantedAmount: [toForm(this.grant.requestedAmount), [Validators.required, amountValidator]],
    decidedOn: [today(), [Validators.required]],
  });

  private readonly changes = toSignal(this.form.valueChanges.pipe(startWith(null)));
  private readonly rowChanges = toSignal(this.rows.valueChanges.pipe(startWith(null)));

  protected readonly target = computed(() => {
    this.changes();
    const cents = parseAmountToCents(this.form.controls.grantedAmount.value);
    return cents !== null && cents > 0 ? { label: 'Montant accordé', cents } : null;
  });
  protected readonly balanced = computed(() => {
    this.rowChanges();
    const target = this.target();
    return target !== null && this.rows.length > 0 && allocationTotalCents(this.rows) === target.cents;
  });

  protected async save(): Promise<void> {
    if (this.form.invalid || this.rows.invalid) {
      this.form.markAllAsTouched();
      this.rows.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    const value = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.decideGrant(this.grant.id, {
          grantedAmount: centsToApi(parseAmountToCents(value.grantedAmount) ?? 0),
          decidedOn: value.decidedOn,
          allocations: readAllocations(this.rows),
        }),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "L'accord n'a pas pu être enregistré. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface GrantReasonDialogData {
  grant: GrantInfo;
  /** `refuse` : le financeur a dit non (date et motif) ; `cancel` : on abandonne la demande (motif). */
  mode: 'refuse' | 'cancel';
}

/** Refuser une demande (décision du financeur) ou l'annuler (demande abandonnée), toujours avec un motif. */
@Component({
  selector: 'app-grant-reason-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="data.mode === 'refuse' ? 'Enregistrer le refus' : 'Annuler la demande'"
        [description]="
          data.mode === 'refuse'
            ? 'Le financeur a refusé « ' + data.grant.title + ' ». Le dossier reste dans la liste avec son motif : rien n\\'est effacé.'
            : '« ' + data.grant.title + ' » ne sera plus suivie comme une demande en cours. Le dossier reste dans la liste avec son motif : rien n\\'est effacé.'
        "
        [submitLabel]="data.mode === 'refuse' ? 'Enregistrer le refus' : 'Annuler la demande'"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        @if (data.mode === 'refuse') {
          <app-date-field label="Date de la décision" formControlName="decidedOn" required />
        }
        <mat-form-field appearance="outline">
          <mat-label>Pourquoi ?</mat-label>
          <textarea matInput rows="2" formControlName="reason" [placeholder]="data.mode === 'refuse' ? 'Enveloppe épuisée, dossier hors critères…' : 'Projet abandonné, dossier déposé par erreur…'" required></textarea>
          @if (form.controls.reason.hasError('required')) {
            <mat-error>Indiquez le motif, pour garder la trace de ce qui s'est passé.</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class GrantReasonDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<GrantReasonDialog, GrantInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<GrantReasonDialogData>(MAT_DIALOG_DATA);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({ decidedOn: [today(), [Validators.required]], reason: ['', [Validators.required]] });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Indiquez le motif, puis validez.');
      this.details.set([]);
      return;
    }
    const value = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(
        this.data.mode === 'refuse'
          ? await this.api.refuseGrant(this.data.grant.id, { decidedOn: value.decidedOn, reason: value.reason.trim() })
          : await this.api.cancelGrant(this.data.grant.id, value.reason.trim()),
      );
    } catch (failure) {
      const described = describeHttpError(failure, "L'opération n'a pas pu être enregistrée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Clôturer une subvention accordée en choisissant le sort du reliquat. Aucune écriture comptable n'est créée. */
@Component({
  selector: 'app-grant-close-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Clôturer la subvention"
        description="La subvention est terminée. Dites ce qu'il advient de ce qui n'a pas été dépensé (le reliquat) : c'est une information de suivi, conservée avec la subvention. Aucune écriture n'est créée dans la comptabilité, et la subvention ne pourra plus être modifiée."
        submitLabel="Clôturer"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        @if (finance(); as figures) {
          <p class="muted" aria-live="polite">
            Reliquat calculé : {{ amount(figures.received) }} reçus − {{ amount(figures.spent) }} de dépenses affectées =
            <strong>{{ amount(figures.residual) }}</strong>. Si ce montant est positif, il reste de l'argent non dépensé ; s'il est négatif, les dépenses
            affectées dépassent ce qui a été reçu.
          </p>
        }
        <app-date-field label="Date de clôture" formControlName="closedOn" errorText="Indiquez la date de clôture." required />
        <mat-form-field appearance="outline">
          <mat-label>Sort du reliquat</mat-label>
          <mat-select formControlName="residual">
            @for (option of options; track option.value) {
              <mat-option [value]="option.value">{{ option.label }}</mat-option>
            }
          </mat-select>
          <mat-hint>« Reliquat » : la part de la subvention versée ou accordée qui n'a pas été dépensée.</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>{{ form.controls.residual.value === 'NONE' ? 'Note (facultatif)' : 'Précisions' }}</mat-label>
          <textarea matInput rows="2" formControlName="note" placeholder="150 € à rembourser avant le 30/06, accord du financeur du 12/05…"></textarea>
          @if (form.controls.note.hasError('required')) {
            <mat-error>Précisez en quelques mots ce qui est prévu pour le reliquat (montant, accord du financeur, échéance).</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class GrantCloseDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<GrantCloseDialog, GrantInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly grant = inject<{ grant: GrantInfo }>(MAT_DIALOG_DATA).grant;

  protected readonly options = (Object.keys(RESIDUAL_LABELS) as GrantResidual[]).map((value) => ({ value, label: RESIDUAL_LABELS[value] }));
  /** Reliquat calculé (reçu − dépenses affectées), à titre d'indication : le choix reste celui de l'utilisateur. */
  protected readonly finance = signal<GrantFinanceInfo | null>(null);
  protected readonly amount = formatEuroAmount;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    closedOn: [today(), [Validators.required]],
    residual: ['NONE' as GrantResidual],
    note: [''],
  });

  constructor() {
    void this.api
      .grantFinance(this.grant.id)
      .then((figures) => this.finance.set(figures))
      .catch(() => undefined);
    // Une précision est obligatoire dès qu'il y a un reliquat à rembourser ou à conserver.
    this.form.controls.residual.valueChanges.subscribe((residual) => {
      this.form.controls.note.setValidators(residual === 'NONE' ? [] : [Validators.required]);
      this.form.controls.note.updateValueAndValidity();
    });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis validez.');
      this.details.set([]);
      return;
    }
    const value = this.form.getRawValue();
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.closeGrant(this.grant.id, { closedOn: value.closedOn, residual: value.residual, note: value.note.trim() }));
    } catch (failure) {
      const described = describeHttpError(failure, "La subvention n'a pas pu être clôturée. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
