export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export type PasswordIssue = "TOO_SHORT" | "TOO_LONG" | "TOO_COMMON" | "REPETITIVE" | "CONTAINS_EMAIL";

/**
 * Mots de passe de 12 caractères ou plus fréquemment utilisés. Liste volontairement courte et locale :
 * aucun mot de passe n'est jamais envoyé à un service externe pour vérification.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password1234",
  "password12345",
  "password123456",
  "motdepasse123",
  "motdepasse1234",
  "motdepasse12345",
  "123456789012",
  "1234567890123",
  "12345678901234",
  "azertyuiop12",
  "azertyuiopqs",
  "azertyuiop123",
  "azerty123456",
  "qwertyuiop12",
  "qwertyuiop123",
  "qwerty123456",
  "qwertyuiopas",
  "abcdefghijkl",
  "abcdefg12345",
  "iloveyou1234",
  "welcome12345",
  "bienvenue123",
  "administrator",
  "administrateur",
  "changeme1234",
  "changemoi1234",
  "letmein12345",
  "association1",
  "association12",
  "association123",
  "tresorier1234",
  "tresorier12345",
  "000000000000",
  "111111111111",
  "aaaaaaaaaaaa",
  "passw0rd1234",
  "p@ssw0rd1234",
  "p@ssword1234",
]);

function isRepetitive(value: string): boolean {
  if (new Set(value).size <= 2) return true;
  for (let size = 1; size <= Math.floor(value.length / 2); size += 1) {
    if (value.length % size === 0 && value.slice(0, size).repeat(value.length / size) === value) return true;
  }
  return false;
}

/** Renvoie la liste des problèmes ; une liste vide signifie que le mot de passe est accepté. */
export function checkPasswordPolicy(password: string, context: { email?: string } = {}): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const normalized = password.normalize("NFKC");
  const length = [...normalized].length;

  if (length < MIN_PASSWORD_LENGTH) issues.push("TOO_SHORT");
  if (length > MAX_PASSWORD_LENGTH) issues.push("TOO_LONG");

  const folded = normalized.toLowerCase();
  if (COMMON_PASSWORDS.has(folded)) issues.push("TOO_COMMON");
  if (length >= MIN_PASSWORD_LENGTH && isRepetitive(folded)) issues.push("REPETITIVE");

  const localPart = context.email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && folded.includes(localPart)) issues.push("CONTAINS_EMAIL");

  return issues;
}

export const PASSWORD_ISSUE_MESSAGES: Record<PasswordIssue, string> = {
  TOO_SHORT: `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caractères.`,
  TOO_LONG: `Le mot de passe ne peut pas dépasser ${MAX_PASSWORD_LENGTH} caractères.`,
  TOO_COMMON: "Ce mot de passe est trop courant.",
  REPETITIVE: "Le mot de passe ne doit pas être une répétition de quelques caractères.",
  CONTAINS_EMAIL: "Le mot de passe ne doit pas contenir votre adresse email.",
};
