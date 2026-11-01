import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";

export interface DatabasePing {
  ping(): Promise<void>;
}

export const DATABASE_PING = Symbol("DATABASE_PING");

export interface HealthReport {
  status: "ok";
  database: "up";
}

@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE_PING) private readonly database: DatabasePing) {}

  @Public()
  @Get()
  async check(): Promise<HealthReport> {
    try {
      await this.database.ping();
    } catch {
      throw new ServiceUnavailableException({ status: "error", database: "down" });
    }
    return { status: "ok", database: "up" };
  }
}
