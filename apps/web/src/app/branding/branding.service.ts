import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Branding {
  appName: string;
  sidebarBackground: string;
  sidebarText: string;
  /** Couleur des boutons, liens et focus ; le texte posé dessus est blanc. */
  accentColor: string;
  /** Empreinte du logo en vigueur (change avec chaque logo, donc avec l'adresse de l'image) ; null sans logo. Absente d'une réponse d'écriture. */
  logoHash?: string | null;
  /** Faux quand le logo contient déjà le nom de l'association : le nom n'est alors pas répété à côté. Absent d'une réponse d'écriture. */
  logoShowsName?: boolean;
}

/** Bleu du thème par défaut, identique à celui du serveur. */
export const DEFAULT_ACCENT = '#005cbb';

export const DEFAULT_BRANDING: Branding = {
  appName: 'cotiasso',
  sidebarBackground: '#eaf2fd',
  sidebarText: '#0b2a55',
  accentColor: DEFAULT_ACCENT,
  logoHash: null,
  logoShowsName: true,
};

/** Marque blanche : nom affiché et couleurs du menu, lus avant la connexion puis appliqués à toute l'interface. */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly state = signal<Branding>(DEFAULT_BRANDING);

  readonly branding = this.state.asReadonly();
  /** Adresse du logo de l'association, ou null sans logo. L'empreinte dans l'adresse évite d'afficher un ancien logo gardé en cache. */
  readonly logoUrl = computed(() => {
    const hash = this.state().logoHash;
    return hash ? `/api/branding/logo?v=${hash}` : null;
  });

  /** Prend en compte un logo ajouté ou retiré, sans recharger la page. */
  setLogoHash(logoHash: string | null): void {
    this.state.update((branding) => ({ ...branding, logoHash }));
  }

  /** Prend en compte le choix « logo seul » ou « logo et nom », sans recharger la page. */
  setLogoShowsName(logoShowsName: boolean): void {
    this.state.update((branding) => ({ ...branding, logoShowsName }));
  }

  /** Charge la marque blanche de l'association ; en cas d'échec, l'interface garde ses valeurs par défaut. */
  async load(): Promise<void> {
    try {
      this.apply(await firstValueFrom(this.http.get<Branding>('/api/branding')));
    } catch {
      this.apply(DEFAULT_BRANDING);
    }
  }

  apply(branding: Branding): void {
    // L'enregistrement des couleurs ne renvoie pas le logo : on garde celui qui est affiché.
    const current = this.state();
    this.state.set({
      ...branding,
      logoHash: branding.logoHash === undefined ? current.logoHash : branding.logoHash,
      logoShowsName: branding.logoShowsName === undefined ? current.logoShowsName : branding.logoShowsName,
    });
    const style = this.document.documentElement.style;
    style.setProperty('--app-sidebar-bg', branding.sidebarBackground);
    style.setProperty('--app-sidebar-text', branding.sidebarText);
    // Un accent personnalisé active la teinte dérivée (voir styles.scss) ; l'accent par défaut laisse le thème tel quel.
    const custom = !!branding.accentColor && branding.accentColor.toLowerCase() !== DEFAULT_ACCENT;
    this.document.documentElement.classList.toggle('has-accent', custom);
    if (custom) style.setProperty('--app-accent', branding.accentColor);
    else style.removeProperty('--app-accent');
    this.document.title = branding.appName;
    // Nom sous l'icône d'écran d'accueil de l'iPhone, et couleur de la barre du navigateur (celle de la barre du haut sur mobile).
    this.document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', branding.appName.slice(0, 30));
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', branding.sidebarBackground);
  }
}
