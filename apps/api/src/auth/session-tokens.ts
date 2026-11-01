import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Jeton de session : 256 bits aléatoires, encodés pour un cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Empreinte stockée en base : une fuite de la table ne permet pas de se faire passer pour un utilisateur. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Jeton CSRF dérivé du jeton de session : aucun état supplémentaire à stocker. */
export function deriveCsrfToken(sessionToken: string): string {
  return createHash("sha256").update(`csrf:${sessionToken}`).digest("base64url");
}

export function csrfTokensMatch(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
