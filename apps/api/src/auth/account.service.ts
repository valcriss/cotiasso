import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserNotFoundError, WrongCurrentPasswordError } from "./errors.js";
import { UsersService } from "./users.service.js";

/** Opérations qu'un utilisateur fait sur son propre compte. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Change le mot de passe après vérification de l'actuel ; les autres sessions de l'utilisateur sont révoquées. */
  async changePassword(userId: string, currentPassword: string, newPassword: string, currentSessionId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new UserNotFoundError();
    if (!(await this.users.verifyCredentials(user.email, currentPassword))) throw new WrongCurrentPasswordError();

    await this.users.setPassword(userId, newPassword);
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ action: "auth.password.changed", objectType: "User", objectId: userId, actorId: userId });
  }
}
