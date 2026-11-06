import { HttpEventType, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { MenuBadges } from './menu-badges.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Une modification réussie (décision, classement, paiement…) peut changer ce qui attend la personne : on actualise les pastilles
 * du menu tout de suite, sans que chaque page ait à y penser. Ni la connexion ni l'installation ne sont concernées.
 */
export const badgesRefreshInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const badges = inject(MenuBadges);
  const relevant = !SAFE_METHODS.has(request.method.toUpperCase()) && request.url.startsWith('/api/') && !request.url.startsWith('/api/auth/') && !request.url.startsWith('/api/setup');
  return next(request).pipe(
    tap((event) => {
      if (relevant && event.type === HttpEventType.Response && auth.user() !== null) void badges.refresh(true);
    }),
  );
};
