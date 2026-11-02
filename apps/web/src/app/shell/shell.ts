import { Component, computed, inject, signal } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { BrandingService } from '../branding/branding.service';
import { NAVIGATION, SETTINGS_ITEM } from '../navigation';
import { DENSITIES, THEME_MODES, ThemeService } from '../theme/theme.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatMenuModule, MatTooltipModule],
  styleUrl: './shell.scss',
  templateUrl: './shell.html',
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly brandingService = inject(BrandingService);
  protected readonly associationName = computed(() => this.brandingService.branding().appName);
  protected readonly navigation = computed(() => {
    this.auth.permissions();
    return NAVIGATION.filter((item) => this.auth.canAny(item.permission));
  });
  protected readonly settings = computed(() => {
    this.auth.permissions();
    return this.auth.can(SETTINGS_ITEM.permission) ? SETTINGS_ITEM : null;
  });
  protected readonly theme = inject(ThemeService);
  protected readonly modes = THEME_MODES;
  protected readonly densities = DENSITIES;
  protected readonly user = this.auth.user;
  protected readonly collapsed = signal(false);

  protected toggle(): void {
    this.collapsed.update((value) => !value);
  }

  protected async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigateByUrl('/connexion');
    }
  }
}
