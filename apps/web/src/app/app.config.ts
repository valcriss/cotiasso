import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { csrfInterceptor } from './auth/csrf.interceptor';
import { BrandingService } from './branding/branding.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([csrfInterceptor])),
    provideRouter(routes),
    // La marque blanche est connue avant le premier affichage, y compris sur la page de connexion.
    provideAppInitializer(() => inject(BrandingService).load()),
  ],
};
