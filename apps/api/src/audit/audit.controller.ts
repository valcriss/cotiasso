import { BadRequestException, Controller, Get, Inject, Query } from "@nestjs/common";
import { RequirePermission } from "../authz/decorators.js";
import { AuditQueryService, type AuditFilters, type AuditPage, type IntegrityReport } from "./audit-query.service.js";

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
  constructor(@Inject(AuditQueryService) private readonly audit: AuditQueryService) {}

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
    if (actorId && !UUID.test(actorId)) throw new BadRequestException("Paramètre invalide : actorId.");
    const filters: AuditFilters = {
      ...(text(action, "action") && { action: text(action, "action")! }),
      ...(text(objectType, "objectType") && { objectType: text(objectType, "objectType")! }),
      ...(text(objectId, "objectId") && { objectId: text(objectId, "objectId")! }),
      ...(actorId && { actorId }),
      ...(date(from, "from") && { from: date(from, "from")! }),
      ...(date(to, "to") && { to: date(to, "to")! }),
    };
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
