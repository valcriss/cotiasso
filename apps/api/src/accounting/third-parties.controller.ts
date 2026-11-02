import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import { ThirdPartiesService, type ThirdPartyBalances, type ThirdPartyView } from "./third-parties.service.js";

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

/** Tiers (ADR 0030) : lecture `entries:view`, création `entries:create` (on en crée en saisissant), archivage et corrections `settings.accounting:admin`. */
@Controller()
export class ThirdPartiesController {
  constructor(@Inject(ThirdPartiesService) private readonly thirdParties: ThirdPartiesService) {}

  @RequirePermission("entries:view")
  @Get("third-parties")
  list(@Query("includeArchived") includeArchived?: string): Promise<ThirdPartyView[]> {
    return this.thirdParties.list(includeArchived === "true");
  }

  @RequirePermission("entries:create")
  @Post("third-parties")
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ThirdPartyView> {
    return translate(() => this.thirdParties.create(body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @Patch("third-parties/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ThirdPartyView> {
    return translate(() => this.thirdParties.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("settings.accounting:admin")
  @HttpCode(HttpStatus.OK)
  @Post("third-parties/:id/archive")
  archive(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ThirdPartyView> {
    return translate(() => this.thirdParties.archive(id, request.auth!.user.id));
  }

  /** Ce qu'on vous doit et ce que vous devez, par personne, sur un exercice (lecture seule, tirée des écritures). */
  @RequirePermission("entries:view")
  @Get("reports/third-parties")
  balances(@Query() query: unknown): Promise<ThirdPartyBalances> {
    return translate(() => this.thirdParties.balances(query));
  }
}
