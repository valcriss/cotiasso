/** Logique pure de la vérification des versions : lire les étiquettes publiées, comparer, formuler le résultat. */

export type UpdateStatus = "UP_TO_DATE" | "UPDATE_AVAILABLE" | "UNKNOWN" | "DISABLED" | "DEVELOPMENT";

export interface UpdateCheckReport {
  status: UpdateStatus;
  /** Version déployée. */
  current: string;
  /** Dernière version publiée, si elle a pu être lue. */
  latest: string | null;
  /** Instant de la dernière lecture réussie du dépôt (pas celui de la requête en cours si elle a échoué). */
  checkedAt: string | null;
  /** Page où lire ce que contient la dernière version, si elle est connue. */
  url: string | null;
  message: string;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(text: string): [number, number, number] | null {
  const match = VERSION.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Négatif si a < b, positif si a > b ; null si l'un des deux n'est pas un numéro de version. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! !== right[i]!) return left[i]! - right[i]!;
  }
  return 0;
}

/** La plus haute étiquette « x.y.z » d'une réponse de l'API GitHub (liste d'objets avec `name`) ; les autres noms sont ignorés. */
export function latestVersionFromTags(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  let best: string | null = null;
  for (const item of payload) {
    const name = typeof item === "object" && item !== null ? (item as { name?: unknown }).name : undefined;
    if (typeof name !== "string" || !/^\d+\.\d+\.\d+$/.test(name)) continue;
    if (best === null || (compareVersions(name, best) ?? 0) > 0) best = name;
  }
  return best;
}

export function evaluateUpdate(current: string, latest: string, checkedAt: string, url: string): UpdateCheckReport {
  const base = { current, latest, checkedAt, url };
  const order = compareVersions(current, latest);
  if (order === null) {
    return {
      ...base,
      status: "UNKNOWN",
      message: `La version déployée (${current}) n'est pas un numéro de version : impossible de la comparer à la dernière version publiée (${latest}).`,
    };
  }
  if (order < 0) {
    return {
      ...base,
      status: "UPDATE_AVAILABLE",
      message: `La version ${latest} est disponible (vous êtes en ${current}). Lisez ses notes de version, puis lancez la mise à jour.`,
    };
  }
  return {
    ...base,
    status: "UP_TO_DATE",
    message: order === 0 ? `Vous utilisez la dernière version publiée (${latest}).` : `Vous utilisez ${current}, plus récente que la dernière version publiée (${latest}).`,
  };
}
