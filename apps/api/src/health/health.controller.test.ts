import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("répond ok quand la base répond", async () => {
    const controller = new HealthController({ ping: async () => {} });
    await expect(controller.check()).resolves.toEqual({ status: "ok", database: "up" });
  });

  it("répond 503 quand la base est injoignable", async () => {
    const controller = new HealthController({
      ping: async () => {
        throw new Error("connexion refusée");
      },
    });
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
