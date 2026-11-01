import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { describeHttpError } from '../auth/error-messages';
import { FormDialog } from '../ui/form-dialog';
import { AdminApiService, type AccountInfo } from './admin-api.service';

/** Ajout d'un compte au plan comptable, en boîte de dialogue. Renvoie le compte créé. */
@Component({
  selector: 'app-plan-account-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        title="Nouveau compte du plan comptable"
        description="Un compte regroupe les opérations de même nature (par exemple 706 « Prestations de services »). Le numéro ne pourra plus être changé ; un compte utilisé se désactive, il ne se supprime pas."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
        [details]="details()"
        submitLabel="Créer le compte"
      >
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Numéro</mat-label>
            <input matInput inputmode="numeric" formControlName="number" placeholder="706" autocomplete="off" required />
            <mat-hint>De 3 à 8 chiffres</mat-hint>
            @if (form.controls.number.hasError('required')) {
              <mat-error>Indiquez le numéro du compte, par exemple 706.</mat-error>
            } @else if (form.controls.number.hasError('pattern')) {
              <mat-error>Le numéro compte de 3 à 8 chiffres et commence par un chiffre de 1 à 8.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Libellé</mat-label>
            <input matInput formControlName="label" placeholder="Prestations de services" required />
            @if (form.controls.label.hasError('required')) {
              <mat-error>Donnez un nom au compte.</mat-error>
            }
          </mat-form-field>
        </div>
        <p class="muted">
          Le premier chiffre indique la famille : 1 fonds propres, 2 immobilisations, 4 tiers, 5 trésorerie, 6 charges (ce que
          vous dépensez), 7 produits (ce que vous recevez).
        </p>
      </app-form-dialog>
    </form>
  `,
})
export class PlanAccountDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<PlanAccountDialog, AccountInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly details = signal<string[]>([]);
  protected readonly form = this.fb.group({
    number: ['', [Validators.required, Validators.pattern(/^[1-8][0-9]{2,7}$/)]],
    label: ['', [Validators.required]],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Vérifiez les champs signalés en rouge, puis enregistrez de nouveau.');
      this.details.set([]);
      return;
    }
    this.error.set(null);
    this.details.set([]);
    this.busy.set(true);
    try {
      const value = this.form.getRawValue();
      this.reference.close(await this.api.createAccount({ number: value.number, label: value.label.trim() }));
    } catch (failure) {
      const described = describeHttpError(failure, "Le compte n'a pas pu être créé. Réessayez dans un instant.");
      this.error.set(described.message);
      this.details.set(described.details);
    } finally {
      this.busy.set(false);
    }
  }
}
