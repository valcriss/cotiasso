import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DEFAULT_ROLES } from "./default-roles.js";
import { PERMISSIONS, isPermission, type Permission } from "./permissions.js";

export type RoleWriter = Pick<Prisma.TransactionClient, "role">;

export interface EffectivePermission {
  permission: Permission;
  label: string;
  /** Rôles actifs qui accordent cette permission : l'origine du droit (écran « Accès effectifs »). */
  grantedBy: { assignmentId: string; roleId: string; roleKey: string; roleName: string }[];
}

@Injectable()
export class AuthorizationService implements OnApplicationBootstrap {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDefaultRoles();
  }

  /** Installe les rôles modèles manquants, sans jamais écraser un rôle que l'association a modifié. */
  async ensureDefaultRoles(db: RoleWriter = this.prisma): Promise<void> {
    await db.role.createMany({
      data: DEFAULT_ROLES.map((role) => ({
        key: role.key,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        requiresMfa: role.requiresMfa,
      })),
      skipDuplicates: true,
    });
  }

  /** Permissions d'un utilisateur : union des rôles actifs ; refus par défaut, et rien pour un compte désactivé. */
  async permissionsFor(userId: string, now: Date = new Date()): Promise<Set<Permission>> {
    const access = await this.effectiveAccess(userId, now);
    return new Set(access.map((entry) => entry.permission));
  }

  async effectiveAccess(userId: string, now: Date = new Date()): Promise<EffectivePermission[]> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: {
        userId,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        user: { status: "ACTIVE" },
      },
      include: { role: true },
    });

    const byPermission = new Map<Permission, EffectivePermission>();
    for (const assignment of assignments) {
      for (const key of assignment.role.permissions) {
        if (!isPermission(key)) continue;
        const entry = byPermission.get(key) ?? { permission: key, label: PERMISSIONS[key], grantedBy: [] };
        entry.grantedBy.push({
          assignmentId: assignment.id,
          roleId: assignment.role.id,
          roleKey: assignment.role.key,
          roleName: assignment.role.name,
        });
        byPermission.set(key, entry);
      }
    }
    return [...byPermission.values()].sort((a, b) => a.permission.localeCompare(b.permission));
  }
}
