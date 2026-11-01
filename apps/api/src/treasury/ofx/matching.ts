/** Fenêtre de recherche d'une saisie manuelle correspondant à une ligne de relevé, en jours de part et d'autre. */
export const MATCH_WINDOW_DAYS = 5;

export interface MatchCandidate {
  transactionId: string;
  operationDate: string;
  label: string;
  /** Plus c'est haut, plus la saisie ressemble à la ligne (date proche, libellé voisin). Indicatif, jamais décisif. */
  score: number;
}

const DAY_MS = 86_400_000;

/** Écart en jours entre deux dates AAAA-MM-JJ. */
export function dayDistance(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS));
}

/** Mots significatifs d'un libellé : minuscules, sans accents ni ponctuation, trois lettres au moins. */
export function words(label: string): Set<string> {
  return new Set(
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );
}

/** Ressemblance de deux libellés (indice de Jaccard sur leurs mots), de 0 à 1. */
export function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * Saisies manuelles candidates pour une ligne : même montant exact, date d'opération dans la fenêtre. Plusieurs candidates
 * sont possibles et c'est l'utilisateur qui tranche : deux paiements légitimes identiques ne sont jamais fusionnés.
 */
export function rankCandidates(
  line: { date: string; amount: string; label: string },
  manual: { id: string; operationDate: string; amount: string; label: string }[],
  limit = 3,
): MatchCandidate[] {
  return manual
    .filter((m) => m.amount === line.amount && dayDistance(m.operationDate, line.date) <= MATCH_WINDOW_DAYS)
    .map((m) => ({
      transactionId: m.id,
      operationDate: m.operationDate,
      label: m.label,
      score: Math.round(100 - dayDistance(m.operationDate, line.date) * 10 + similarity(m.label, line.label) * 20),
    }))
    .sort((a, b) => b.score - a.score || a.operationDate.localeCompare(b.operationDate) || a.transactionId.localeCompare(b.transactionId))
    .slice(0, limit);
}
