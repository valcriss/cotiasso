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
      }
      return throwError(() => error);
    }),
  );
};
