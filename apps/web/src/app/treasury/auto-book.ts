import { Injectable, inject } from '@angular/core';
import { AdminApiService, type OperationCategoryInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';

export type BookOutcome = { ok: true; posted: boolean } | { ok: false; message: string };

/**
 * « Rattacher ce règlement et l'enregistrer dans les comptes » d'un même geste (ADR 0028). Le rattachement (suivi des
 * cotisations ou des subventions) et l'enregistrement dans les comptes restent deux mécanismes distincts, chacun
 * valable seul ; ce service les enchaîne seulement. Le rattachement est fait en premier : si l'enregistrement est refusé,
 * le rattachement reste valable et la personne est prévenue, avec le motif, de ce qu'il reste à faire.
 */
@Injectable({ providedIn: 'root' })
export class AutoBook {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private categories: Promise<OperationCategoryInfo[]> | null = null;

  /** Qui peut classer et enregistrer un mouvement a le droit de le proposer. */
  canBook(): boolean {
    return this.auth.can('transactions:manage') && this.auth.can('entries:create');
  }

  /** Catégorie désignée pour ce rôle (cotisations, subventions), ou `null` : sans elle, rien n'est proposé. */
  async categoryFor(usage: 'MEMBERSHIP' | 'GRANT'): Promise<OperationCategoryInfo | null> {
    if (!this.canBook()) return null;
    this.categories ??= this.api.listOperationCategories().catch(() => []);
    return (await this.categories).find((c) => c.usage === usage && c.active) ?? null;
  }

  async book(transactionId: string, category: OperationCategoryInfo): Promise<BookOutcome> {
    try {
      const result = await this.api.bookTransaction(transactionId, { categoryId: category.id, post: this.auth.can('entries:post') });
      return { ok: true, posted: result.posted };
    } catch (failure) {
      return { ok: false, message: describeHttpError(failure, "L'enregistrement dans les comptes n'a pas pu se faire.").message };
    }
  }

  /** Phrase de compte rendu, à afficher après le rattachement. */
  describe(outcome: BookOutcome): string {
    if (!outcome.ok) {
      return `Rattaché, mais pas encore enregistré dans les comptes : ${outcome.message} Vous pourrez le faire depuis la liste des mouvements du compte (« Classer et enregistrer »).`;
    }
    return outcome.posted ? 'Rattaché et enregistré dans les comptes.' : 'Rattaché, et envoyé pour validation dans les comptes (brouillon à relire).';
  }
}
