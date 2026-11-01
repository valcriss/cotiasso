import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LOCKOUT_PERMISSION } from "./default-roles.js";
import {
  AssignmentNotFoundError,
  DuplicateRoleError,
  InvalidRoleError,
  LastAdministratorError,
  RoleNotFoundError,
} from "./errors.js";
import { isPermission, type Permission } from "./permissions.js";

export interface RoleInput {
  key?: string;
  name: string;
  description: string;
  permissions: string[];
}

export interface AssignInput {
  roleId: string;
  startsAt?: Date;
  endsAt?: Date | null;
}

type Tx = Prisma.TransactionClient;

const ROLE_KEY_FORMAT = /^[a-z][a-z0-9-]*$/;
/** Verrou transactionnel qui sérialise toutes les opérations pouvant retirer des droits d'administration. */
const LOCKOUT_LOCK = "cotiasso:users-admin";

function validatePermissions(permissions: string[]): Permission[] {
  const unknown = permissions.filter((key) => !isPermission(key));
  if (unknown.length > 0) throw new InvalidRoleError(`Permissions inconnues : ${unknown.join(", ")}.`);
  return [...new Set(permissions)] as Permission[];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: "asc" },
      select: { id: true, key: true, name: true, description: true, permissions: true, version: true },
    });
  }

  async createRole(input: RoleInput, actorId: string) {
    const key = input.key ?? "";
    if (!ROLE_KEY_FORMAT.test(key)) {
      throw new InvalidRoleError("La clé du rôle doit être en minuscules, chiffres et tirets, et commencer par une lettre.");
    }
    const permissions = validatePermissions(input.permissions);
    try {
      const role = await this.prisma.role.create({
        data: { key, name: input.name.trim(), description: input.description.trim(), permissions },
      });
      await this.audit.record({ action: "role.created", objectType: "Role", objectId: role.id, actorId, details: { key, permissions } });
      return role;
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateRoleError();
      throw error;
    }
  }

  /** Modifie un rôle. Refusé si cela retirerait le dernier compte actif pouvant administrer les utilisateurs. */
  async updateRole(roleId: string, input: RoleInput, actorId: string) {
    const permissions = validatePermissions(input.permissions);
    const role = await this.prisma.$transaction(async (tx) => {
      await this.lockLockout(tx);
      const before = await tx.role.findUnique({ where: { id: roleId } });
      if (!before) throw new RoleNotFoundError();
      const updated = await tx.role.update({
        where: { id: roleId },
        data: {
          name: input.name.trim(),
          description: input.description.trim(),
          permissions,
          version: { increment: 1 },
        },
      });
      await this.assertAdministratorRemains(tx);
      return { before, updated };
    });
    await this.audit.record({
      action: "role.updated",
      objectType: "Role",
      objectId: roleId,
      actorId,
      details: { from: role.before.permissions, to: permissions },
    });
    return role.updated;
  }

  listUsers() {
    return this.prisma.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        roleAssignments: {
          where: { revokedAt: null },
          select: { id: true, startsAt: true, endsAt: true, role: { select: { id: true, key: true, name: true } } },
        },
      },
    });
  }

  async assign(userId: string, input: AssignInput, actorId: string) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      this.prisma.role.findUnique({ where: { id: input.roleId }, select: { id: true, key: true } }),
    ]);
    if (!user) throw new InvalidRoleError("Utilisateur introuvable.");
    if (!role) throw new RoleNotFoundError();

    const startsAt = input.startsAt ?? new Date();
    if (input.endsAt && input.endsAt <= startsAt) throw new InvalidRoleError("La fin doit suivre le début.");

    const assignment = await this.prisma.roleAssignment.create({
      data: { userId, roleId: role.id, startsAt, endsAt: input.endsAt ?? null, createdBy: actorId },
    });
    await this.audit.record({
      action: "role.assigned",
      objectType: "User",
      objectId: userId,
      actorId,
      details: { roleKey: role.key, assignmentId: assignment.id },
    });
    return assignment;
  }

  /** Révoque une attribution, sauf si elle laisserait l'installation sans administrateur actif. */
  async revoke(assignmentId: string, actorId: string): Promise<void> {
    const revoked = await this.prisma.$transaction(async (tx) => {
      await this.lockLockout(tx);
      const assignment = await tx.roleAssignment.findUnique({ where: { id: assignmentId }, include: { role: true } });
      if (!assignment || assignment.revokedAt) throw new AssignmentNotFoundError();
      await tx.roleAssignment.update({ where: { id: assignmentId }, data: { revokedAt: new Date(), revokedBy: actorId } });
      await this.assertAdministratorRemains(tx);
      return assignment;
    });
    await this.audit.record({
      action: "role.revoked",
      objectType: "User",
      objectId: revoked.userId,
      actorId,
      details: { roleKey: revoked.role.key, assignmentId },
    });
  }

  /** À appeler dans toute transaction qui peut retirer des droits (rôle modifié, attribution révoquée, compte désactivé). */
  lockLockout(tx: Tx): Promise<unknown> {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCKOUT_LOCK}))`;
  }

  /** Échoue si plus aucun compte actif ne détient la permission d'administration des utilisateurs. */
  async assertAdministratorRemains(tx: Tx, now: Date = new Date()): Promise<void> {
    const rows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT ra."userId") AS count
      FROM "RoleAssignment" ra
      JOIN "Role" r ON r."id" = ra."roleId"
      JOIN "User" u ON u."id" = ra."userId"
      WHERE ra."revokedAt" IS NULL
        AND ra."startsAt" <= ${now}
        AND (ra."endsAt" IS NULL OR ra."endsAt" > ${now})
        AND u."status" = 'ACTIVE'
        AND ${LOCKOUT_PERMISSION} = ANY (r."permissions")`;
    if (Number(rows[0]?.count ?? 0) === 0) throw new LastAdministratorError();
  }
}
