import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { csrfInterceptor } from './auth/csrf.interceptor';
import { ThemeService } from './theme/theme.service';
import { BrandingService } from './branding/branding.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // Les textes d'aide et d'erreur sous un champ peuvent passer à la ligne sans recouvrir le champ suivant.
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: 'dynamic' } },
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([csrfInterceptor])),
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled' })),
    // La marque blanche est connue avant le premier affichage, y compris sur la page de connexion.
    provideAppInitializer(() => inject(BrandingService).load()),
    // Mode et densité choisis par l'utilisateur, appliqués avant le premier affichage pour éviter tout clignotement.
    provideAppInitializer(() => inject(ThemeService).init()),
  ],
};
