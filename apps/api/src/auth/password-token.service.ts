import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { PasswordTokenPurpose, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { InvalidPasswordTokenError } from "./errors.js";
import { generateSessionToken, hashSessionToken } from "./session-tokens.js";
import { UsersService } from "./users.service.js";

export interface IssuedPasswordToken {
  /** À transmettre à l'utilisateur ; n'est jamais conservé ni journalisé. */
  token: string;
  /** Chemin web du lien : le jeton est dans le fragment (#), qui n'est jamais envoyé aux serveurs ni aux logs. */
  path: string;
  expiresAt: Date;
  purpose: PasswordTokenPurpose;
}

const HOUR_MS = 3_600_000;
export const VALIDITY_HOURS: Record<PasswordTokenPurpose, number> = { INVITATION: 72, RESET: 24 };

@Injectable()
export class PasswordTokenService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Émet un jeton neuf pour un utilisateur et annule ses jetons précédents non utilisés. */
  async issue(
    userId: string,
    purpose: PasswordTokenPurpose,
    actorId: string,
    now: Date = new Date(),
    db: Pick<Prisma.TransactionClient, "passwordToken"> = this.prisma,
  ): Promise<IssuedPasswordToken> {
    const token = generateSessionToken();
    const expiresAt = new Date(now.getTime() + VALIDITY_HOURS[purpose] * HOUR_MS);
    await db.passwordToken.deleteMany({ where: { userId, usedAt: null } });
    await db.passwordToken.create({
      data: { userId, tokenHash: hashSessionToken(token), purpose, createdAt: now, expiresAt, createdBy: actorId },
    });
    return { token, path: `/reinitialisation#token=${token}`, expiresAt, purpose };
  }

  /**
   * Définit le mot de passe grâce à un jeton valide. Atomique : le jeton est verrouillé (usage unique même en
   * concurrence), un mot de passe refusé ne le consomme pas, et toutes les sessions de l'utilisateur sont révoquées.
   */
  async redeem(token: string, password: string, now: Date = new Date()): Promise<{ userId: string }> {
    const tokenHash = hashSessionToken(token);
    const userId = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; userId: string }[]>`
        SELECT "id", "userId" FROM "PasswordToken"
        WHERE "tokenHash" = ${tokenHash} AND "usedAt" IS NULL AND "expiresAt" > ${now}
        FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new InvalidPasswordTokenError();

      const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId }, select: { status: true } });
      if (user.status !== "ACTIVE") throw new InvalidPasswordTokenError();

      await this.users.setPassword(row.userId, password, tx);
      await tx.passwordToken.update({ where: { id: row.id }, data: { usedAt: now } });
      await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      return row.userId;
    });

    await this.audit.record({
      action: "auth.password.reset",
      objectType: "User",
      objectId: userId,
      actorId: userId,
    });
    return { userId };
  }
}
