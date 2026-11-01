import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { AdminApiService, type AccountInfo, type JournalInfo, type ProjectInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { PageHeader } from '../ui/page-header';
import { EntryEditor } from './entry-editor';

/**
 * Page dédiée à une écriture (design.md §4 : un formulaire de cette taille ne tient pas dans une boîte de dialogue).
 * Route `/comptabilite/ecritures/:id`, où `nouvelle` désigne une écriture à créer.
 */
@Component({
  selector: 'app-entry-page',
  imports: [PageHeader, EntryEditor],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      [title]="entryId() ? 'Écriture comptable' : 'Nouvelle écriture'"
      icon="edit_note"
      description="Une écriture note un mouvement dans les comptes : ce qui sort d'un compte (débit) doit toujours égaler ce qui entre dans un autre (crédit). Enregistrez-la en brouillon tant qu'elle n'est pas finie ; une fois comptabilisée, elle ne se modifie plus."
    />
    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    @if (ready()) {
      <app-entry-editor
        [entryId]="entryId()"
        [journals]="journals()"
        [accounts]="activeAccounts()"
        [projects]="activeProjects()"
        (changed)="onChanged($event.id)"
        (closed)="back()"
      />
    }
  `,
})
export class EntryPage {
  private readonly api = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** `null` pour une nouvelle écriture (adresse `…/nouvelle`). Une seule route : l'éditeur reste en place quand l'écriture reçoit son identifiant. */
  protected readonly entryId = toSignal(this.route.paramMap.pipe(map((params) => (params.get('id') === 'nouvelle' ? null : params.get('id')))), {
    initialValue: null,
  });
  protected readonly journals = signal<JournalInfo[]>([]);
  private readonly accounts = signal<AccountInfo[]>([]);
  protected readonly activeAccounts = computed(() => this.accounts().filter((a) => a.active));
  private readonly projects = signal<ProjectInfo[]>([]);
  protected readonly activeProjects = computed(() => this.projects().filter((p) => p.status !== 'ARCHIVED'));
  protected readonly ready = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.init();
  }

  /** Une écriture créée ici prend son adresse définitive, sans recharger l'éditeur. */
  protected onChanged(id: string | null): void {
    if (id !== null && this.entryId() === null) {
      void this.router.navigate(['/comptabilite/ecritures', id], { replaceUrl: true });
    }
  }

  protected back(): void {
    void this.router.navigate(['/comptabilite']);
  }

  private async init(): Promise<void> {
    try {
      const [journals, accounts] = await Promise.all([this.api.listJournals(), this.api.listAccounts()]);
      this.journals.set(journals.filter((j) => j.active));
      this.accounts.set(accounts);
      // La liste des projets exige projects:view ; sans ce droit, la ventilation n'est simplement pas proposée.
      this.projects.set(await this.api.listProjects().catch(() => []));
      this.ready.set(true);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la structure comptable.').message);
    }
  }
}
