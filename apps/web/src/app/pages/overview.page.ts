import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HealthService } from '../health.service';
import { PageHeader } from '../ui/page-header';

@Component({
  selector: 'app-overview-page',
  imports: [AsyncPipe, MatIconModule, PageHeader],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    <app-page-header
      title="Vue d’ensemble"
      icon="dashboard"
      description="Le point de départ : l’état de l’application, et bientôt les chiffres clés de votre association."
    />
    <section class="panel status">
      @switch (status$ | async) {
        @case ('up') {
          <mat-icon fontSet="material-icons-outlined">check_circle</mat-icon>
          <span>Serveur et base de données opérationnels</span>
        }
        @case ('degraded') {
          <mat-icon fontSet="material-icons-outlined">warning</mat-icon>
          <span>Serveur joignable, base de données indisponible</span>
        }
        @case ('unreachable') {
          <mat-icon fontSet="material-icons-outlined">error</mat-icon>
          <span>Serveur injoignable</span>
        }
        @default {
          <mat-icon fontSet="material-icons-outlined">hourglass_empty</mat-icon>
          <span>Vérification en cours…</span>
        }
      }
    </section>
  `,
  styles: `
    .status {
      align-items: center;
      display: flex;
      gap: 12px;
    }
  `,
})
export class OverviewPage {
  protected readonly status$ = inject(HealthService).check();
}
