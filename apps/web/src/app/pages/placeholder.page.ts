import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';

@Component({
  selector: 'app-placeholder-page',
  template: `
    <h1>{{ title() }}</h1>
    <p>Cette rubrique n'est pas encore disponible.</p>
  `,
  styles: `
    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0 0 8px;
    }
    p {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
  `,
})
export class PlaceholderPage {
  private readonly data = toSignal(inject(ActivatedRoute).data.pipe(map((d) => d['title'] as string | undefined)));
  protected readonly title = computed(() => this.data() ?? 'Rubrique');
}
