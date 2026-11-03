import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { computeEventHash } from "./audit-chain.js";

export interface AuditRecord {
  action: string;
  objectType: string;
  objectId?: string;
  actorId?: string;
  justification?: string;
  details?: Prisma.InputJsonValue;
}

/** Verrou transactionnel qui sérialise les écritures du journal pour que la chaîne reste linéaire. */
const CHAIN_LOCK = "cotiasso:audit-chain";

/**
 * Écriture dans le journal d'audit (ajout seul). Chaque événement est chaîné à l'empreinte du précédent :
 * une modification ou une suppression faite directement en base est détectée par la vérification.
 * Ne jamais y placer de secret. Cette chaîne détecte l'altération ; elle ne constitue pas un archivage probant.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(entry: AuditRecord, transaction?: Prisma.TransactionClient): Promise<void> {
    const id = randomUUID();
    const occurredAt = new Date();
    const fields = {
      id,
      occurredAt,
      actorId: entry.actorId ?? null,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId ?? null,
      justification: entry.justification ?? null,
      details: entry.details ?? null,
    };

    const write = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAIN_LOCK}))`;
      const last = await tx.auditEvent.findFirst({
        where: { hash: { not: null } },
        orderBy: { seq: "desc" },
        select: { hash: true },
      });
      const previousHash = last?.hash ?? null;

      await tx.auditEvent.create({
        data: {
          id,
          occurredAt,
          actorId: fields.actorId,
          action: fields.action,
          objectType: fields.objectType,
          objectId: fields.objectId,
          justification: fields.justification,
          ...(entry.details !== undefined && { details: entry.details }),
          previousHash,
          hash: computeEventHash(previousHash, fields),
        },
      });
    };
    if (transaction) await write(transaction);
    else await this.prisma.$transaction(write);
  }
}
