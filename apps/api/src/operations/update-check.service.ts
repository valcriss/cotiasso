import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { evaluateUpdate, latestVersionFromTags, parseVersion, type UpdateCheckReport } from "./update-check.js";

export const UPDATE_FETCH = Symbol("UPDATE_FETCH");
export type UpdateFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const SUCCESS_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 5000;

/**
 * Compare la version déployée à la dernière étiquette « x.y.z » du dépôt public. Seule requête sortante de l'application :
 * lecture seule, sans identifiant ni donnée de l'association, désactivable (UPDATE_CHECK=false). Le résultat est gardé en
 * mémoire (1 h, 5 min après un échec) : l'écran ne déclenche jamais une requête à chaque affichage. Une erreur n'est jamais
 * remontée comme une panne : le résultat dit simplement « inconnu ».
 */
@Injectable()
export class UpdateCheckService {
  private cached: { until: number; report: UpdateCheckReport } | null = null;
  private lastSuccess: { latest: string; at: string } | null = null;

  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(UPDATE_FETCH) private readonly fetcher: UpdateFetch,
  ) {}

  async check(now: Date = new Date()): Promise<UpdateCheckReport> {
    const current = this.env.appVersion;
    const repository = this.env.updateCheckRepository;
    const none = { latest: null, checkedAt: null, url: null };
    if (!repository) {
      return { ...none, status: "DISABLED", current, message: "La vérification des mises à jour est désactivée (UPDATE_CHECK=false) : aucune requête n'est envoyée." };
    }
    if (!parseVersion(current)) {
      return { ...none, status: "DEVELOPMENT", current, message: "Version de développement : pas de comparaison avec les versions publiées." };
    }
    if (this.cached && this.cached.until > now.getTime() && this.cached.report.current === current) return this.cached.report;

    const report = await this.lookup(repository, current, now);
    this.cached = { until: now.getTime() + (report.status === "UNKNOWN" ? FAILURE_TTL_MS : SUCCESS_TTL_MS), report };
    return report;
  }

  private async lookup(repository: string, current: string, now: Date): Promise<UpdateCheckReport> {
    const releasesUrl = `https://github.com/${repository}/releases`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(`https://api.github.com/repos/${repository}/tags?per_page=100`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "cotiasso-update-check" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const latest = latestVersionFromTags(await response.json());
      if (!latest) throw new Error("aucune version publiée");
      this.lastSuccess = { latest, at: now.toISOString() };
      return evaluateUpdate(current, latest, this.lastSuccess.at, `${releasesUrl}/tag/${latest}`);
    } catch {
      return {
        status: "UNKNOWN",
        current,
        latest: this.lastSuccess?.latest ?? null,
        checkedAt: this.lastSuccess?.at ?? null,
        url: releasesUrl,
        message: "Impossible de savoir s'il existe une version plus récente : GitHub n'a pas répondu depuis ce serveur. Ce n'est pas grave ; la vérification sera retentée dans quelques minutes.",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
