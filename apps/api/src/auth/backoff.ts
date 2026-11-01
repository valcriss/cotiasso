export interface BackoffPolicy {
  /** Échecs tolérés sans aucun délai. */
  freeAttempts: number;
  /** Délai après le premier échec au-delà de la tolérance, en secondes ; il double ensuite. */
  baseSeconds: number;
  maxSeconds: number;
}

/** Politique par compte : 5 essais libres, puis 2 s, 4 s, 8 s… plafonné à 15 minutes. */
export const ACCOUNT_BACKOFF: BackoffPolicy = { freeAttempts: 5, baseSeconds: 2, maxSeconds: 900 };

/** Politique par adresse IP : plus tolérante, car plusieurs personnes peuvent partager une adresse. */
export const IP_BACKOFF: BackoffPolicy = { freeAttempts: 20, baseSeconds: 2, maxSeconds: 900 };

/** Délai d'attente imposé après `failures` échecs consécutifs (0 = aucun). */
export function backoffSeconds(failures: number, policy: BackoffPolicy): number {
  const excess = failures - policy.freeAttempts;
  if (excess <= 0) return 0;
  const seconds = policy.baseSeconds * 2 ** (excess - 1);
  return Math.min(seconds, policy.maxSeconds);
}
