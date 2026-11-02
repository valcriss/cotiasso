import { Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Boutons d'export d'un état (ADR 0021) : CSV téléchargé depuis le serveur (s'ouvre dans tout tableur) et impression du
 * navigateur, qui permet d'enregistrer en PDF. Les paramètres sont ceux de l'état affiché.
 */
@Component({
  selector: 'app-export-link',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <a mat-stroked-button [href]="href()" download>
      <mat-icon fontSet="material-icons-outlined" aria-hidden="true">download</mat-icon> Exporter (CSV)
    </a>
    @if (print()) {
      <button mat-stroked-button type="button" (click)="printPage()">
        <mat-icon fontSet="material-icons-outlined" aria-hidden="true">print</mat-icon> Imprimer / enregistrer en PDF
      </button>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class ExportLink {
  /** Chemin de l'état sous `/reports/`, par exemple `income-statement` ou `ledger`. */
  readonly path = input<string>('');
  /** Adresse complète du CSV quand l'état n'est pas sous `/reports/` (ex. rapport budgétaire d'un projet). */
  readonly base = input<string>('');
  readonly params = input.required<Record<string, string | undefined>>();
  readonly print = input(false);

  protected readonly href = computed(() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(this.params())) if (value) search.set(key, value);
    return `${this.base() || `/api/reports/${this.path()}/csv`}?${search.toString()}`;
  });

  protected printPage(): void {
    window.print();
  }
}
