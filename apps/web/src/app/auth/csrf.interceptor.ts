import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PUBLIC_PREFIXES = ['/api/auth/login', '/api/setup'];

/**
 * Joint le jeton CSRF aux requêtes modifiantes et renvoie vers la connexion quand le serveur
 * signale une session expirée (401 sur une route protégée).
 */
export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const token = auth.csrfToken;
  const outgoing =
    token && !SAFE_METHODS.has(request.method.toUpperCase())
      ? request.clone({ setHeaders: { 'x-csrf-token': token } })
      : request;

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      const expired =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        auth.user() !== null &&
        !PUBLIC_PREFIXES.some((prefix) => request.url.startsWith(prefix));
      if (expired) {
        auth.clearSession();
        void router.navigateByUrl('/connexion');
      } else if (error instanceof HttpErrorResponse && error.status === 403 && error.error?.code === 'MFA_REQUIRED') {
        // Un rôle est devenu exigeant en cours de session : on recharge l'état, la garde de route redirige.
        void auth.refresh().then(() => router.navigateByUrl('/'));
      }
      return throwError(() => error);
    }),
  );
};
