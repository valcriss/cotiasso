import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Circuit, CircuitNode, Designation } from "./engine/circuit.js";
import type { SubmissionDirectory } from "./engine/engine.js";

type Db = PrismaService | Prisma.TransactionClient;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Traduit une désignation (personne, rôle, fonction du bureau) en personnes réellement habilitées aujourd'hui
 * (ADR 0035). Le circuit conserve la désignation, jamais le résultat : un changement de présidence est suivi
 * sans modifier le circuit. Désigner n'accorde aucun droit supplémentaire.
 */
@Injectable()
export class DesignationResolver {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Comptes actifs désignés par au moins une des désignations. */
  async eligibleUsers(designations: readonly Designation[], db: Db = this.prisma): Promise<Set<string>> {
    const users = new Set<string>();
    const ids = (kind: Designation["kind"]) => designations.filter((d) => d.kind === kind).map((d) => d.id);

    const direct = ids("USER");
    if (direct.length > 0) {
      for (const user of await db.user.findMany({ where: { id: { in: direct }, status: "ACTIVE" }, select: { id: true } })) users.add(user.id);
    }

    const roles = ids("ROLE");
    if (roles.length > 0) {
      const now = new Date();
      const assignments = await db.roleAssignment.findMany({
        where: {
          roleId: { in: roles },
          // Seules les attributions globales comptent : une attribution à portée projet n'est pas un droit sur la demande.
          projectId: null,
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          user: { status: "ACTIVE" },
        },
        select: { userId: true },
      });
      for (const assignment of assignments) users.add(assignment.userId);
    }

    const offices = ids("OFFICE");
    if (offices.length > 0) {
      const day = new Date(`${today()}T00:00:00Z`);
      const mandates = await db.memberOffice.findMany({
        where: {
          officeRoleId: { in: offices },
          startsOn: { lte: day },
          OR: [{ endsOn: null }, { endsOn: { gte: day } }],
          member: { status: "ACTIVE", userId: { not: null }, user: { status: "ACTIVE" } },
        },
        select: { member: { select: { userId: true } } },
      });
      for (const mandate of mandates) if (mandate.member.userId) users.add(mandate.member.userId);
    }
    return users;
  }

  /**
   * Annuaire d'un circuit pour le moteur : pour chaque étape, les personnes habilitées, avec les ajouts décidés
   * pour cette demande (`extra`, par étape).
   */
  async directoryFor(circuit: Circuit, extra: ReadonlyMap<string, Designation[]> = new Map(), db: Db = this.prisma): Promise<{ directory: SubmissionDirectory; byNode: Map<string, Set<string>> }> {
    const byNode = new Map<string, Set<string>>();
    for (const node of circuit.nodes) {
      if (node.type !== "APPROVAL" && node.type !== "PROCESSING") continue;
      byNode.set(node.id, await this.eligibleUsers([...node.approvers, ...(extra.get(node.id) ?? [])], db));
    }
    const set = (node: CircuitNode) => byNode.get(node.id) ?? new Set<string>();
    return {
      byNode,
      directory: {
        isDesignated: (node, userId) => set(node).has(userId),
        hasOtherDesignated: (node, userId) => [...set(node)].some((id) => id !== userId),
      },
    };
  }
}
