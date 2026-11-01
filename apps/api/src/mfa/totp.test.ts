import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "./base32.js";
import { generateRecoveryCode, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from "./recovery-codes.js";
import { SecretCipher } from "./secret-cipher.js";
import { generateTotpSecret, hotp, otpauthUri, stepAt, verifyTotp } from "./totp.js";

// Vecteurs de test de la RFC 6238 (annexe B), HMAC-SHA1, secret ASCII « 12345678901234567890 », 8 chiffres.
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("hotp / totp (RFC 4226 et 6238)", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("produit le code attendu à t=%i", (seconds, expected) => {
    expect(hotp(RFC_SECRET, stepAt(seconds * 1000), 8)).toBe(expected);
  });

  it("produit des codes à 6 chiffres avec zéros initiaux", () => {
    expect(hotp(RFC_SECRET, 0)).toBe("755224");
    expect(hotp(RFC_SECRET, 1)).toBe("287082");
    expect(hotp(RFC_SECRET, 4)).toMatch(/^\d{6}$/);
  });
});

describe("verifyTotp", () => {
  const secret = RFC_SECRET;
  const now = 1_700_000_000_000;
  const step = stepAt(now);

  it("accepte le code courant et renvoie son pas", () => {
    expect(verifyTotp(secret, hotp(secret, step), now)).toBe(step);
  });

  it("tolère un pas d'écart d'horloge, pas deux", () => {
    expect(verifyTotp(secret, hotp(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(secret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, hotp(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, hotp(secret, step + 2), now)).toBeNull();
  });

  it("interdit de rejouer un code déjà accepté", () => {
    const code = hotp(secret, step);
    expect(verifyTotp(secret, code, now, { afterStep: step - 1 })).toBe(step);
    expect(verifyTotp(secret, code, now, { afterStep: step })).toBeNull();
    expect(verifyTotp(secret, hotp(secret, step - 1), now, { afterStep: step })).toBeNull();
  });

  it("refuse tout ce qui n'est pas un code à 6 chiffres", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34", "١٢٣٤٥٦"]) {
      expect(verifyTotp(secret, bad, now)).toBeNull();
    }
    expect(verifyTotp(secret, ` ${hotp(secret, step).slice(0, 3)} ${hotp(secret, step).slice(3)} `, now)).toBe(step);
  });
});

describe("base32", () => {
  it("reproduit les vecteurs de la RFC 4648 (sans remplissage)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
  });

  it("fait l'aller-retour sur un secret aléatoire et tolère casse, espaces et tirets", () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(20);
    const encoded = base32Encode(secret);
    expect(base32Decode(encoded.toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(secret);
    expect(() => base32Decode("1!")).toThrow(RangeError);
  });
});

describe("otpauthUri", () => {
  it("construit l'URI lue par les applications d'authentification", () => {
    const uri = new URL(otpauthUri(RFC_SECRET, "Mon Asso", "marie@asso.fr"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Mon Asso:marie@asso.fr");
    expect(uri.searchParams.get("secret")).toBe(base32Encode(RFC_SECRET));
    expect(uri.searchParams.get("issuer")).toBe("Mon Asso");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("digits")).toBe("6");
  });
});

describe("SecretCipher", () => {
  const key = Buffer.alloc(32, 7);
  const cipher = new SecretCipher(key);

  it("chiffre sans laisser voir le secret et le relit", () => {
    const secret = generateTotpSecret();
    const encoded = cipher.encrypt(secret, "user-1");
    expect(encoded.startsWith("v1.")).toBe(true);
    expect(encoded).not.toContain(base32Encode(secret));
    expect(cipher.decrypt(encoded, "user-1")).toEqual(secret);
    expect(cipher.encrypt(secret, "user-1")).not.toBe(encoded);
  });

  it("refuse un chiffré modifié, lié à un autre utilisateur ou déchiffré avec une autre clé", () => {
    const encoded = cipher.encrypt(Buffer.from("secret"), "user-1");
    expect(() => cipher.decrypt(encoded, "user-2")).toThrow();
    expect(() => new SecretCipher(Buffer.alloc(32, 8)).decrypt(encoded, "user-1")).toThrow();
    const parts = encoded.split(".");
    parts[3] = Buffer.from("autre chose").toString("base64url");
    expect(() => cipher.decrypt(parts.join("."), "user-1")).toThrow();
    expect(() => cipher.decrypt("n'importe quoi", "user-1")).toThrow();
  });

  it("exige une clé de 32 octets", () => {
    expect(() => new SecretCipher(Buffer.alloc(16))).toThrow(RangeError);
  });
});

describe("codes de secours", () => {
  it("génère 10 codes distincts au format XXXXX-XXXXX", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  });

  it("normalise la saisie et refuse les formats impossibles", () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code.replace("-", ""));
    expect(normalizeRecoveryCode(` ${code.replace("-", " ")} `)).toBe(code.replace("-", ""));
    for (const bad of ["", "ABC", "00000-00000", "AAAAA-AAAAA-AAAAA"]) expect(normalizeRecoveryCode(bad)).toBeNull();
  });

  it("produit une empreinte dépendant de la clé, jamais le code lui-même", () => {
    const normalized = normalizeRecoveryCode(generateRecoveryCode())!;
    const hash = hashRecoveryCode(normalized, Buffer.alloc(32, 1));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(normalized);
    expect(hashRecoveryCode(normalized, Buffer.alloc(32, 2))).not.toBe(hash);
  });
});
