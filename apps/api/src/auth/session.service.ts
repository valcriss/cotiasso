import { Inject, Injectable } from "@nestjs/common";
import { ENV } from "../config/tokens.js";
import type { AppEnv } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { PublicUser } from "./users.service.js";
import { deriveCsrfToken, generateSessionToken, hashSessionToken } from "./session-tokens.js";

export interface SessionMeta {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface CreatedSession {
  /** Jeton à placer dans le cookie ; n'est jamais conservé côté serveur. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
  sessionId: string;
}

export interface ValidSession {
  sessionId: string;
  user: PublicUser;
  csrfToken: string;
  expiresAt: Date;
  /** Date de vérification du second facteur pour cette session, s'il a eu lieu. */
  mfaVerifiedAt: Date | null;
}

/** Les écritures de `lastSeenAt` sont espacées pour ne pas écrire en base à chaque requête. */
const TOUCH_INTERVAL_MS = 60_000;
const MAX_USER_AGENT_LENGTH = 300;

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  async create(userId: string, meta: SessionMeta = {}, now: Date = new Date()): Promise<CreatedSession> {
    const token = generateSessionToken();
    const expiresAt = new Date(now.getTime() + this.env.session.maxHours * 3_600_000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      },
    });
    return { token, csrfToken: deriveCsrfToken(token), expiresAt, sessionId: session.id };
  }

  /** Renvoie la session si elle est valide (non révoquée, non expirée, compte actif), sinon null. */
  async validate(token: string, now: Date = new Date()): Promise<ValidSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt) return null;
    if (now >= session.expiresAt) return null;
    if (now.getTime() >= session.lastSeenAt.getTime() + this.env.session.idleMinutes * 60_000) return null;
    if (session.user.status !== "ACTIVE") return null;

    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    const { id, email, displayName, status, createdAt } = session.user;
    return {
      sessionId: session.id,
      user: { id, email, displayName, status, createdAt },
      csrfToken: deriveCsrfToken(token),
      expiresAt: session.expiresAt,
      mfaVerifiedAt: session.mfaVerifiedAt,
    };
  }

  async revoke(sessionId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
  }

  /** « Déconnecter partout » : révoque toutes les sessions actives d'un utilisateur. */
  async revokeAllForUser(userId: string, now: Date = new Date()): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count;
  }
}
