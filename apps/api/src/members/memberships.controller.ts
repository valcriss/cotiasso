import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { amountCell, safeFilename, toCsv } from "../accounting/csv.js";
import { AuditService } from "../audit/audit.service.js";
import { MembershipsService, type CampaignView, type MembershipView } from "./memberships.service.js";
import { PaymentsService, type AllocationView, type PaymentCandidate, type Receipt, type ReminderItem } from "./payments.service.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) throw new BadRequestException({ message: error.message, issues: error.issues });
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof AccountingConflictError) throw new ConflictException(error.message);
    throw error;
  }
}

/** Campagnes, tarifs et adhésions : lecture `members:view`, gestion `members:manage` (ADR 0023). */
@Controller()
export class MembershipsController {
  constructor(
    @Inject(MembershipsService) private readonly memberships: MembershipsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermission("members:view")
  @Get("campaigns")
  campaigns(): Promise<CampaignView[]> {
    return this.memberships.listCampaigns();
  }

  @RequirePermission("members:view")
  @Get("campaigns/:id")
  campaign(@Param("id", ParseUUIDPipe) id: string): Promise<CampaignView> {
    return translate(() => this.memberships.getCampaign(id));
  }

  @RequirePermission("members:manage")
  @Post("campaigns")
  createCampaign(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CampaignView> {
    return translate(() => this.memberships.createCampaign(body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Patch("campaigns/:id")
  updateCampaign(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CampaignView> {
    return translate(() => this.memberships.updateCampaign(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Post("campaigns/:id/tariffs")
  addTariff(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CampaignView> {
    return translate(() => this.memberships.addTariff(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Patch("tariffs/:id")
  updateTariff(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CampaignView> {
    return translate(() => this.memberships.updateTariff(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Delete("tariffs/:id")
  removeTariff(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<CampaignView> {
    return translate(() => this.memberships.removeTariff(id, request.auth!.user.id));
  }

  @RequirePermission("members:view")
  @Get("campaigns/:id/memberships")
  memberships_(@Param("id", ParseUUIDPipe) id: string): Promise<MembershipView[]> {
    return translate(() => this.memberships.listMemberships(id));
  }

  @RequirePermission("members:view")
  @Get("members/:id/memberships")
  forMember(@Param("id", ParseUUIDPipe) id: string): Promise<MembershipView[]> {
    return this.memberships.listForMember(id);
  }

  @RequirePermission("members:manage")
  @Post("campaigns/:id/memberships")
  createMembership(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MembershipView> {
    return translate(() => this.memberships.createMembership(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Post("memberships/:id/validate")
  @HttpCode(HttpStatus.OK)
  validate(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<MembershipView> {
    return translate(() => this.memberships.validate(id, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Post("memberships/:id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MembershipView> {
    return translate(() => this.memberships.cancel(id, body, request.auth!.user.id));
  }

  // --- Règlements, rappels et reçus (tranches 3.3 et 3.4) ---

  @RequirePermission("members:manage")
  @Post("memberships/:id/allocations")
  allocate(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<{ allocation: AllocationView; membership: MembershipView }> {
    return translate(() => this.payments.allocate(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Post("allocations/:id/cancel")
  @HttpCode(HttpStatus.OK)
  cancelAllocation(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MembershipView> {
    return translate(() => this.payments.cancelAllocation(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:view")
  @Get("memberships/:id/allocations")
  allocations(@Param("id", ParseUUIDPipe) id: string): Promise<AllocationView[]> {
    return translate(() => this.payments.allocations(id));
  }

  @RequirePermission("members:manage")
  @Get("memberships/:id/payment-candidates")
  candidates(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown): Promise<PaymentCandidate[]> {
    return translate(() => this.payments.candidates(id, query));
  }

  @RequirePermission("members:view")
  @Get("campaigns/:id/reminders")
  reminders(@Param("id", ParseUUIDPipe) id: string): Promise<{ campaignName: string; items: ReminderItem[]; totalDue: string }> {
    return translate(() => this.payments.reminders(id));
  }

  /** Cotisations restant dues en CSV sûr (ADR 0021) : de quoi relancer par courrier ou par email depuis un tableur. */
  @RequirePermission("members:view")
  @Get("campaigns/:id/reminders/csv")
  async remindersCsv(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const { campaignName, items } = await translate(() => this.payments.reminders(id));
    await this.audit.record({ action: "report.exported", objectType: "Report", actorId: request.auth!.user.id, details: { kind: "reminders", campaignId: id } });
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${safeFilename(`cotisations dues ${campaignName}`)}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    return toCsv([
      ["Membre", "Email", "Téléphone", "Tarif", "Attendu", "Payé", "Reste dû"],
      ...items.map((i) => [i.membership.memberName, i.email ?? "", i.phone ?? "", i.membership.tariffLabel ?? "", amountCell(i.membership.expectedAmount), amountCell(i.membership.paid), amountCell(i.membership.balance)]),
    ]);
  }

  @RequirePermission("members:view")
  @Get("memberships/:id/receipt")
  receipt(@Param("id", ParseUUIDPipe) id: string): Promise<Receipt> {
    return translate(() => this.payments.receipt(id));
  }
}
