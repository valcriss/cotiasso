import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { RoleNotFoundError } from "../authz/errors.js";
import { RolesService } from "../authz/roles.service.js";
import { linkAccountToMatchingMember } from "../members/account-link.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SelfDisableError, UserNotFoundError } from "./errors.js";
import { PasswordTokenService, type IssuedPasswordToken } from "./password-token.service.js";
import { SessionService } from "./session.service.js";
import { UsersService, type PublicUser } from "./users.service.js";

export interface CreateManagedUserInput {
  email: string;
  displayName: string;
  roleIds: string[];
}

/**
 * Administration des comptes par un administrateur. Un administrateur peut émettre un lien de réinitialisation
 * pour n'importe quel compte : c'est tracé dans l'audit, mais cela fait partie de ses pouvoirs (cadrage §6.3).
 */
@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordTokenService) private readonly tokens: PasswordTokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RolesService) private readonly roles: RolesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Crée un compte sans mot de passe utilisable, ses attributions de rôle et un lien d'invitation, atomiquement. */
  async createUser(
    input: CreateManagedUserInput,
    actorId: string,
  ): Promise<{ user: PublicUser; invitation: IssuedPasswordToken }> {
    const { user, invitation, roleKeys, linkedMemberId } = await this.prisma.$transaction(async (tx) => {
      const found = await tx.role.findMany({ where: { id: { in: input.roleIds } }, select: { id: true, key: true } });
      if (found.length !== new Set(input.roleIds).size) throw new RoleNotFoundError();

      const created = await this.users.createInvited(input, tx);
      for (const role of found) {
        await tx.roleAssignment.create({ data: { userId: created.id, roleId: role.id, createdBy: actorId } });
      }
      const issued = await this.tokens.issue(created.id, "INVITATION", actorId, new Date(), tx);
      // Une fiche de membre actuel qui porte déjà cette adresse email est reliée au nouveau compte, dans la même transaction.
      const linked = await linkAccountToMatchingMember(tx, created.id);
      return { user: created, invitation: issued, roleKeys: found.map((r) => r.key), linkedMemberId: linked };
    });

    await this.audit.record({
      action: "user.created",
      objectType: "User",
      objectId: user.id,
      actorId,
      details: { roles: roleKeys },
    });
    if (linkedMemberId) {
      await this.audit.record({ action: "member.account.linked", objectType: "Member", objectId: linkedMemberId, actorId, details: { via: "email", userId: user.id } });
    }
    return { user, invitation };
  }

  /** Émet un lien de réinitialisation à usage unique, à transmettre à l'utilisateur par l'administrateur. */
  async issueReset(userId: string, actorId: string): Promise<IssuedPasswordToken> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user) throw new UserNotFoundError();

    const issued = await this.tokens.issue(userId, "RESET", actorId);
    await this.audit.record({ action: "user.password-reset.issued", objectType: "User", objectId: userId, actorId });
    return issued;
  }

  /**
   * Désactive un compte et révoque ses sessions. Refusé pour son propre compte et si le compte est le dernier
   * administrateur actif.
   */
  async disable(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) throw new SelfDisableError();
    await this.prisma.$transaction(async (tx) => {
      await this.roles.lockLockout(tx);
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new UserNotFoundError();
      await tx.user.update({ where: { id: userId }, data: { status: "DISABLED", version: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.roles.assertAdministratorRemains(tx);
    });
    await this.audit.record({ action: "user.disabled", objectType: "User", objectId: userId, actorId });
  }

  async enable(userId: string, actorId: string): Promise<void> {
    const result = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { status: "ACTIVE", version: { increment: 1 } },
    });
    if (result.count === 0) throw new UserNotFoundError();
    await this.audit.record({ action: "user.enabled", objectType: "User", objectId: userId, actorId });
  }

  /** « Déconnecter partout » pour un utilisateur. */
  async revokeSessions(userId: string, actorId: string): Promise<number> {
    const count = await this.sessions.revokeAllForUser(userId);
    await this.audit.record({
      action: "user.sessions.revoked",
      objectType: "User",
      objectId: userId,
      actorId,
      details: { count },
    });
    return count;
  }
}
