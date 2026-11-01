import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { computeEventHash } from "./audit-chain.js";

export interface AuditFilters {
  action?: string;
  objectType?: string;
  objectId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditEntry {
  seq: number;
  id: string;
  occurredAt: Date;
  action: string;
  objectType: string;
  objectId: string | null;
  justification: string | null;
  details: unknown;
  actor: { id: string; displayName: string; email: string } | null;
}

export interface AuditPage {
  items: AuditEntry[];
  /** `seq` à passer en `before` pour obtenir la page suivante ; null à la fin du journal. */
  nextCursor: number | null;
}

export interface IntegrityReport {
  ok: boolean;
  /** Événements dont l'empreinte a été recalculée. */
  checked: number;
  /** Événements antérieurs à la chaîne : conservés mais non vérifiables. */
  unchained: number;
  /** Premier événement dont l'empreinte ou le chaînage ne correspond pas. */
  firstBrokenSeq: number | null;
  reason: string | null;
}

const MAX_LIMIT = 200;
const VERIFY_BATCH = 1000;

@Injectable()
export class AuditQueryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(filters: AuditFilters, options: { before?: number; limit?: number } = {}): Promise<AuditPage> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_LIMIT);
    const where: Prisma.AuditEventWhereInput = {
      ...(filters.action && { action: filters.action }),
      ...(filters.objectType && { objectType: filters.objectType }),
      ...(filters.objectId && { objectId: filters.objectId }),
      ...(filters.actorId && { actorId: filters.actorId }),
      ...((filters.from || filters.to) && {
        occurredAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) },
      }),
      ...(options.before !== undefined && { seq: { lt: BigInt(options.before) } }),
    };

    const rows = await this.prisma.auditEvent.findMany({ where, orderBy: { seq: "desc" }, take: limit + 1 });
    const page = rows.slice(0, limit);

    const actorIds = [...new Set(page.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, email: true } })
      : [];
    const byId = new Map(actors.map((actor) => [actor.id, actor]));

    return {
      items: page.map((row) => ({
        seq: Number(row.seq),
        id: row.id,
        occurredAt: row.occurredAt,
        action: row.action,
        objectType: row.objectType,
        objectId: row.objectId,
        justification: row.justification,
        details: row.details,
        actor: row.actorId ? (byId.get(row.actorId) ?? null) : null,
      })),
      nextCursor: rows.length > limit ? Number(page[page.length - 1]!.seq) : null,
    };
  }

  /** Valeurs proposées par les filtres de l'écran. */
  async facets(): Promise<{ actions: string[]; objectTypes: string[] }> {
    const [actions, objectTypes] = await Promise.all([
      this.prisma.auditEvent.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
      this.prisma.auditEvent.findMany({ distinct: ["objectType"], select: { objectType: true }, orderBy: { objectType: "asc" } }),
    ]);
    return { actions: actions.map((a) => a.action), objectTypes: objectTypes.map((o) => o.objectType) };
  }

  /**
   * Parcourt la chaîne dans l'ordre et recalcule chaque empreinte. Détecte une ligne modifiée, supprimée
   * ou insérée directement en base (qui contournerait les déclencheurs).
   */
  async verify(): Promise<IntegrityReport> {
    let checked = 0;
    let previous: string | null = null;
    let cursor = 0n;

    for (;;) {
      const batch = await this.prisma.auditEvent.findMany({
        where: { seq: { gt: cursor }, hash: { not: null } },
        orderBy: { seq: "asc" },
        take: VERIFY_BATCH,
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        if (row.previousHash !== previous) {
          return this.broken(checked, row.seq, "Le chaînage ne correspond pas à l'événement précédent (événement retiré ou inséré).");
        }
        const expected = computeEventHash(row.previousHash, {
          id: row.id,
          occurredAt: row.occurredAt,
          actorId: row.actorId,
          action: row.action,
          objectType: row.objectType,
          objectId: row.objectId,
          justification: row.justification,
          details: row.details,
        });
        if (expected !== row.hash) return this.broken(checked, row.seq, "Le contenu de l'événement a été modifié.");
        previous = row.hash;
        checked += 1;
        cursor = row.seq;
      }
    }

    const unchained = await this.prisma.auditEvent.count({ where: { hash: null } });
    return { ok: true, checked, unchained, firstBrokenSeq: null, reason: null };
  }

  private async broken(checked: number, seq: bigint, reason: string): Promise<IntegrityReport> {
    const unchained = await this.prisma.auditEvent.count({ where: { hash: null } });
    return { ok: false, checked, unchained, firstBrokenSeq: Number(seq), reason };
  }
}
