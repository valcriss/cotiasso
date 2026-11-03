import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type CampaignInfo, type MemberCategoryInfo, type MemberInfo, type MembershipInfo, type MembershipModeInfo, type TariffInfo } from '../admin/admin-api.service';
import { centsToApi, parseAmountToCents } from '../accounting/amount';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

const INVALID = 'Vérifiez les champs signalés en rouge, puis validez de nouveau.';

export const MODE_LABELS: Record<MembershipModeInfo, string> = {
  PAYMENT: "À l'encaissement : l'adhésion devient effective quand les règlements couvrent la cotisation",
  VALIDATION: 'À la validation par le bureau : une personne autorisée valide chaque adhésion',
  START_DATE: 'À la date de début : l\'adhésion est effective dès son enregistrement',
};

export interface CampaignDialogData {
  /** Saison à modifier, ou `null` pour en créer une. */
  campaign: CampaignInfo | null;
}

/** Création et modification d'une saison d'adhésion. Renvoie la saison enregistrée. */
@Component({
  selector: 'app-campaign-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="campaign ? 'Modifier la saison' : 'Nouvelle saison'"
        description="Une saison est la période pendant laquelle les adhésions sont valables (par exemple du 29 septembre au 28 septembre de l'année suivante). Vous choisissez vous-même les dates de début et de fin."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Nom</mat-label>
          <input matInput formControlName="name" placeholder="Adhésions 2025-2026" required />
          @if (form.controls.name.hasError('required') || form.controls.name.hasError('minlength')) {
            <mat-error>Donnez un nom d'au moins 3 caractères à la saison.</mat-error>
          }
        </mat-form-field>
        @if (campaign?.locked) {
          <p class="muted">Des adhésions existent déjà : seules le nom peut changer, les dates et le mode sont figés.</p>
        } @else {
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
          <p class="muted">Par défaut, un membre est à jour dès que sa cotisation est payée : c'est le bon choix dans la plupart des cas.</p>
          <details [open]="form.controls.effectiveMode.value !== 'PAYMENT'">
            <summary>Options avancées : quand une adhésion devient-elle effective ?</summary>
            <mat-form-field appearance="outline">
              <mat-label>Quand une adhésion devient-elle effective ?</mat-label>
              <mat-select formControlName="effectiveMode">
                @for (mode of modes; track mode) {
                  <mat-option [value]="mode">{{ label(mode) }}</mat-option>
                }
              </mat-select>
              <mat-hint>Ce choix est figé dès la première adhésion de la saison.</mat-hint>
            </mat-form-field>
          </details>
        }
      </app-form-dialog>
    </form>
  `,
})
export class CampaignDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CampaignDialog, CampaignInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly campaign = inject<CampaignDialogData>(MAT_DIALOG_DATA).campaign;
  protected readonly modes: MembershipModeInfo[] = ['PAYMENT', 'VALIDATION', 'START_DATE'];
  protected readonly label = (mode: MembershipModeInfo) => MODE_LABELS[mode];
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    name: [this.campaign?.name ?? '', [Validators.required, Validators.minLength(3)]],
    startsOn: [this.campaign?.startsOn ?? '', [Validators.required]],
    endsOn: [this.campaign?.endsOn ?? '', [Validators.required]],
    effectiveMode: [(this.campaign?.effectiveMode ?? 'PAYMENT') as MembershipModeInfo],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    const raw = this.form.getRawValue();
    this.error.set(null);
    this.busy.set(true);
    try {
      const current = this.campaign;
      this.reference.close(
        current
          ? await this.api.updateCampaign(current.id, current.locked ? { name: raw.name.trim() } : { name: raw.name.trim(), startsOn: raw.startsOn, endsOn: raw.endsOn, effectiveMode: raw.effectiveMode })
          : await this.api.createCampaign({ name: raw.name.trim(), startsOn: raw.startsOn, endsOn: raw.endsOn, effectiveMode: raw.effectiveMode }),
      );
    } catch (failure) {
      this.error.set(describeHttpError(failure, "La saison n'a pas pu être enregistrée. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface TariffDialogData {
  campaignId: string;
  tariff: TariffInfo | null;
  categories: MemberCategoryInfo[];
}

/** Ajout et modification d'un tarif de saison. Renvoie la saison mise à jour. */
@Component({
  selector: 'app-tariff-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="tariff ? 'Modifier le tarif' : 'Nouveau tarif'"
        description="Un tarif est un prix de cotisation (plein tarif, tarif réduit…). Le modifier ne change pas les adhésions déjà enregistrées : elles gardent leur montant."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Libellé</mat-label>
          <input matInput formControlName="label" placeholder="Plein tarif" required />
          @if (form.controls.label.hasError('required')) {
            <mat-error>Donnez un nom au tarif, par exemple « Plein tarif ».</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Montant (€)</mat-label>
          <input matInput inputmode="decimal" formControlName="amount" placeholder="30,00" required />
          <mat-hint>0 pour une adhésion gratuite.</mat-hint>
        </mat-form-field>
        @if (!tariff) {
          <mat-form-field appearance="outline">
            <mat-label>Catégorie (facultatif)</mat-label>
            <mat-select formControlName="categoryId">
              <mat-option value="">Toutes</mat-option>
              @for (category of data.categories; track category.id) {
                <mat-option [value]="category.id">{{ category.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
      </app-form-dialog>
    </form>
  `,
})
export class TariffDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<TariffDialog, CampaignInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<TariffDialogData>(MAT_DIALOG_DATA);
  protected readonly tariff = this.data.tariff;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    label: [this.tariff?.label ?? '', [Validators.required]],
    amount: [this.tariff ? this.tariff.amount.replace('.', ',') : ''],
    categoryId: [''],
  });

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    const cents = parseAmountToCents(raw.amount);
    if (this.form.invalid || cents === null || cents < 0) {
      this.form.markAllAsTouched();
      this.error.set('Donnez un nom au tarif et un montant valide, par exemple 30,00 (0 pour une adhésion gratuite).');
      return;
    }
    const amount = centsToApi(cents);
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(
        this.tariff
          ? await this.api.updateTariff(this.tariff.id, { label: raw.label.trim(), amount })
          : await this.api.addTariff(this.data.campaignId, { label: raw.label.trim(), amount, categoryId: raw.categoryId || null }),
      );
    } catch (failure) {
      this.error.set(describeHttpError(failure, "Le tarif n'a pas pu être enregistré. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface MembershipDialogData {
  campaign: CampaignInfo;
  /** Membres actuels pouvant adhérer. */
  members: MemberInfo[];
}

/** Inscription d'un membre à une saison. Renvoie l'adhésion créée. */
@Component({
  selector: 'app-membership-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Nouvelle adhésion"
        description="Inscrivez un membre à la saison avec son tarif. La cotisation attendue est notée, mais rien n'est comptabilisé tant qu'un règlement n'est pas enregistré."
        submitLabel="Enregistrer l'adhésion"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Membre</mat-label>
          <mat-select formControlName="memberId" required>
            @for (member of data.members; track member.id) {
              <mat-option [value]="member.id">{{ member.lastName }} {{ member.firstName }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Tarif</mat-label>
          <mat-select formControlName="tariffId" required>
            @for (tariff of data.campaign.tariffs; track tariff.id) {
              <mat-option [value]="tariff.id">{{ tariff.label }} — {{ tariff.amount }} €</mat-option>
            }
          </mat-select>
          @if (data.campaign.tariffs.length === 0) {
            <mat-hint>Ajoutez d'abord un tarif à la saison.</mat-hint>
          }
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Montant différent du tarif (facultatif)</mat-label>
            <input matInput inputmode="decimal" formControlName="expectedAmount" placeholder="0 pour une exonération" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Raison</mat-label>
            <input matInput formControlName="exemptionReason" placeholder="Bénévole, remise accordée…" />
            <mat-hint>Obligatoire si le montant diffère du tarif.</mat-hint>
          </mat-form-field>
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class MembershipDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<MembershipDialog, MembershipInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<MembershipDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    memberId: ['', [Validators.required]],
    tariffId: [this.data.campaign.tariffs[0]?.id ?? '', [Validators.required]],
    expectedAmount: [''],
    exemptionReason: [''],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    const raw = this.form.getRawValue();
    let expectedAmount: string | undefined;
    if (raw.expectedAmount.trim() !== '') {
      const cents = parseAmountToCents(raw.expectedAmount);
      if (cents === null || cents < 0) {
        this.error.set('Le montant différent doit être valide, par exemple 10,00 (0 pour une exonération).');
        return;
      }
      expectedAmount = centsToApi(cents);
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(
        await this.api.createMembership(this.data.campaign.id, {
          memberId: raw.memberId,
          tariffId: raw.tariffId,
          ...(expectedAmount !== undefined && { expectedAmount }),
          ...(raw.exemptionReason.trim() && { exemptionReason: raw.exemptionReason.trim() }),
        }),
      );
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'adhésion n'a pas pu être enregistrée. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface CancelMembershipDialogData {
  membership: MembershipInfo;
}

/** Annulation motivée d'une adhésion. Renvoie l'adhésion annulée. */
@Component({
  selector: 'app-cancel-membership-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="'Annuler l\\'adhésion de ' + data.membership.memberName + ' ?'"
        description="L'adhésion est conservée dans l'historique avec votre motif, mais elle ne compte plus. Le membre pourra adhérer de nouveau à cette saison."
        submitLabel="Annuler l'adhésion"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Motif</mat-label>
          <input matInput formControlName="reason" placeholder="Démission, erreur de saisie…" required />
          @if (form.controls.reason.hasError('required') || form.controls.reason.hasError('minlength')) {
            <mat-error>Indiquez le motif en quelques mots (3 caractères au moins).</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class CancelMembershipDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CancelMembershipDialog, MembershipInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<CancelMembershipDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({ reason: ['', [Validators.required, Validators.minLength(3)]] });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.cancelMembership(this.data.membership.id, this.form.getRawValue().reason.trim()));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'annulation n'a pas pu être faite. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
