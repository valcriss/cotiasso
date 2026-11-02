import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type FunderInfo, type MemberInfo, type ThirdPartyBody, type ThirdPartyInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';

type Choice = 'SUPPLIER' | 'OTHER' | 'MEMBER' | 'FUNDER';

/**
 * Ajout d'un tiers (ADR 0030) : la personne ou l'organisme concerné par une somme à recevoir ou à payer. Un adhérent ou
 * un financeur déjà enregistrés se choisissent dans leur liste (aucune ressaisie) ; un fournisseur ou une autre personne
 * se nomme. Renvoie le tiers créé (ou retrouvé s'il existait déjà pour cet adhérent ou ce financeur).
 */
@Component({
  selector: 'app-third-party-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Ajouter un tiers"
        description="Un tiers est la personne ou l’organisme concerné par une somme : un adhérent qui doit une cotisation, un financeur qui doit verser une subvention, un fournisseur à payer. Cela permet de savoir, plus tard, qui vous doit quoi."
        submitLabel="Ajouter"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
      >
        <mat-form-field appearance="outline">
          <mat-label>De qui s’agit-il ?</mat-label>
          <mat-select formControlName="choice">
            <mat-option value="SUPPLIER">Un fournisseur ou un prestataire</mat-option>
            <mat-option value="OTHER">Une autre personne ou un autre organisme</mat-option>
            @if (members().length > 0) {
              <mat-option value="MEMBER">Un adhérent</mat-option>
            }
            @if (funders().length > 0) {
              <mat-option value="FUNDER">Un financeur</mat-option>
            }
          </mat-select>
        </mat-form-field>

        @switch (form.controls.choice.value) {
          @case ('MEMBER') {
            <mat-form-field appearance="outline">
              <mat-label>Adhérent</mat-label>
              <mat-select formControlName="memberId">
                @for (member of members(); track member.id) {
                  <mat-option [value]="member.id">{{ member.firstName }} {{ member.lastName }}</mat-option>
                }
              </mat-select>
              @if (form.controls.memberId.touched && form.controls.memberId.hasError('required')) {
                <mat-error>Choisissez un adhérent.</mat-error>
              }
            </mat-form-field>
          }
          @case ('FUNDER') {
            <mat-form-field appearance="outline">
              <mat-label>Financeur</mat-label>
              <mat-select formControlName="funderId">
                @for (funder of funders(); track funder.id) {
                  <mat-option [value]="funder.id">{{ funder.name }}</mat-option>
                }
              </mat-select>
              @if (form.controls.funderId.touched && form.controls.funderId.hasError('required')) {
                <mat-error>Choisissez un financeur.</mat-error>
              }
            </mat-form-field>
          }
          @default {
            <mat-form-field appearance="outline">
              <mat-label>Nom</mat-label>
              <input matInput formControlName="name" placeholder="Imprimerie Martin" autocomplete="off" required />
              @if (form.controls.name.touched && form.controls.name.hasError('required')) {
                <mat-error>Écrivez le nom de la personne ou de l’organisme.</mat-error>
              }
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Note (facultatif)</mat-label>
              <input matInput formControlName="note" autocomplete="off" />
              <mat-hint>Par exemple : « Affiches de la fête ».</mat-hint>
            </mat-form-field>
          }
        }
      </app-form-dialog>
    </form>
  `,
})
export class ThirdPartyDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<ThirdPartyDialog, ThirdPartyInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly members = signal<MemberInfo[]>([]);
  protected readonly funders = signal<FunderInfo[]>([]);

  protected readonly form = this.fb.group({
    choice: ['SUPPLIER' as Choice],
    name: [''],
    note: [''],
    memberId: [''],
    funderId: [''],
  });

  constructor() {
    // Ces listes demandent des droits que tout le monde n'a pas : sans eux, on propose seulement fournisseur et autre.
    void this.api.listMembers().then((r) => this.members.set(r.members.filter((m) => !m.anonymized))).catch(() => undefined);
    void this.api.listFunders().then((f) => this.funders.set(f.filter((x) => !x.archived))).catch(() => undefined);
  }

  protected async save(): Promise<void> {
    const raw = this.form.getRawValue();
    this.form.markAllAsTouched();
    let body: ThirdPartyBody;
    if (raw.choice === 'MEMBER') {
      if (!raw.memberId) return this.fail('Choisissez l’adhérent concerné.');
      body = { kind: 'MEMBER', memberId: raw.memberId };
    } else if (raw.choice === 'FUNDER') {
      if (!raw.funderId) return this.fail('Choisissez le financeur concerné.');
      body = { kind: 'FUNDER', funderId: raw.funderId };
    } else {
      if (raw.name.trim() === '') return this.fail('Écrivez le nom de la personne ou de l’organisme.');
      body = { kind: raw.choice, name: raw.name.trim(), ...(raw.note.trim() !== '' && { note: raw.note.trim() }) };
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.createThirdParty(body));
    } catch (failure) {
      const described = describeHttpError(failure, "Le tiers n'a pas pu être ajouté. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.details.set([]);
  }
}
