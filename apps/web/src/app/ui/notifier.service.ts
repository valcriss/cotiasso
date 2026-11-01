import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/**
 * Retours à l'utilisateur (design.md §5) : un bandeau temporaire en bas de l'écran pour confirmer ce qui vient d'être fait.
 * Une erreur bloquante ne passe pas par ici : elle reste dans la boîte de dialogue ou la page concernée.
 */
@Injectable({ providedIn: 'root' })
export class Notifier {
  private readonly snackBar = inject(MatSnackBar);

  /** Confirme une action réussie, par une phrase précise (« Projet FESTIVAL créé. »). Disparaît après quelques secondes. */
  success(message: string): void {
    this.snackBar.open(message, 'Fermer', {
      duration: 5000,
      panelClass: 'app-snack',
      politeness: 'polite',
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  /** Information non bloquante qui mérite plus de temps de lecture (ex. une action partiellement réussie). */
  notice(message: string): void {
    this.snackBar.open(message, 'Fermer', {
      duration: 9000,
      panelClass: 'app-snack',
      politeness: 'polite',
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}
