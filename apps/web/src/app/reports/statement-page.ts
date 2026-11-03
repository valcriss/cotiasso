import { computed, inject, signal } from '@angular/core';
import { ThemeService } from '../theme/theme.service';
import { AdminApiService, type FiscalYearInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { defaultYear } from '../accounting/report-filters';

/** Chargement commun des pages d'états : exercices, exercice choisi, état, erreur. */
export abstract class StatementPageBase<T> {
  protected abstract readonly api: AdminApiService;
  private readonly theme = inject(ThemeService);
  /** Affichage simple (ADR 0028) : les phrases d'avertissement parlent d'opérations plutôt que d'écritures et de classes de comptes. */
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  protected readonly years = signal<FiscalYearInfo[]>([]);
  protected readonly yearId = signal('');
  protected readonly data = signal<T | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected abstract fetch(fiscalYearId: string): Promise<T>;

  protected async init(): Promise<void> {
    try {
      const years = await this.api.listFiscalYears();
      this.years.set(years);
      const initial = defaultYear(years);
      if (initial) {
        this.yearId.set(initial.id);
        await this.show();
      }
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les périodes de comptabilité (exercices).').message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async choose(fiscalYearId: string): Promise<void> {
    this.yearId.set(fiscalYearId);
    this.loading.set(true);
    await this.show();
    this.loading.set(false);
  }

  private async show(): Promise<void> {
    this.error.set(null);
    try {
      this.data.set(await this.fetch(this.yearId()));
    } catch (failure) {
      this.data.set(null);
      this.error.set(describeHttpError(failure, "Impossible de calculer l'état.").message);
    }
  }
}
