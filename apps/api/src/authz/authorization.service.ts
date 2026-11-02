import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DEFAULT_ROLES } from "./default-roles.js";
import { PERMISSIONS, PROJECT_SCOPABLE_PERMISSIONS, isPermission, isProjectScopable, type Permission } from "./permissions.js";

export type RoleWriter = Pick<Prisma.TransactionClient, "role">;

export interface EffectivePermission {
  permission: Permission;
  label: string;
  /** Rôles actifs qui accordent cette permission : l'origine du droit (écran « Accès effectifs »). */
  grantedBy: { assignmentId: string; roleId: string; roleKey: string; roleName: string }[];
}

/** Droit accordé sur un projet précis par une attribution à portée projet (ADR 0022). */
export interface ProjectScopedPermission {
  permission: Permission;
  label: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  grantedBy: { assignmentId: string; roleId: string; roleKey: string; roleName: string };
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

  /** Projets accessibles par permission, d'après les attributions à portée projet (les droits globaux se lisent à part). */
  async projectAccessFor(userId: string, now: Date = new Date()): Promise<Partial<Record<Permission, string[]>>> {
    const scoped = await this.scopedAccess(userId, now);
    const result: Partial<Record<Permission, string[]>> = {};
    for (const entry of scoped) (result[entry.permission] ??= []).push(entry.projectId);
    for (const permission of PROJECT_SCOPABLE_PERMISSIONS) if (result[permission]) result[permission] = [...new Set(result[permission])];
    return result;
  }

  /** Détail des droits par projet (écran « Accès effectifs ») : quelle attribution accorde quoi sur quel projet. */
  async scopedAccess(userId: string, now: Date = new Date()): Promise<ProjectScopedPermission[]> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: {
        userId,
        projectId: { not: null },
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        user: { status: "ACTIVE" },
      },
      include: { role: true, project: { select: { id: true, code: true, name: true } } },
    });
    const result: ProjectScopedPermission[] = [];
    for (const assignment of assignments) {
      if (!assignment.project) continue;
      for (const key of assignment.role.permissions) {
        // Seules les permissions applicables à un projet : le reste du rôle n'est jamais accordé par une portée projet.
        if (!isPermission(key) || !isProjectScopable(key)) continue;
        result.push({
          permission: key,
          label: PERMISSIONS[key],
          projectId: assignment.project.id,
          projectCode: assignment.project.code,
          projectName: assignment.project.name,
          grantedBy: { assignmentId: assignment.id, roleId: assignment.role.id, roleKey: assignment.role.key, roleName: assignment.role.name },
        });
      }
    }
    return result.sort((a, b) => a.permission.localeCompare(b.permission) || a.projectCode.localeCompare(b.projectCode));
  }

  async effectiveAccess(userId: string, now: Date = new Date()): Promise<EffectivePermission[]> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: {
        userId,
        projectId: null,
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
