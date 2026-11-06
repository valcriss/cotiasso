import { createHmac } from "node:crypto";

/** Usage des clés d'accès, au choix de l'association (ADR 0036). */
export const PASSKEY_MODES = ["DISABLED", "SECOND_FACTOR", "FULL"] as const;
export type PasskeyMode = (typeof PASSKEY_MODES)[number];

export type PasskeyAvailability =
  | { ok: true; /** Nom de domaine auquel les clés sont liées. */ rpId: string; /** Origine exacte attendue du navigateur. */ origin: string }
  | { ok: false; reason: "MISSING" | "INVALID" | "NOT_HTTPS" };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Domaine auquel les clés d'accès seraient liées, d'après PUBLIC_URL. HTTPS est obligatoire (WebAuthn l'exige),
 * sauf pour la machine locale en développement. Un domaine qui change rend toutes les clés inutilisables : il faut donc
 * qu'il soit explicite et stable.
 */
export function passkeyAvailability(publicUrl: string | null): PasskeyAvailability {
  if (!publicUrl) return { ok: false, reason: "MISSING" };
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "INVALID" };
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) return { ok: false, reason: "NOT_HTTPS" };
  if (!url.hostname) return { ok: false, reason: "INVALID" };
  return { ok: true, rpId: url.hostname, origin: url.origin };
}

/** Message en trois temps pour une adresse publique inutilisable (ce qui s'est passé, pourquoi, que faire). */
export function availabilityMessage(reason: Exclude<PasskeyAvailability, { ok: true }>["reason"]): string {
  const todo = "Renseignez PUBLIC_URL dans la configuration du serveur avec l'adresse publique en https (par exemple https://compta.asso.fr), redémarrez l'application, puis réessayez. La procédure est dans docs/exploitation.md.";
  switch (reason) {
    case "MISSING":
      return `Les clés d'accès ne peuvent pas être activées : l'adresse publique de l'application n'est pas renseignée. Une clé d'accès est liée au nom de domaine du site, il faut donc le connaître. ${todo}`;
    case "INVALID":
      return `Les clés d'accès ne peuvent pas être activées : l'adresse publique de l'application (PUBLIC_URL) n'est pas une adresse valide. Une clé d'accès est liée au nom de domaine du site. ${todo}`;
    case "NOT_HTTPS":
      return `Les clés d'accès ne peuvent pas être activées : l'adresse publique de l'application n'est pas en https. Les navigateurs n'acceptent les clés d'accès que sur une connexion chiffrée. ${todo}`;
  }
}

/** Une clé d'accès sert de second facteur dès que l'association l'autorise. */
export function allowsSecondFactor(mode: PasskeyMode): boolean {
  return mode !== "DISABLED";
}

/** Se connecter par la clé seule n'est possible qu'en mode complet. */
export function allowsPasswordlessLogin(mode: PasskeyMode): boolean {
  return mode === "FULL";
}

/**
 * Identifiant factice, stable pour une adresse donnée : proposé pour un compte inconnu ou sans clé, afin que la réponse
 * ne révèle pas l'existence d'un compte. Dérivé par HMAC d'un secret du serveur, donc imprévisible.
 */
export function decoyCredentialId(secret: Buffer, email: string): string {
  return createHmac("sha256", secret).update(`passkey-decoy:${email}`).digest().subarray(0, 32).toString("base64url");
}
