import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type BulkEnrollInfo, type CampaignInfo, type RenewalPreviewInfo } from '../admin/admin-api.service';
import { formatApiAmount, formatCents, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

/** Ajoute `years` années à une date `AAAA-MM-JJ` sans fuseau ; le 29 février devient le 28 février d'une année non bissextile. */
export function shiftYear(iso: string, years: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const year = Number(match[1]) + years;
  const month = Number(match[2]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = month === 2 && Number(match[3]) === 29 && !leap ? 28 : Number(match[3]);
  return `${String(year).padStart(4, '0')}-${match[2]}-${String(day).padStart(2, '0')}`;
}

/** « Adhésions 2025-2026 » → « Adhésions 2026-2027 » : chaque année du nom avance d'un an ; sans année, on ajoute une marque. */
export function nextCampaignName(name: string): string {
  return /\d{4}/.test(name) ? name.replace(/\d{4}/g, (year) => String(Number(year) + 1)) : `${name} (saison suivante)`;
}

export interface RenewCampaignDialogData {
  /** Campagne dont on reprend les réglages et les tarifs. */
  source: CampaignInfo;
}

/** « Préparer la campagne suivante » : mêmes réglages et tarifs, nouvelles dates. Renvoie la campagne créée. */
@Component({
  selector: 'app-renew-campaign-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Préparer la campagne suivante"
        [description]="'Une nouvelle campagne est créée avec les mêmes réglages et les ' + source.tariffs.length + ' tarif(s) de « ' + source.name + ' ». Aucun membre n’est inscrit à ce stade : vous le ferez à l’étape suivante. Nom et dates sont proposés, modifiez-les si besoin.'"
        submitLabel="Créer la campagne"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom</mat-label>
          <input matInput formControlName="name" required />
          @if (form.controls.name.hasError('required') || form.controls.name.hasError('minlength')) {
            <mat-error>Donnez un nom d’au moins 3 caractères à la campagne.</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Début</mat-label>
            <input matInput type="date" formControlName="startsOn" required />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Fin (incluse)</mat-label>
            <input matInput type="date" formControlName="endsOn" required />
          </mat-form-field>
        </div>
        <p class="muted">Les tarifs gardent leurs montants : vous pourrez les modifier ensuite, avant d’inscrire les membres.</p>
      </app-form-dialog>
    </form>
  `,
})
export class RenewCampaignDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<RenewCampaignDialog, CampaignInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly source = inject<RenewCampaignDialogData>(MAT_DIALOG_DATA).source;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    name: [nextCampaignName(this.source.name), [Validators.required, Validators.minLength(3)]],
    startsOn: [shiftYear(this.source.startsOn, 1), [Validators.required]],
    endsOn: [shiftYear(this.source.endsOn, 1), [Validators.required]],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis validez de nouveau.');
      return;
    }
    const raw = this.form.getRawValue();
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.renewCampaign(this.source.id, { name: raw.name.trim(), startsOn: raw.startsOn, endsOn: raw.endsOn }));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "La campagne n'a pas pu être créée. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface BulkEnrollDialogData {
  campaign: CampaignInfo;
}

interface Row {
  memberId: string;
  memberName: string;
  categoryName: string | null;
  previouslyEnrolled: boolean;
  previousTariffLabel: string | null;
}

/** « Inscrire les membres » en une fois : liste des membres actuels, tarif proposé, total attendu. Renvoie le compte rendu. */
@Component({
  selector: 'app-bulk-enroll-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatCheckboxModule, MatFormFieldModule, MatSelectModule],
  template: `
    <form (submit)="$event.preventDefault(); save()" novalidate>
      <app-form-dialog
        title="Inscrire les membres à cette campagne"
        [description]="'Choisissez les membres à inscrire à « ' + data.campaign.name + ' » et leur tarif. La cotisation attendue est notée pour chacun, mais rien n’est comptabilisé tant qu’un règlement n’est pas enregistré. Les membres déjà inscrits ne sont pas proposés.'"
        [submitLabel]="'Inscrire ' + chosen().length + ' membre(s)'"
        [dirty]="dirty()"
        [busy]="busy()"
        [error]="error()"
      >
        @if (loading()) {
          <p class="muted">Chargement…</p>
        } @else if (rows().length === 0) {
          <p class="muted" role="status">Tous les membres actuels sont déjà inscrits à cette campagne.</p>
        } @else {
          @if (preview()?.source; as source) {
            <p class="muted">Les membres déjà inscrits à « {{ source.name }} » sont cochés d’office, avec le même tarif lorsqu’il existe encore.</p>
          } @else {
            <p class="muted">Aucune campagne précédente : choisissez vous-même les membres et leur tarif.</p>
          }
          <p><button type="button" class="link" (click)="selectAll(true)">Tout cocher</button> · <button type="button" class="link" (click)="selectAll(false)">Tout décocher</button></p>
          <table class="table">
            <caption class="sr-only">Membres à inscrire</caption>
            <thead>
              <tr><th scope="col"><span class="sr-only">Inscrire</span></th><th scope="col">Membre</th><th scope="col">Tarif</th></tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.memberId) {
                <tr>
                  <td>
                    <mat-checkbox [checked]="checked().has(row.memberId)" [attr.aria-label]="'Inscrire ' + row.memberName" (change)="toggle(row.memberId, $event.checked)" />
                  </td>
                  <td>
                    {{ row.memberName }}
                    <div class="muted">
                      {{ row.categoryName ?? 'Sans catégorie' }}@if (row.previouslyEnrolled) { · inscrit la dernière fois{{ row.previousTariffLabel ? ' (' + row.previousTariffLabel + ')' : '' }} } @else { · pas inscrit la dernière fois }
                    </div>
                  </td>
                  <td>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Tarif de {{ row.memberName }}</mat-label>
                      <mat-select [value]="tariffs().get(row.memberId) ?? ''" (selectionChange)="setTariff(row.memberId, $event.value)">
                        <mat-option value="">À choisir</mat-option>
                        @for (tariff of preview()!.tariffs; track tariff.id) {
                          <mat-option [value]="tariff.id">{{ tariff.label }} — {{ amount(tariff.amount) }} €</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <p role="status" class="total">
            {{ chosen().length }} cotisation(s) seront créées, pour un total attendu de <strong>{{ total() }} €</strong>.
            @if (missing() > 0) { <span class="danger-text"> {{ missing() }} membre(s) coché(s) n’ont pas de tarif : choisissez-le ou décochez-les.</span> }
          </p>
        }
      </app-form-dialog>
    </form>
  `,
  styles: `
    .link {
      background: none;
      border: 0;
      color: var(--mat-sys-primary);
      cursor: pointer;
      padding: 0;
      text-decoration: underline;
    }
    .total {
      margin: 8px 0 0;
    }
  `,
})
export class BulkEnrollDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<BulkEnrollDialog, BulkEnrollInfo>>(MatDialogRef);
  protected readonly data = inject<BulkEnrollDialogData>(MAT_DIALOG_DATA);
  protected readonly amount = formatApiAmount;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly preview = signal<RenewalPreviewInfo | null>(null);
  protected readonly rows = computed<Row[]>(() => this.preview()?.items ?? []);
  protected readonly checked = signal<ReadonlySet<string>>(new Set());
  protected readonly tariffs = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly dirty = signal(false);

  /** Membres cochés qui ont un tarif : seuls ceux-là seront inscrits. */
  protected readonly chosen = computed(() => this.rows().filter((r) => this.checked().has(r.memberId) && this.tariffs().get(r.memberId)));
  protected readonly missing = computed(() => this.rows().filter((r) => this.checked().has(r.memberId) && !this.tariffs().get(r.memberId)).length);
  protected readonly total = computed(() => {
    const prices = new Map((this.preview()?.tariffs ?? []).map((t) => [t.id, parseAmountToCents(t.amount) ?? 0]));
    return formatCents(this.chosen().reduce((sum, r) => sum + (prices.get(this.tariffs().get(r.memberId)!) ?? 0), 0));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const preview = await this.api.renewalPreview(this.data.campaign.id);
      this.preview.set(preview);
      this.checked.set(new Set(preview.items.filter((i) => i.previouslyEnrolled && i.proposedTariffId).map((i) => i.memberId)));
      this.tariffs.set(new Map(preview.items.flatMap((i) => (i.proposedTariffId ? [[i.memberId, i.proposedTariffId] as const] : []))));
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de préparer la liste des membres. Réessayez dans un instant.').message);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(memberId: string, on: boolean): void {
    this.dirty.set(true);
    this.checked.update((current) => {
      const next = new Set(current);
      if (on) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
  }

  protected selectAll(on: boolean): void {
    this.dirty.set(true);
    this.checked.set(on ? new Set(this.rows().map((r) => r.memberId)) : new Set());
  }

  protected setTariff(memberId: string, tariffId: string): void {
    this.dirty.set(true);
    this.tariffs.update((current) => {
      const next = new Map(current);
      if (tariffId) next.set(memberId, tariffId);
      else next.delete(memberId);
      return next;
    });
    if (tariffId) this.checked.update((current) => new Set(current).add(memberId));
  }

  protected async save(): Promise<void> {
    if (this.missing() > 0) {
      this.error.set(`${this.missing()} membre(s) coché(s) n’ont pas de tarif : choisissez leur tarif ou décochez-les, puis validez de nouveau.`);
      return;
    }
    if (this.chosen().length === 0) {
      this.error.set('Cochez au moins un membre à inscrire.');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.enrollMany(this.data.campaign.id, this.chosen().map((r) => ({ memberId: r.memberId, tariffId: this.tariffs().get(r.memberId)! }))));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Les inscriptions n'ont pas pu être enregistrées. Rien n'a été créé : réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
