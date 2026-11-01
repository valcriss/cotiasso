import { Component, DestroyRef, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { filter } from 'rxjs';
import { Dialogs } from './dialogs.service';

let nextId = 0;

/**
 * Enveloppe d'un formulaire en boîte de dialogue (design.md §4) : titre, aide courte, champs, puis « Annuler » et le bouton
 * d'envoi. À placer dans le `<form>` de la boîte :
 *
 * <form [formGroup]="form" (ngSubmit)="save()" novalidate>
 *   <app-form-dialog title="Nouveau projet" [dirty]="form.dirty" [busy]="busy()" [error]="error()" [details]="details()">…champs…</app-form-dialog>
 * </form>
 *
 * - La boîte ne se ferme pas toute seule : c'est la page appelante qui la ferme (`MatDialogRef.close(résultat)`) quand l'envoi
 *   réussit. Une erreur du serveur s'affiche dans la boîte, la saisie est conservée.
 * - Échap, le clic à côté et « Annuler » demandent « Abandonner les modifications ? » si le formulaire a été modifié.
 */
@Component({
  selector: 'app-form-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  styles: `
    :host {
      display: contents;
    }
    .help {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 16px;
    }
    .fields {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .alert ul {
      margin: 4px 0 0;
      padding-left: 20px;
    }
  `,
  template: `
    <h2 mat-dialog-title [id]="titleId">{{ title() }}</h2>
    <mat-dialog-content>
      @if (description()) {
        <p class="help">{{ description() }}</p>
      }
      @if (error(); as message) {
        <div class="alert" role="alert">
          <p>{{ message }}</p>
          @if (details().length > 0) {
            <ul>
              @for (detail of details(); track detail) {
                <li>{{ detail }}</li>
              }
            </ul>
          }
        </div>
      }
      <div class="fields">
        <ng-content />
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="busy()" (click)="cancel()">Annuler</button>
      <button mat-flat-button type="submit" [disabled]="busy() || submitDisabled()">
        @if (busy()) {
          Enregistrement…
        } @else {
          {{ submitLabel() }}
        }
      </button>
    </mat-dialog-actions>
  `,
})
export class FormDialog {
  private readonly reference = inject(MatDialogRef, { optional: true });
  private readonly dialogs = inject(Dialogs);
  private readonly destroyed = inject(DestroyRef);

  readonly title = input.required<string>();
  /** Une phrase qui dit à quoi sert ce formulaire, ou ce qui se passera à l'envoi. */
  readonly description = input<string>('');
  readonly submitLabel = input<string>('Enregistrer');
  /** Vrai si le formulaire a été modifié : fermer sans enregistrer demande alors confirmation. */
  readonly dirty = input<boolean>(false);
  readonly busy = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly details = input<string[]>([]);
  /** Grise l'envoi tant que la saisie est incomplète (en plus de l'attente d'un envoi en cours). */
  readonly submitDisabled = input<boolean>(false);
  /** Émis quand l'utilisateur abandonne la boîte, après confirmation éventuelle. */
  readonly cancelled = output<void>();

  protected readonly titleId = `form-dialog-title-${++nextId}`;

  constructor() {
    const reference = this.reference;
    if (!reference) return;
    // Échap et clic à côté passent par le même chemin que « Annuler » (les boîtes de formulaire ont `disableClose`).
    reference
      .backdropClick()
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe(() => void this.cancel());
    reference
      .keydownEvents()
      .pipe(
        filter((event) => event.key === 'Escape'),
        takeUntilDestroyed(this.destroyed),
      )
      .subscribe((event) => {
        event.preventDefault();
        void this.cancel();
      });
  }

  protected async cancel(): Promise<void> {
    if (this.busy()) return;
    if (this.dirty()) {
      const discard = await this.dialogs.confirm({
        title: 'Abandonner les modifications ?',
        message: "Ce que vous avez saisi n'a pas été enregistré et sera perdu.",
        confirmLabel: 'Abandonner',
        cancelLabel: 'Continuer la saisie',
        danger: true,
      });
      if (!discard) return;
    }
    this.cancelled.emit();
    this.reference?.close(undefined);
  }
}
