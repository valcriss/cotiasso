import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { AlreadySetUpError, InvalidSetupTokenError } from "../auth/errors.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { ADMIN_ROLE_KEY } from "../authz/default-roles.js";
import { generateSessionToken, hashSessionToken } from "../auth/session-tokens.js";
import { UsersService, type CreateUserInput, type PublicUser } from "../auth/users.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Assistant initial : tant qu'aucun compte n'existe, l'API génère au démarrage un jeton à usage unique, affiché
 * uniquement dans les logs, que la création du premier compte exige. Cela empêche un tiers de prendre la main
 * sur une installation fraîchement déployée avant son administrateur légitime.
 */
@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureToken();
  }

  async isSetupRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /** Remplace les jetons inutilisés par un jeton neuf et l'affiche dans les logs. Renvoie null si déjà installé. */
  async ensureToken(): Promise<string | null> {
    if (!(await this.isSetupRequired())) return null;

    const token = generateSessionToken();
    await this.prisma.$transaction([
      this.prisma.setupToken.deleteMany({ where: { usedAt: null } }),
      this.prisma.setupToken.create({ data: { tokenHash: hashSessionToken(token) } }),
    ]);

    this.logger.warn(
      [
        "",
        "============================================================",
        " Installation requise : aucun compte n'existe.",
        " Jeton d'installation (à usage unique, à saisir dans l'assistant) :",
        ` ${token}`,
        "============================================================",
      ].join("\n"),
    );
    return token;
  }

  /**
   * Crée le premier compte si le jeton est valide. Tout est atomique : le jeton est verrouillé, donc deux requêtes
   * concurrentes ne peuvent pas créer deux comptes, et un mot de passe refusé ne consomme pas le jeton.
   */
  async complete(token: string, input: CreateUserInput): Promise<PublicUser> {
    const tokenHash = hashSessionToken(token);
    const user = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "SetupToken" WHERE "tokenHash" = ${tokenHash} AND "usedAt" IS NULL FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new InvalidSetupTokenError();
      if ((await tx.user.count()) > 0) throw new AlreadySetUpError();

      const created = await this.users.createUser(input, tx);

      // Le premier compte reçoit le rôle d'administration : sans lui, personne ne pourrait gérer les accès.
      await this.authorization.ensureDefaultRoles(tx);
      const adminRole = await tx.role.findUniqueOrThrow({ where: { key: ADMIN_ROLE_KEY }, select: { id: true } });
      await tx.roleAssignment.create({ data: { userId: created.id, roleId: adminRole.id, createdBy: created.id } });

      await tx.setupToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      return created;
    });

    await this.audit.record({
      action: "setup.completed",
      objectType: "User",
      objectId: user.id,
      actorId: user.id,
      details: { role: ADMIN_ROLE_KEY },
    });
    return user;
  }
}
