import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../config/env.js";
import { compareVersions, evaluateUpdate, latestVersionFromTags } from "./update-check.js";
import { UpdateCheckService, type UpdateFetch } from "./update-check.service.js";

const tags = (...names: string[]) => names.map((name) => ({ name }));
const env = (over: Partial<AppEnv> = {}) => ({ appVersion: "1.0.4", updateCheckRepository: "valcriss/cotiasso", ...over }) as AppEnv;
const answering = (payload: unknown, ok = true): UpdateFetch => vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => payload }));

describe("versions", () => {
  it("compare numériquement (1.10.0 > 1.9.0), pas comme du texte", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("v2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.4", "1.0.4")).toBe(0);
    expect(compareVersions("développement", "1.0.4")).toBeNull();
  });

  it("retient la plus haute étiquette x.y.z et ignore les autres", () => {
    expect(latestVersionFromTags(tags("1.0.9", "1.0.10", "v2.0.0", "latest", "1.0.4-rc1", "0.9.0"))).toBe("1.0.10");
    expect(latestVersionFromTags(tags("latest"))).toBeNull();
    expect(latestVersionFromTags({ message: "Not Found" })).toBeNull();
  });

  it("dit à jour, mise à jour disponible, ou plus récente que la publication", () => {
    const at = "2026-11-05T10:00:00.000Z";
    expect(evaluateUpdate("1.0.4", "1.0.4", at, "u").status).toBe("UP_TO_DATE");
    expect(evaluateUpdate("1.0.4", "1.0.5", at, "u").status).toBe("UPDATE_AVAILABLE");
    const ahead = evaluateUpdate("1.0.6", "1.0.5", at, "u");
    expect(ahead.status).toBe("UP_TO_DATE");
    expect(ahead.message).toContain("plus récente");
  });
});

describe("UpdateCheckService", () => {
  it("compare à la dernière étiquette et garde le résultat en mémoire", async () => {
    const fetcher = answering(tags("1.0.3", "1.0.5", "1.0.4"));
    const service = new UpdateCheckService(env(), fetcher);
    const first = await service.check(new Date("2026-11-05T10:00:00Z"));
    expect(first).toMatchObject({ status: "UPDATE_AVAILABLE", latest: "1.0.5", url: "https://github.com/valcriss/cotiasso/releases/tag/1.0.5" });
    await service.check(new Date("2026-11-05T10:30:00Z"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await service.check(new Date("2026-11-05T11:01:00Z"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("n'envoie aucune requête en développement ni si la vérification est désactivée", async () => {
    const fetcher = answering(tags("1.0.5"));
    expect((await new UpdateCheckService(env({ appVersion: "développement" }), fetcher).check()).status).toBe("DEVELOPMENT");
    expect((await new UpdateCheckService(env({ updateCheckRepository: null }), fetcher).check()).status).toBe("DISABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("un échec réseau ou une réponse refusée donne « inconnu », jamais une exception, et retente après 5 minutes", async () => {
    const fetcher = vi.fn<UpdateFetch>().mockRejectedValueOnce(new Error("réseau")).mockResolvedValueOnce({ ok: true, status: 200, json: async () => tags("1.0.4") });
    const service = new UpdateCheckService(env(), fetcher);
    const failed = await service.check(new Date("2026-11-05T10:00:00Z"));
    expect(failed).toMatchObject({ status: "UNKNOWN", latest: null });
    await service.check(new Date("2026-11-05T10:03:00Z"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await service.check(new Date("2026-11-05T10:06:00Z"))).status).toBe("UP_TO_DATE");
    expect((await new UpdateCheckService(env(), answering({ message: "rate limit" }, false)).check()).status).toBe("UNKNOWN");
  });
});
