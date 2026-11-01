import type { PasswordLink } from './admin-api.service';

/** Lien complet à transmettre : le jeton reste dans le fragment (#), jamais envoyé à un serveur. */
export function fullLink(link: PasswordLink, origin: string = window.location.origin): string {
  return `${origin}${link.path}`;
}
