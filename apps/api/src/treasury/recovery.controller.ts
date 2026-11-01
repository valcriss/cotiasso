import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { RecoveryService, type BatchItemView, type BatchView, type PostReport, type PrepareReport } from "./recovery.service.js";

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

/**
 * Lots de reprise (ADR 0019) : consultation `entries:view` ; création, préparation et abandon `entries:create` et
 * `transactions:manage` ; comptabilisation du lot `entries:post`.
 */
@Controller("recovery-batches")
export class RecoveryController {
  constructor(@Inject(RecoveryService) private readonly recovery: RecoveryService) {}

  @RequirePermission("entries:view")
  @Get()
  list(): Promise<BatchView[]> {
    return this.recovery.list();
  }

  @RequirePermission("entries:view")
  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<{ batch: BatchView; items: BatchItemView[] }> {
    return translate(() => this.recovery.get(id));
  }

  @RequirePermission("entries:create", "transactions:manage")
  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<BatchView> {
    return translate(() => this.recovery.create(body, request.auth!.user.id));
  }

  @RequirePermission("entries:create", "transactions:manage")
  @Post(":id/prepare-entries")
  @HttpCode(HttpStatus.OK)
  prepareEntries(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<PrepareReport> {
    return translate(() => this.recovery.prepareEntries(id, body, request.auth!.user.id));
  }

  @RequirePermission("entries:create", "transactions:manage")
  @Post(":id/opening")
  prepareOpening(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<BatchItemView> {
    return translate(() => this.recovery.prepareOpening(id, body, request.auth!.user.id));
  }

  @RequirePermission("entries:post")
  @Post(":id/post")
  @HttpCode(HttpStatus.OK)
  post(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<PostReport> {
    return translate(() => this.recovery.post(id, request.auth!.user.id));
  }

  @RequirePermission("entries:create", "transactions:manage")
  @Post(":id/abandon")
  @HttpCode(HttpStatus.OK)
  abandon(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<{ deleted: number; kept: number }> {
    return translate(() => this.recovery.abandon(id, request.auth!.user.id));
  }
}
