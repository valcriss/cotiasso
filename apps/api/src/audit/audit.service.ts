import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface AuditRecord {
  action: string;
  objectType: string;
  objectId?: string;
  actorId?: string;
  justification?: string;
  details?: Prisma.InputJsonValue;
}

/** Écriture dans le journal d'audit (ajout seul). Ne jamais y placer de secret. */
@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(entry: AuditRecord): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        action: entry.action,
        objectType: entry.objectType,
        ...(entry.objectId !== undefined && { objectId: entry.objectId }),
        ...(entry.actorId !== undefined && { actorId: entry.actorId }),
        ...(entry.justification !== undefined && { justification: entry.justification }),
        ...(entry.details !== undefined && { details: entry.details }),
      },
    });
  }
}
