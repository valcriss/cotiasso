import { describe, expect, it } from "vitest";
import { evaluateBackupHealth, type BackupStatusFile } from "./backup-health.js";

const now = new Date("2026-11-10T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const status = (overrides: Partial<BackupStatusFile> = {}): BackupStatusFile => ({
  lastAttemptAt: hoursAgo(1),
  lastSuccessAt: hoursAgo(1),
  lastError: null,
  intervalHours: 24,
  retentionDays: 30,
  ...overrides,
});

describe("evaluateBackupHealth", () => {
  it("est OK quand la dernière sauvegarde réussie est récente", () => {
    const report = evaluateBackupHealth(status(), 3, now);
    expect(report.health).toBe("OK");
    expect(report.ageHours).toBeCloseTo(1, 5);
  });

  it("signale l'absence de toute sauvegarde ou d'état", () => {
    expect(evaluateBackupHealth(null, 0, now).health).toBe("NONE");
    expect(evaluateBackupHealth(status({ lastSuccessAt: null, lastAttemptAt: null }), 0, now).health).toBe("NONE");
  });

  it("signale une tentative échouée plus récente que la dernière réussite", () => {
    const report = evaluateBackupHealth(status({ lastAttemptAt: hoursAgo(1), lastSuccessAt: hoursAgo(25), lastError: "disque plein" }), 3, now);
    expect(report.health).toBe("FAILING");
    expect(report.message).toContain("disque plein");
  });

  it("ne signale pas un échec ancien déjà suivi d'une réussite", () => {
    expect(evaluateBackupHealth(status({ lastError: "ancien échec", lastAttemptAt: hoursAgo(2), lastSuccessAt: hoursAgo(1) }), 3, now).health).toBe("OK");
  });

  it("signale un retard au-delà de deux intervalles plus une heure de marge", () => {
    expect(evaluateBackupHealth(status({ lastSuccessAt: hoursAgo(49) }), 3, now).health).toBe("OK");
    const stale = evaluateBackupHealth(status({ lastSuccessAt: hoursAgo(50), lastAttemptAt: hoursAgo(50) }), 3, now);
    expect(stale.health).toBe("STALE");
    expect(stale.message).toContain("24 h");
  });

  it("respecte l'intervalle configuré", () => {
    expect(evaluateBackupHealth(status({ intervalHours: 1, lastSuccessAt: hoursAgo(4), lastAttemptAt: hoursAgo(4) }), 3, now).health).toBe("STALE");
    expect(evaluateBackupHealth(status({ intervalHours: 1, lastSuccessAt: hoursAgo(2.5) }), 3, now).health).toBe("OK");
  });

  it("traite une date de réussite illisible comme un retard", () => {
    expect(evaluateBackupHealth(status({ lastSuccessAt: "pas-une-date" }), 3, now).health).toBe("STALE");
  });
});
