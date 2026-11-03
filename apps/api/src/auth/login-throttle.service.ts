import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ACCOUNT_BACKOFF, IP_BACKOFF, backoffSeconds, type BackoffPolicy } from "./backoff.js";

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Fenêtre d'observation : au-delà, les échecs anciens ne comptent plus. */
const WINDOW_MS = 15 * 60_000;
const MAX_ACTIVE_LOGINS = 4;

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

@Injectable()
export class LoginThrottleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Décide si une tentative peut être traitée. Le délai croît avec les échecs récents, par compte et par IP,
   * sans jamais verrouiller définitivement : un tiers ne peut pas bloquer le compte d'un autre.
   * Appliqué aussi aux adresses inconnues, pour ne pas révéler l'existence d'un compte.
   */
  async check(email: string | null, ipAddress: string | undefined, now: Date = new Date(), db: Prisma.TransactionClient = this.prisma): Promise<ThrottleDecision> {
    const since = new Date(now.getTime() - WINDOW_MS);
    const [byEmail, byIp] = await Promise.all([
      email ? this.evaluate({ email }, since, ACCOUNT_BACKOFF, now, db) : ALLOWED,
      ipAddress ? this.evaluate({ ipAddress }, since, IP_BACKOFF, now, db) : ALLOWED,
    ]);
    const retryAfterSeconds = Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds);
    return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
  }

  private activeLogins = 0;

  async reserveLogin(email: string | null, ipAddress: string | undefined) {
    if (this.activeLogins >= MAX_ACTIVE_LOGINS) return { allowed: false as const, retryAfterSeconds: 1 };
    this.activeLogins++;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // La réservation compte comme un échec jusqu'à la fin de la vérification du mot de passe.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cotiasso:login-reservation'))`;
        const now = new Date();
        const decision = await this.check(email, ipAddress, now, tx);
        if (!decision.allowed) return { allowed: false as const, retryAfterSeconds: decision.retryAfterSeconds };
        const attempt = await tx.loginAttempt.create({
          data: { email, ipAddress: ipAddress ?? null, success: false, occurredAt: now },
          select: { id: true },
        });
        return { allowed: true as const, finish: async (success: boolean) => {
          try {
            if (success) await this.prisma.loginAttempt.update({ where: { id: attempt.id }, data: { success: true } });
          } finally {
            this.activeLogins--;
          }
        } };
      });
      if (!result.allowed) this.activeLogins--;
      return result;
    } catch (error) {
      this.activeLogins--;
      throw error;
    }
  }

  async record(email: string | null, ipAddress: string | undefined, success: boolean, now: Date = new Date()): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: { email, ipAddress: ipAddress ?? null, success, occurredAt: now },
    });
  }

  private async evaluate(
    filter: { email: string } | { ipAddress: string },
    since: Date,
    policy: BackoffPolicy,
    now: Date,
    db: Prisma.TransactionClient,
  ): Promise<ThrottleDecision> {
    // Seuls comptent les échecs postérieurs au dernier succès : une connexion réussie remet le compteur à zéro.
    const lastSuccess = await db.loginAttempt.findFirst({
      where: { ...filter, success: true, occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    const from = lastSuccess ? lastSuccess.occurredAt : since;

    const failures = await db.loginAttempt.findMany({
      where: { ...filter, success: false, occurredAt: { gt: from } },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    const delay = backoffSeconds(failures.length, policy);
    const last = failures[0];
    if (delay === 0 || !last) return ALLOWED;

    const remaining = Math.ceil((last.occurredAt.getTime() + delay * 1000 - now.getTime()) / 1000);
    return remaining > 0 ? { allowed: false, retryAfterSeconds: remaining } : ALLOWED;
  }
}
