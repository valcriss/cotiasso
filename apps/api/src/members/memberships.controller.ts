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
  Req,
} from "@nestjs/common";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { MembershipsService, type CampaignView, type MembershipView } from "./memberships.service.js";

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
  constructor(@Inject(MembershipsService) private readonly memberships: MembershipsService) {}

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
}
