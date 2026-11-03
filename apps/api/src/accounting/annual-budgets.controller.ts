import { BadRequestException, ConflictException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { PrismaService } from "../prisma/prisma.service.js";

const action = "annual-budget.estimate.changed";
const objectType = "AnnualBudget";
const estimateSchema = z.object({
  code: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  label: z.string().trim().min(1).max(500),
  amount: z.string().regex(/^\d{1,12}\.\d{2}$/),
});

@Controller("annual-budgets")
export class AnnualBudgetsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermission("entries:view")
  @Get(":yearId")
  async get(@Param("yearId", ParseUUIDPipe) yearId: string) {
    await this.requireYear(yearId);
    const events = await this.prisma.auditEvent.findMany({
      where: { action, objectType, objectId: yearId },
      orderBy: { seq: "asc" },
      select: { id: true, occurredAt: true, actorId: true, details: true },
    });
    const actorIds = [...new Set(events.flatMap((event) => event.actorId ? [event.actorId] : []))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    const estimates: Record<string, string> = Object.create(null);
    const history = events.flatMap((event) => {
      const parsed = estimateSchema.safeParse(event.details);
      if (!parsed.success) return [];
      const { code, label, amount } = parsed.data;
      const previous = estimates[code] ?? "0.00";
      estimates[code] = amount;
      if (previous === amount) return [];
      return [{ id: event.id, date: event.occurredAt, actor: names.get(event.actorId ?? "") ?? "Utilisateur inconnu", code, label, previous, amount }];
    });
    return { estimates, history: history.reverse() };
  }

  @RequirePermission("entries:view", "entries:create")
  @Put(":yearId/estimate")
  async save(@Param("yearId", ParseUUIDPipe) yearId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = estimateSchema.extend({ expected: estimateSchema.shape.amount }).safeParse(body);
    if (!parsed.success) throw new BadRequestException("Saisissez un montant positif avec deux décimales au plus.");
    await this.requireYear(yearId);
    const { expected, ...details } = parsed.data;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"annual-budget:" + yearId}))`;
      const latest = await tx.auditEvent.findFirst({
        where: { action, objectType, objectId: yearId, details: { path: ["code"], equals: details.code } },
        orderBy: { seq: "desc" },
        select: { details: true },
      });
      const previous = estimateSchema.safeParse(latest?.details);
      const current = previous.success ? previous.data.amount : "0.00";
      if (current === details.amount) return;
      if (current !== expected) throw new ConflictException("Ce montant a changé. Rechargez le budget avant de réessayer.");
      await this.audit.record({ action, objectType, objectId: yearId, actorId: request.auth!.user.id, details }, tx);
    });
    return this.get(yearId);
  }

  private async requireYear(id: string): Promise<void> {
    if (!(await this.prisma.fiscalYear.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException("Cet exercice est introuvable.");
    }
  }
}
