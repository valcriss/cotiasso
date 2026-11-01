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
