import { HttpErrorResponse } from '@angular/common/http';

export interface FormError {
  message: string;
  details: string[];
}

/** Transforme une erreur HTTP de l'API en message affichable, sans jamais exposer de détail technique. */
export function describeHttpError(error: unknown, fallback: string): FormError {
  if (!(error instanceof HttpErrorResponse)) return { message: fallback, details: [] };

  if (error.status === 0) return { message: 'Le serveur est injoignable. Réessayez dans un instant.', details: [] };

  const body = error.error as { message?: unknown; issues?: unknown } | null;
  const issues = Array.isArray(body?.issues)
    ? (body.issues as unknown[])
        .map((issue) => (typeof issue === 'string' ? issue : (issue as { message?: unknown } | null)?.message))
        .filter((issue): issue is string => typeof issue === 'string')
    : [];
  const message = typeof body?.message === 'string' ? body.message : fallback;

  switch (error.status) {
    case 401:
      return { message: 'Identifiants invalides.', details: [] };
    case 403:
      return { message: typeof body?.message === 'string' ? body.message : 'Accès refusé.', details: [] };
    case 404:
    case 413:
    case 415:
    case 429:
      return { message, details: [] };
    case 400:
    case 409:
      return { message, details: issues };
    default:
      return { message: fallback, details: [] };
  }
}
