import { Injectable, Injector, inject, signal } from '@angular/core';
import { ReimbursementsApi } from './reimbursements-api';

/** Au plus une demande au serveur par minute pour le menu, sauf rechargement explicite (après un changement de circuit). */
const MAX_AGE_MS = 60_000;

/**
 * Les remboursements sont-ils utilisables ? Sert au menu : la rubrique n'apparaît que quand un circuit de validation est en vigueur
 * **et** que chaque étape a quelqu'un pour décider (sinon une demande resterait bloquée). Inconnu = masqué : le menu ne clignote pas
 * pendant le chargement. L'adresse reste ouverte, et le serveur reste l'autorité.
 */
@Injectable({ providedIn: 'root' })
export class ReimbursementAvailability {
  private readonly injector = inject(Injector);
  private loadedAt = 0;
  private loading = false;

  /** `null` tant qu'on ne sait pas. */
  readonly ready = signal<boolean | null>(null);

  /** Recharge l'état si le dernier a plus d'une minute, ou toujours avec `force`. Un échec laisse la rubrique masquée. */
  async refresh(force = false): Promise<void> {
    if (this.loading || (!force && Date.now() - this.loadedAt < MAX_AGE_MS)) return;
    this.loading = true;
    try {
      this.ready.set((await this.injector.get(ReimbursementsApi).status()).ready === true);
      this.loadedAt = Date.now();
    } catch {
      this.ready.set(false);
    } finally {
      this.loading = false;
    }
  }
}
