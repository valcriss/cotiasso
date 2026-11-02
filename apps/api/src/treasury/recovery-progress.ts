/** Niveaux d'une anomalie : « à faire » (étape normale), « bloquant » (empêche d'avancer), « à vérifier », « information ». */
export type AnomalyLevel = "TODO" | "BLOCKING" | "WARNING" | "INFO";

/** Écran qui règle l'anomalie (le web en fait un lien). */
export type AnomalyFix = "TRANSACTIONS" | "RECOVERY" | "ENTRY" | "RECONCILIATION" | "DOCUMENTS";

export type AnomalyCode =
  | "NOT_QUALIFIED"
  | "TO_DRAFT"
  | "DRAFTS_PENDING"
  | "BLOCKED_DRAFT"
  | "OPENING_MISSING"
  | "OPENING_DRAFT"
  | "OPENING_REVERSED"
  | "NO_STATEMENT"
  | "NOT_RECONCILED"
  | "ENTRIES_WITHOUT_TRANSACTION"
  | "MISSING_DOCUMENTS";

export interface BlockedDraft {
  entryId: string;
  date: string;
  label: string;
  messages: string[];
}

export interface Anomaly {
  code: AnomalyCode;
  level: AnomalyLevel;
  financialAccountId: string | null;
  financialAccountName: string | null;
  count: number;
  /** Phrase prête à afficher : ce qui se passe et ce qu'il faut faire. */
  message: string;
  fix: AnomalyFix;
  /** Brouillons concernés (anomalie « bloquée »), les premiers seulement. */
  details?: BlockedDraft[];
}

export interface AccountCounts {
  total: number;
  qualified: number;
  drafted: number;
  posted: number;
  reconciled: number;
}

/** Pourcentage entier de `part` sur `total` ; absent quand il n'y a rien à faire (jamais « 0 % » ni « 100 % » trompeurs). */
export function percent(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.floor((part * 100) / total));
}

const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);

/** Anomalies tirées des compteurs d'un compte : étapes restant à franchir, avec la phrase qui dit quoi faire. */
export function stageAnomalies(
  account: { id: string; name: string },
  counts: AccountCounts,
  blockedDrafts: number,
): Anomaly[] {
  const out: Anomaly[] = [];
  const base = { financialAccountId: account.id, financialAccountName: account.name };

  const unqualified = counts.total - counts.qualified;
  if (unqualified > 0) {
    out.push({
      ...base,
      code: "NOT_QUALIFIED",
      level: "TODO",
      count: unqualified,
      fix: "TRANSACTIONS",
      message: `${unqualified} ${plural(unqualified, "mouvement n'a pas", "mouvements n'ont pas")} encore de compte de contrepartie : indiquez à quoi correspond chaque mouvement (cotisation, achat, subvention…), un par un ou par sélection.`,
    });
  }
  const toDraft = counts.qualified - counts.drafted;
  if (toDraft > 0) {
    out.push({
      ...base,
      code: "TO_DRAFT",
      level: "TODO",
      count: toDraft,
      fix: "RECOVERY",
      message: `${toDraft} ${plural(toDraft, "mouvement qualifié n'a", "mouvements qualifiés n'ont")} pas encore de brouillon d'écriture : préparez-les dans un lot de reprise.`,
    });
  }
  const pending = counts.drafted - counts.posted - blockedDrafts;
  if (pending > 0) {
    out.push({
      ...base,
      code: "DRAFTS_PENDING",
      level: "TODO",
      count: pending,
      fix: "RECOVERY",
      message: `${pending} ${plural(pending, "brouillon est prêt", "brouillons sont prêts")} à être comptabilisé${plural(pending, "", "s")} : relisez-les puis comptabilisez le lot.`,
    });
  }
  return out;
}

/** Vrai quand plus rien n'est à faire ni à vérifier (les informations ne comptent pas). */
export function isComplete(anomalies: Anomaly[]): boolean {
  return anomalies.every((a) => a.level === "INFO");
}
