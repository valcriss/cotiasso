import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { AdminApiService, type OverviewInfo } from '../admin/admin-api.service';

/**
 * Où en est le démarrage de l'association (ADR 0028) ? Sert au menu : « Démarrer » reste visible tant qu'une étape manque.
 * La valeur est posée par les pages qui chargent déjà la vue d'ensemble ; le menu ne la demande qu'une fois, et seulement à
 * qui peut réaliser les étapes (aucune requête superflue pour les autres).
 */
@Injectable({ providedIn: 'root' })
export class SetupStatus {
  private readonly injector = inject(Injector);
  private requested = false;

  readonly setup = signal<OverviewInfo['setup'] | null>(null);

  /** Vrai seulement quand on sait qu'il reste une étape (inconnu = faux : le menu ne clignote pas pendant le chargement). */
  readonly incomplete = computed(() => {
    const setup = this.setup();
    if (!setup) return false;
    return !(
      setup.fiscalYear &&
      setup.categories &&
      setup.financialAccount &&
      (setup.startMode !== 'OPENING' || setup.openingSituation === 'POSTED')
    );
  });

  set(setup: OverviewInfo['setup']): void {
    this.setup.set(setup);
  }

  /** Charge l'état une seule fois ; un échec laisse le menu sans l'entrée (elle reste joignable depuis la vue d'ensemble). */
  async ensureLoaded(): Promise<void> {
    if (this.requested || this.setup()) return;
    this.requested = true;
    try {
      const api = this.injector.get(AdminApiService);
      this.setup.set((await api.overview()).setup);
    } catch {
      this.requested = false;
    }
  }
}
