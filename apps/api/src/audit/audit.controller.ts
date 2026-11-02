import { BadRequestException, Controller, Get, Inject, Query, Req, Res, UnprocessableEntityException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { safeFilename, toCsv } from "../accounting/csv.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { auditCsv } from "./audit-csv.js";
import { AuditExportTooLargeError, AuditQueryService, type AuditFilters, type AuditPage, type IntegrityReport } from "./audit-query.service.js";
import { AuditService } from "./audit.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 200;

function text(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value.length > MAX_TEXT) throw new BadRequestException(`Paramètre trop long : ${name}.`);
  return value;
}

function date(value: string | undefined, name: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`Date invalide : ${name}.`);
  return parsed;
}

function integer(value: string | undefined, name: string, { min, max }: { min: number; max: number }): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException(`Paramètre invalide : ${name}.`);
  return parsed;
}

@Controller("audit")
export class AuditController {
  constructor(
    @Inject(AuditQueryService) private readonly audit: AuditQueryService,
    @Inject(AuditService) private readonly recorder: AuditService,
  ) {}

  /** Mêmes paramètres de filtre pour la liste et l'export. */
  private filtersOf(query: Record<string, string | undefined>): AuditFilters {
    const { action, objectType, objectId, actorId, from, to } = query;
    if (actorId && !UUID.test(actorId)) throw new BadRequestException("Paramètre invalide : actorId.");
    return {
      ...(text(action, "action") && { action: text(action, "action")! }),
      ...(text(objectType, "objectType") && { objectType: text(objectType, "objectType")! }),
      ...(text(objectId, "objectId") && { objectId: text(objectId, "objectId")! }),
      ...(actorId && { actorId }),
      ...(date(from, "from") && { from: date(from, "from")! }),
      ...(date(to, "to") && { to: date(to, "to")! }),
    };
  }

  /**
   * Export CSV sûr du journal (ADR 0021), dans l'ordre chronologique et avec les empreintes de la chaîne, pour un contrôle ou un
   * archivage hors application. L'export est lui-même tracé (après coup : il ne se contient pas). Le journal n'est pas un
   * archivage probant : le fichier le rappelle.
   */
  @RequirePermission("audit:view")
  @Get("csv")
  async csv(
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const filters = this.filtersOf(query);
    let rows;
    try {
      rows = await this.audit.exportRows(filters);
    } catch (error) {
      if (error instanceof AuditExportTooLargeError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
    const generatedAt = new Date();
    await this.recorder.record({
      action: "report.exported",
      objectType: "Report",
      actorId: request.auth!.user.id,
      details: { kind: "audit", events: rows.length, query: Object.fromEntries(Object.entries(query).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string> },
    });
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${safeFilename(`journal d'audit ${generatedAt.toISOString().slice(0, 10)}`)}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    return toCsv(auditCsv(rows, filters, generatedAt));
  }

  @RequirePermission("audit:view")
  @Get()
  list(
    @Query("action") action?: string,
    @Query("objectType") objectType?: string,
    @Query("objectId") objectId?: string,
    @Query("actorId") actorId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ): Promise<AuditPage> {
    const filters = this.filtersOf({ action, objectType, objectId, actorId, from, to });
    const cursor = integer(before, "before", { min: 1, max: Number.MAX_SAFE_INTEGER });
    const size = integer(limit, "limit", { min: 1, max: 200 });
    return this.audit.list(filters, { ...(cursor !== undefined && { before: cursor }), ...(size !== undefined && { limit: size }) });
  }

  @RequirePermission("audit:view")
  @Get("facets")
  facets(): Promise<{ actions: string[]; objectTypes: string[] }> {
    return this.audit.facets();
  }

  /** Recalcule la chaîne d'empreintes et signale la première altération détectée. */
  @RequirePermission("audit:view")
  @Get("verify")
  verify(): Promise<IntegrityReport> {
    return this.audit.verify();
  }
}
