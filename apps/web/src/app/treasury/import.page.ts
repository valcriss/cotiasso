import { Component, computed, inject, signal } from '@angular/core';
import { ThemeService } from '../theme/theme.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminApiService, type FinancialAccountInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { PageHeader } from '../ui/page-header';
import { ImportPanel } from './import-panel';

/**
 * Import d'un relevé OFX : page dédiée (design.md §4), trop vaste pour une boîte de dialogue. Le fichier est analysé, puis
 * on tranche ligne par ligne avant de confirmer ; rien n'est enregistré avant cette confirmation.
 */
@Component({
  selector: 'app-import-page',
  imports: [RouterLink, MatButtonModule, MatIconModule, PageHeader, ImportPanel],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      title="Importer un relevé bancaire"
      icon="upload_file"
      [description]="simple()
        ? 'Déposez le fichier de votre banque (format OFX) : l’application le lit, repère ce qui existe déjà et vous propose de relier vos saisies aux mouvements de la banque. Rien n’est enregistré avant votre confirmation.'
        : 'Déposez le fichier OFX de votre banque : l’application le lit, repère ce qui existe déjà et vous propose de rapprocher vos saisies. Rien n’est enregistré avant votre confirmation.'"
    >
      <a mat-stroked-button routerLink="/comptes">
        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">arrow_back</mat-icon> Retour aux comptes
      </a>
    </app-page-header>

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }
    <details class="panel help" open>
      <summary><strong>{{ simple() ? 'Où trouver le fichier de ma banque ?' : 'Qu’est-ce qu’un fichier OFX ?' }}</strong></summary>
      <p>
        C’est un fichier que <strong>vous téléchargez sur le site (ou l’application) de votre banque</strong> : il contient la liste de vos opérations
        bancaires. Il évite de tout ressaisir à la main, et l’application repère elle-même ce qui est déjà enregistré.
      </p>
      <ol>
        <li>Connectez-vous à l’espace en ligne de votre banque et ouvrez votre compte.</li>
        <li>Cherchez « Télécharger mes opérations », « Exporter » ou « Relevé téléchargeable ».</li>
        <li>Choisissez le format <strong>OFX</strong> (parfois nommé « Money » ou « Quicken »), la période voulue, puis enregistrez le fichier sur votre ordinateur.</li>
        <li>Déposez-le ci-dessous : rien n’est enregistré avant que vous ayez confirmé.</li>
      </ol>
      <p class="muted">
        Votre banque ne propose pas le format OFX (seulement un tableur ou un PDF) ? Ces formats ne sont pas lus pour le moment : saisissez vos
        opérations avec « J’ai reçu de l’argent » et « J’ai dépensé de l’argent » depuis la page Comptes.
      </p>
    </details>
    @if (account(); as current) {
      <p class="muted">Compte : <strong>{{ current.name }}</strong> @if (!simple()) { ({{ current.journalCode }}) }</p>
      <app-import-panel [account]="current" (imported)="done()" />
    } @else if (!error()) {
      <p class="muted">Chargement…</p>
    }
  `,
})
export class ImportPage {
  private readonly theme = inject(ThemeService);
  protected readonly simple = computed(() => this.theme.viewMode() === 'simple');
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly account = signal<FinancialAccountInfo | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  /** Après une confirmation, retour à la liste des comptes (le bandeau de succès a déjà été affiché). */
  protected done(): void {
    void this.router.navigateByUrl('/comptes');
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    try {
      const found = (await this.api.listFinancialAccounts()).find((a) => a.id === id);
      if (!found) this.error.set("Ce compte n'existe pas ou n'est plus disponible.");
      else if (found.archivedOn) this.error.set('Ce compte est archivé : aucun import n\'est possible.');
      else this.account.set(found);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger le compte.').message);
    }
  }
}
