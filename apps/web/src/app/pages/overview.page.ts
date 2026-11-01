import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { HealthService } from '../health.service';

@Component({
  selector: 'app-overview-page',
  imports: [AsyncPipe, MatCardModule, MatIconModule],
  template: `
    <h1>Vue d'ensemble</h1>
    <mat-card appearance="outlined" class="status">
      <mat-card-content>
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
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    h1 {
      font: var(--mat-sys-headline-small);
      margin: 0 0 16px;
    }
    .status mat-card-content {
      align-items: center;
      display: flex;
      gap: 12px;
    }
  `,
})
export class OverviewPage {
  protected readonly status$ = inject(HealthService).check();
}
