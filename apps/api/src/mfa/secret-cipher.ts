import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "v1";

/**
 * Chiffre les secrets TOTP au repos (AES-256-GCM). Un secret TOTP doit pouvoir être relu pour vérifier un code,
 * donc il ne peut pas être haché : la clé vit hors de la base (variable d'environnement) et fait partie
 * des éléments à sauvegarder avec elle. L'identifiant de l'utilisateur est lié au chiffré (données associées).
 */
export class SecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new RangeError("La clé de chiffrement doit faire 32 octets.");
  }

  encrypt(plaintext: Buffer, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }

  decrypt(encoded: string, context: string): Buffer {
    const [prefix, iv, tag, data] = encoded.split(".");
    if (prefix !== PREFIX || !iv || !tag || !data) throw new Error("Secret chiffré invalide.");
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
  }
}
