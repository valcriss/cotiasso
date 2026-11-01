import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const argon2Async = promisify(argon2);

export interface Argon2Params {
  /** Mémoire en kio. */
  memory: number;
  passes: number;
  parallelism: number;
}

/** Valeurs recommandées par l'OWASP pour argon2id (19 Mio, 2 passes, 1 voie). */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memory: 19456, passes: 2, parallelism: 1 };

const TAG_LENGTH = 32;
const SALT_LENGTH = 16;
const VERSION = 19;
const PHC_PATTERN = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function b64(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=+$/, "");
}

function derive(password: string, salt: Buffer, params: Argon2Params, tagLength: number): Promise<Buffer> {
  return argon2Async("argon2id", {
    message: Buffer.from(password.normalize("NFKC"), "utf8"),
    nonce: salt,
    memory: params.memory,
    passes: params.passes,
    parallelism: params.parallelism,
    tagLength,
  });
}

/** Hache un mot de passe en argon2id et renvoie une chaîne au format PHC. */
export async function hashPassword(password: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const tag = await derive(password, salt, params, TAG_LENGTH);
  return `$argon2id$v=${VERSION}$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

export interface VerifyResult {
  valid: boolean;
  /** Vrai si le hash a été produit avec des paramètres plus faibles que ceux en vigueur. */
  needsRehash: boolean;
}

/** Vérifie un mot de passe contre un hash PHC, en temps constant sur la comparaison. */
export async function verifyPassword(
  password: string,
  encoded: string,
  current: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<VerifyResult> {
  const match = PHC_PATTERN.exec(encoded);
  if (!match || Number(match[1]) !== VERSION) {
    return { valid: false, needsRehash: false };
  }
  const params: Argon2Params = {
    memory: Number(match[2]),
    passes: Number(match[3]),
    parallelism: Number(match[4]),
  };
  const salt = Buffer.from(match[5]!, "base64");
  const expected = Buffer.from(match[6]!, "base64");
  const actual = await derive(password, salt, params, expected.length);
  const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
  const needsRehash =
    valid && (params.memory < current.memory || params.passes < current.passes || params.parallelism !== current.parallelism);
  return { valid, needsRehash };
}
