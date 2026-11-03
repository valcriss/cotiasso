/**
 * Suggestions de classement (ADR 0019 amendé le 3 novembre 2026). Une suggestion reprend le classement que la personne a
 * elle-même choisi pour un mouvement **du même compte financier, du même sens, au libellé identique une fois normalisé**.
 * Aucune règle saisie, aucun mot-clé, aucune statistique : et **jamais appliquée seule** (voir `acceptSuggestions`).
 * Module pur (sans base), testé à part.
 */

/** Un libellé trop court ou sans lettre ne dit rien du bénéficiaire : on ne s'en sert pas. */
const MIN_NORMALIZED_LENGTH = 3;

/**
 * Libellé comparable : sans casse, accents, ponctuation, ni mots contenant un chiffre (dates, numéros de carte, de facture,
 * références qui changent d'un mois à l'autre). « Prélèvement MAIF n° 4521 du 05/11 » et « PRELEVEMENT MAIF 4598 » se rejoignent.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !/\p{N}/u.test(word))
    .join(" ");
}

export interface ClassifiedSample {
  label: string;
  /** Sens du mouvement : 1 = argent reçu, -1 = argent dépensé. */
  sign: 1 | -1;
  counterpartAccountId: string;
  projectId: string | null;
  /** AAAA-MM-JJ */
  operationDate: string;
}

export interface Suggestion {
  counterpartAccountId: string;
  projectId: string | null;
  /** Le mouvement le plus récent dont le classement est repris. */
  basedOn: { label: string; operationDate: string };
  /** Combien de mouvements déjà classés vont dans ce sens (tous concordants). */
  matches: number;
}

/** Index des mouvements déjà classés ; renvoie la suggestion d'un libellé, ou `null` (aucun précédent ou précédents contradictoires). */
export function buildSuggester(samples: readonly ClassifiedSample[]): (label: string, sign: 1 | -1) => Suggestion | null {
  const index = new Map<string, ClassifiedSample[]>();
  for (const sample of samples) {
    const normalized = normalizeLabel(sample.label);
    if (normalized.length < MIN_NORMALIZED_LENGTH) continue;
    const key = `${sample.sign}|${normalized}`;
    const list = index.get(key);
    if (list) list.push(sample);
    else index.set(key, [sample]);
  }
  return (label, sign) => {
    const normalized = normalizeLabel(label);
    if (normalized.length < MIN_NORMALIZED_LENGTH) return null;
    const found = index.get(`${sign}|${normalized}`);
    if (!found) return null;
    // Deux classements différents pour le même libellé : on ne devine pas.
    const distinct = new Set(found.map((s) => `${s.counterpartAccountId}|${s.projectId ?? ""}`));
    if (distinct.size > 1) return null;
    const latest = found.reduce((a, b) => (b.operationDate > a.operationDate ? b : a));
    return {
      counterpartAccountId: latest.counterpartAccountId,
      projectId: latest.projectId,
      basedOn: { label: latest.label, operationDate: latest.operationDate },
      matches: found.length,
    };
  };
}
