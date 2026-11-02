export interface BackupStatusFile {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  intervalHours: number;
  retentionDays: number;
}

export type BackupHealth = "OK" | "FAILING" | "STALE" | "NONE";

export interface BackupHealthReport {
  health: BackupHealth;
  message: string;
  /** Âge de la dernière sauvegarde réussie, en heures (null s'il n'y en a pas). */
  ageHours: number | null;
}

/** Marge au-delà de deux intervalles avant de déclarer les sauvegardes en retard. */
const GRACE_HOURS = 1;

/**
 * Évalue l'état des sauvegardes. Une sauvegarde manquante, échouée ou en retard doit se voir : une sauvegarde sans
 * contrôle ne prouve rien (cadrage §24.2).
 */
export function evaluateBackupHealth(status: BackupStatusFile | null, backupCount: number, now: Date): BackupHealthReport {
  if (!status || (!status.lastSuccessAt && backupCount === 0)) {
    return {
      health: "NONE",
      message: "Aucune sauvegarde n'a encore réussi. Vérifiez le service backup.",
      ageHours: null,
    };
  }

  const lastSuccess = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
  const ageHours = lastSuccess && !Number.isNaN(lastSuccess.getTime()) ? (now.getTime() - lastSuccess.getTime()) / 3_600_000 : null;
  const lastAttempt = status.lastAttemptAt ? new Date(status.lastAttemptAt) : null;

  if (status.lastError && lastAttempt && (!lastSuccess || lastAttempt >= lastSuccess)) {
    return { health: "FAILING", message: `La dernière tentative a échoué : ${status.lastError}`, ageHours };
  }
  if (ageHours === null || ageHours > status.intervalHours * 2 + GRACE_HOURS) {
    return {
      health: "STALE",
      message: `La dernière sauvegarde réussie est trop ancienne (une sauvegarde est attendue toutes les ${status.intervalHours} h).`,
      ageHours,
    };
  }
  return { health: "OK", message: "Les sauvegardes sont à jour.", ageHours };
}

export interface OffsiteStatusFile {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Cible lisible (type:chemin), sans aucun identifiant. */
  target: string;
}

export type OffsiteHealth = "OK" | "FAILING" | "STALE" | "PENDING" | "NONE";

export interface OffsiteHealthReport {
  health: OffsiteHealth;
  message: string;
  /** Âge de la dernière copie réussie, en heures (null s'il n'y en a pas). */
  ageHours: number | null;
}

/**
 * Évalue la copie hors site. Sans configuration (aucun fichier d'état), elle n'est pas en échec : elle est simplement
 * absente, ce que l'écran explique. Une copie en retard se juge sur le même rythme que la sauvegarde.
 */
export function evaluateOffsiteHealth(
  status: OffsiteStatusFile | null,
  intervalHours: number,
  now: Date,
): OffsiteHealthReport {
  if (!status) {
    return { health: "NONE", message: "La copie hors site n'est pas configurée.", ageHours: null };
  }
  const lastSuccess = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
  const validSuccess = lastSuccess && !Number.isNaN(lastSuccess.getTime()) ? lastSuccess : null;
  const ageHours = validSuccess ? (now.getTime() - validSuccess.getTime()) / 3_600_000 : null;
  const lastAttempt = status.lastAttemptAt ? new Date(status.lastAttemptAt) : null;

  if (status.lastError && lastAttempt && (!validSuccess || lastAttempt >= validSuccess)) {
    return { health: "FAILING", message: `La dernière copie hors site a échoué : ${status.lastError}`, ageHours };
  }
  if (ageHours === null) {
    return { health: "PENDING", message: "Aucune copie hors site n'a encore réussi.", ageHours };
  }
  if (ageHours > intervalHours * 2 + GRACE_HOURS) {
    return {
      health: "STALE",
      message: `La dernière copie hors site réussie est trop ancienne (une copie est attendue toutes les ${intervalHours} h).`,
      ageHours,
    };
  }
  return { health: "OK", message: "La copie hors site est à jour.", ageHours };
}
