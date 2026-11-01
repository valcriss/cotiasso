import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { base32Encode } from "./base32.js";

export const STEP_SECONDS = 30;
export const CODE_DIGITS = 6;
/** Tolérance d'horloge : un pas avant et un pas après. */
export const DEFAULT_WINDOW = 1;

/** HOTP (RFC 4226) avec HMAC-SHA1, valeur par défaut de toutes les applications d'authentification. */
export function hotp(secret: Buffer, counter: number, digits: number = CODE_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function stepAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

function sameCode(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Vérifie un code TOTP dans la fenêtre de tolérance et renvoie le pas correspondant, ou null.
 * `afterStep` interdit de rejouer un code : seuls les pas strictement postérieurs au dernier pas accepté valent.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
  options: { window?: number; afterStep?: number } = {},
): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;

  const window = options.window ?? DEFAULT_WINDOW;
  const current = stepAt(nowMs);
  let matched: number | null = null;
  // Toutes les positions sont évaluées pour ne pas révéler laquelle correspond par le temps de réponse.
  for (let step = current - window; step <= current + window; step += 1) {
    if (sameCode(hotp(secret, step), normalized) && (options.afterStep === undefined || step > options.afterStep)) {
      matched = step;
    }
  }
  return matched;
}

/** URI `otpauth://` lue par les applications d'authentification (via le QR code). */
export function otpauthUri(secret: Buffer, issuer: string, account: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(CODE_DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
