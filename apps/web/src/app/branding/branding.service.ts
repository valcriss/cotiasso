import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Branding {
  appName: string;
  sidebarBackground: string;
  sidebarText: string;
}

export const DEFAULT_BRANDING: Branding = {
  appName: 'cotiasso',
  sidebarBackground: '#eaf2fd',
  sidebarText: '#0b2a55',
};

/** Marque blanche : nom affiché et couleurs du menu, lus avant la connexion puis appliqués à toute l'interface. */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly state = signal<Branding>(DEFAULT_BRANDING);

  readonly branding = this.state.asReadonly();

  /** Charge la marque blanche de l'association ; en cas d'échec, l'interface garde ses valeurs par défaut. */
  async load(): Promise<void> {
    try {
      this.apply(await firstValueFrom(this.http.get<Branding>('/api/branding')));
    } catch {
      this.apply(DEFAULT_BRANDING);
    }
  }

  apply(branding: Branding): void {
    this.state.set(branding);
    const style = this.document.documentElement.style;
    style.setProperty('--app-sidebar-bg', branding.sidebarBackground);
    style.setProperty('--app-sidebar-text', branding.sidebarText);
    this.document.title = branding.appName;
  }
}
