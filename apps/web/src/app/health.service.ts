import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

export type ApiStatus = 'up' | 'degraded' | 'unreachable';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  check(): Observable<ApiStatus> {
    return this.http.get<{ status: string; database: string }>('/api/health').pipe(
      map((report) => (report.status === 'ok' && report.database === 'up' ? 'up' : 'degraded')),
      catchError((error: { status?: number }) => of<ApiStatus>(error.status === 503 ? 'degraded' : 'unreachable')),
    );
  }
}
