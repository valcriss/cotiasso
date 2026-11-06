import { HttpErrorResponse } from '@angular/common/http';
import type { FormError } from './error-messages';

/**
 * Message affichable pour un échec de clé d'accès, en trois temps (ce qui s'est passé, pourquoi, que faire). Les erreurs du serveur
 * portent déjà un message rédigé ainsi ; celles du navigateur (annulation, appareil incompatible) sont traduites ici.
 * Jamais de nom de code technique.
 */
export function describePasskeyError(error: unknown, fallback: string): FormError {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return { message: 'Le serveur est injoignable. Réessayez dans un instant.', details: [] };
    const body = error.error as { message?: unknown } | null;
    return { message: typeof body?.message === 'string' ? body.message : fallback, details: [] };
  }
  const name = (error as { name?: unknown } | null)?.name;
  const code = (error as { code?: unknown } | null)?.code;
  if (name === 'NotAllowedError' || code === 'ERROR_CEREMONY_ABORTED') {
    return {
      message:
        'La clé d’accès n’a pas été utilisée : la demande a été annulée ou a pris trop de temps. Rien n’a été modifié. Recommencez, en déverrouillant votre appareil quand il le propose, ou utilisez un autre moyen.',
      details: [],
    };
  }
  if (name === 'InvalidStateError' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return {
      message: 'Cet appareil a déjà une clé d’accès pour votre compte. Il est inutile d’en ajouter une seconde : utilisez celle-ci, ou retirez-la d’abord.',
      details: [],
    };
  }
  if (name === 'SecurityError') {
    return {
      message:
        'Votre navigateur refuse la clé d’accès sur cette adresse. Les clés d’accès sont liées à l’adresse officielle du site : ouvrez l’application par son adresse habituelle (en https), puis réessayez.',
      details: [],
    };
  }
  if (name === 'NotSupportedError' || code === 'ERROR_AUTHENTICATOR_NO_SUPPORTED_ALGORITHM') {
    return {
      message: 'Cet appareil ne gère pas les clés d’accès. Utilisez votre mot de passe, ou un autre appareil.',
      details: [],
    };
  }
  return { message: fallback, details: [] };
}
