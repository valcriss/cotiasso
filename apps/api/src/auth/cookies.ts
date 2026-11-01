export interface CookieOptions {
  secure: boolean;
  maxAgeSeconds?: number;
}

/** Nom du cookie de session : le préfixe `__Host-` n'est utilisable qu'avec `Secure`. */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-cotiasso_session" : "cotiasso_session";
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name === "" || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Valeur mal encodée : le cookie est ignoré plutôt que de faire échouer la requête.
    }
  }
  return cookies;
}

export function serializeSessionCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.secure) parts.push("Secure");
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join("; ");
}

export function clearSessionCookie(name: string, secure: boolean): string {
  return serializeSessionCookie(name, "", { secure, maxAgeSeconds: 0 });
}
