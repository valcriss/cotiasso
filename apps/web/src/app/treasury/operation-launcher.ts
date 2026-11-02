import { Injectable, inject } from '@angular/core';
import { AdminApiService, type GuidedOperationResult, type ProjectInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { OperationDialog, type OperationDialogData } from './operation-dialog';

/**
 * Ouvre « J'ai reçu / J'ai dépensé de l'argent » depuis n'importe quelle page : charge ce qu'il faut, explique ce qui
 * manque (compte ou catégories absents) au lieu d'ouvrir un formulaire inutilisable, puis confirme par un bandeau.
 */
@Injectable({ providedIn: 'root' })
export class OperationLauncher {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(Dialogs);
  private readonly notifier = inject(Notifier);

  /** Renvoie le résultat si une opération a été enregistrée, sinon `undefined` (abandon ou impossibilité, déjà expliquée). */
  async open(direction: 'IN' | 'OUT', accountId: string | null = null): Promise<GuidedOperationResult | undefined> {
    let accounts, categories, projects: ProjectInfo[];
    try {
      [accounts, categories, projects] = await Promise.all([
        this.api.listFinancialAccounts(),
        this.api.listOperationCategories(),
        this.api.listProjects().catch(() => [] as ProjectInfo[]),
      ]);
    } catch (failure) {
      this.notifier.notice(describeHttpError(failure, 'Impossible de charger vos comptes pour le moment. Réessayez dans un instant.').message);
      return undefined;
    }
    const active = accounts.filter((a) => !a.archivedOn);
    if (active.length === 0) {
      this.notifier.notice("Ajoutez d'abord votre compte bancaire (ou votre caisse) : l'argent s'enregistre toujours sur un compte. Menu « Comptes », ou l'assistant de démarrage.");
      return undefined;
    }
    if (!categories.some((c) => c.direction === direction)) {
      this.notifier.notice(
        "Il n'y a pas encore de catégorie pour ce type d'opération. Une personne qui administre la comptabilité peut installer les catégories de départ (Paramètres › Comptabilité, ou l'assistant de démarrage).",
      );
      return undefined;
    }
    const result = await this.dialogs.open<GuidedOperationResult, OperationDialogData>(OperationDialog, {
      size: 'md',
      data: { direction, accounts: active, categories, projects, accountId, canPost: this.auth.can('entries:post') },
    });
    if (result) {
      this.notifier.success(
        result.posted
          ? `Opération enregistrée${result.number ? ` (écriture ${result.journalCode} n° ${result.number})` : ''}.`
          : 'Opération mise en brouillon : elle sera prise en compte une fois relue et enregistrée.',
      );
    }
    return result;
  }
}

