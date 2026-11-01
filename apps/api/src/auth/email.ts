const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise une adresse email (espaces retirés, minuscules) ou renvoie null si elle est invalide. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}
