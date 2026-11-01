import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { PageHeader } from '../ui/page-header';

/** Ce que contiendra chaque rubrique non encore livrée (design.md §3) ; les titres inconnus gardent une phrase générique. */
const DESCRIPTIONS: Record<string, { icon: string; description: string }> = {
  'Membres et cotisations': { icon: 'groups', description: 'Qui adhère, qui a payé sa cotisation et pour quelle période.' },
  Subventions: { icon: 'volunteer_activism', description: 'Les aides que vous demandez ou recevez, et ce qui reste à justifier.' },
  Rapports: { icon: 'assessment', description: 'Les états de synthèse pour l’assemblée générale : bilan, compte de résultat, trésorerie.' },
};

@Component({
  selector: 'app-placeholder-page',
  imports: [PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header [title]="title()" [icon]="info().icon" [description]="info().description" />
    <section class="panel">
      <p class="muted">Cette rubrique n’est pas encore disponible : elle sera ajoutée dans une prochaine version.</p>
    </section>
  `,
})
export class PlaceholderPage {
  private readonly data = toSignal(inject(ActivatedRoute).data.pipe(map((d) => d['title'] as string | undefined)));
  protected readonly title = computed(() => this.data() ?? 'Rubrique');
  protected readonly info = computed(() => DESCRIPTIONS[this.title()] ?? { icon: 'construction', description: 'Cette rubrique arrive bientôt.' });
}
