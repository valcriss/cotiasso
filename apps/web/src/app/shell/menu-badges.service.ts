import { Injectable, Injector, inject, signal } from '@angular/core';
import { AdminApiService } from '../admin/admin-api.service';

export type BadgeKey = 'reimbursements' | 'accounts' | 'members';

/** Au plus une demande au serveur toutes les 15 secondes, sauf après un changement fait par la personne (`force`). */
const MAX_AGE_MS = 15_000;

/**
 * Pastilles du menu : combien d'éléments attendent une action de la personne, par rubrique. Le serveur applique les droits
 * et les mêmes critères que la liste « À faire » de la vue d'ensemble. Inconnu ou en échec = aucune pastille : le menu
 * n'affiche jamais d'erreur ni de chiffre douteux.
 */
@Injectable({ providedIn: 'root' })
export class MenuBadges {
  private readonly injector = inject(Injector);
  private loadedAt = 0;
  private loading = false;
  private again = false;

  readonly counts = signal<Record<BadgeKey, number> | null>(null);

  /** Recharge les décomptes ; une demande déjà en cours est suivie d'une seconde si l'on force (un changement vient d'avoir lieu). */
  async refresh(force = false): Promise<void> {
    if (this.loading) {
      this.again ||= force;
      return;
    }
    if (!force && Date.now() - this.loadedAt < MAX_AGE_MS) return;
    this.loading = true;
    try {
      this.counts.set(await this.injector.get(AdminApiService).menuBadges());
      this.loadedAt = Date.now();
    } catch {
      this.counts.set(null);
    } finally {
      this.loading = false;
      if (this.again) {
        this.again = false;
        void this.refresh(true);
      }
    }
  }

  /** Oublie les décomptes (déconnexion) : le suivant ne doit jamais montrer ceux de la personne précédente. */
  clear(): void {
    this.counts.set(null);
    this.loadedAt = 0;
  }
}
