import { createHmac, randomInt } from "node:crypto";

export const RECOVERY_CODE_COUNT = 10;
/** Alphabet sans caractères ambigus (0/O, 1/I) pour des codes recopiables à la main. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUP = 5;

/** Un code de secours : 10 caractères en deux groupes, soit environ 50 bits d'entropie. */
export function generateRecoveryCode(): string {
  const chars = Array.from({ length: GROUP * 2 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chars.slice(0, GROUP)}-${chars.slice(GROUP)}`;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, generateRecoveryCode);
}

/** Tolère la casse, les espaces et le tiret ; renvoie null si le format ne peut pas être un code de secours. */
export function normalizeRecoveryCode(input: string): string | null {
  const normalized = input.toUpperCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${ALPHABET}]{${GROUP * 2}}$`).test(normalized) ? normalized : null;
}

/** Empreinte HMAC avec la clé de l'application : une fuite de la table seule ne permet pas de tester des codes. */
export function hashRecoveryCode(normalized: string, key: Buffer): string {
  return createHmac("sha256", key).update(`recovery:${normalized}`).digest("hex");
}
