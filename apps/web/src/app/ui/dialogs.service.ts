import { ComponentType } from '@angular/cdk/portal';
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, type ConfirmOptions } from './confirm-dialog';

/** Largeurs normalisées des boîtes de dialogue (design.md §4) ; plein écran sous 600 px, géré par le style global. */
export type DialogSize = 'sm' | 'md' | 'lg';

export interface OpenDialogOptions<D> {
  size?: DialogSize;
  data?: D;
  /** Boîte d'information sans saisie à perdre : Échap et le clic à côté la ferment. Par défaut (formulaire), ils demandent d'abord confirmation (voir FormDialog). */
  dismissible?: boolean;
}

/**
 * Ouverture des boîtes de dialogue de l'application. Une boîte de formulaire se ferme **seulement** par ses propres
 * boutons (ou après confirmation d'abandon, voir `FormDialog`) : Échap et le clic à côté ne perdent jamais une saisie.
 */
@Injectable({ providedIn: 'root' })
export class Dialogs {
  private readonly dialog = inject(MatDialog);

  /** Ouvre une boîte de formulaire ; renvoie ce que la boîte transmet en se fermant, ou `undefined` si elle est abandonnée. */
  async open<R = unknown, D = unknown>(component: ComponentType<unknown>, options: OpenDialogOptions<D> = {}): Promise<R | undefined> {
    const reference = this.dialog.open<unknown, D, R>(component, {
      data: options.data as D,
      panelClass: ['app-dialog', `app-dialog-${options.size ?? 'md'}`],
      maxWidth: 'none',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      // Fermeture gérée par `FormDialog` : un formulaire modifié demande d'abord confirmation.
      disableClose: !options.dismissible,
    });
    return firstValueFrom(reference.afterClosed());
  }

  /** Demande une confirmation explicite ; `true` si l'utilisateur confirme. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const reference = this.dialog.open<ConfirmDialog, ConfirmOptions, boolean>(ConfirmDialog, {
      data: options,
      panelClass: ['app-dialog', 'app-dialog-sm'],
      maxWidth: 'none',
      restoreFocus: true,
    });
    return (await firstValueFrom(reference.afterClosed())) === true;
  }
}
