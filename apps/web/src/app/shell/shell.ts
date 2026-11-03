import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { BrandingService } from '../branding/branding.service';
import { HELP_ITEM, NAVIGATION, SETTINGS_ITEM, START_ITEM } from '../navigation';
import { SetupStatus } from '../pages/setup-status.service';
import { DENSITIES, THEME_MODES, ThemeService, VIEW_MODES } from '../theme/theme.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatMenuModule, MatTooltipModule],
  styleUrl: './shell.scss',
  templateUrl: './shell.html',
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly setupStatus = inject(SetupStatus);

  protected readonly theme = inject(ThemeService);
  private readonly brandingService = inject(BrandingService);
  protected readonly associationName = computed(() => this.brandingService.branding().appName);
  protected readonly logoUrl = this.brandingService.logoUrl;
  /** Le nom accompagne le logo, sauf si l'association a choisi le logo seul (il contient déjà son nom). Sans logo, il s'affiche toujours. */
  protected readonly showName = computed(() => !this.logoUrl() || this.brandingService.branding().logoShowsName !== false);
  protected readonly navigation = computed(() => {
    this.auth.permissions();
    const simple = this.theme.viewMode() === 'simple';
    const items = NAVIGATION.filter((item) => !(simple && item.expert)).filter((item) => this.auth.can(item.additionalPermission)).filter((item) => (item.global ? this.auth.can(item.permission) : this.auth.canAny(item.permission)));
    // « Démarrer » reste dans le menu tant qu'une étape de préparation manque, pour la retrouver une fois la carte d'accueil disparue.
    if (this.setupStatus.incomplete() && this.auth.can(START_ITEM.permission)) items.splice(1, 0, START_ITEM);
    return items;
  });
  protected readonly settings = computed(() => {
    this.auth.permissions();
    return this.auth.can(SETTINGS_ITEM.permission) ? SETTINGS_ITEM : null;
  });
  protected readonly help = HELP_ITEM;
  protected readonly modes = THEME_MODES;
  protected readonly viewModes = VIEW_MODES;
  protected readonly densities = DENSITIES;
  protected readonly user = this.auth.user;
  protected readonly collapsed = signal(false);
  /** Petit écran (≤ 720 px) : le menu est un tiroir fermé par défaut, jamais une colonne d'icônes qui prend de la largeur. */
  protected readonly mobile = signal(false);
  protected readonly menuOpen = signal(false);
  /** Menu réduit à ses icônes : seulement sur grand écran. */
  protected readonly compact = computed(() => this.collapsed() && !this.mobile());

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(max-width: 720px)');
      this.mobile.set(query.matches);
      query.addEventListener('change', (event) => {
        this.mobile.set(event.matches);
        this.menuOpen.set(false);
      });
    }
    // Choisir une page referme le tiroir.
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.menuOpen.set(false));
    // Un expert-comptable (lecture et export des états, sans saisie) ouvre l'affichage comptable d'office ; son choix prime ensuite.
    effect(() => {
      this.auth.permissions();
      if (this.auth.can('reports:export') && !this.auth.can('transactions:manage')) this.theme.suggestViewMode('accounting');
    });
    effect(() => {
      this.auth.permissions();
      if (this.auth.can(START_ITEM.permission)) void this.setupStatus.ensureLoaded();
    });
  }

  protected toggle(): void {
    if (this.mobile()) {
      this.menuOpen.set(false);
    } else {
      this.collapsed.update((value) => !value);
    }
  }

  protected openMenu(): void {
    this.menuOpen.set(true);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  protected async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigateByUrl('/connexion');
    }
  }
}
