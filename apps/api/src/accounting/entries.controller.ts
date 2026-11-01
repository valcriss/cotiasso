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
  Post,
  Put,
  Query,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";
import { EntriesService, EntryPostingRefusedError, type EntryView } from "./entries.service.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) {
      throw new BadRequestException({ message: error.message, issues: error.issues });
    }
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof AccountingConflictError) throw new ConflictException(error.message);
    if (error instanceof EntryPostingRefusedError) {
      throw new UnprocessableEntityException({ message: error.message, issues: error.errors });
    }
    throw error;
  }
}

/**
 * Écritures : lecture `entries:view`, brouillons `entries:create`, comptabilisation et contrepassation `entries:post`.
 * Une écriture comptabilisée ne se modifie ni ne se supprime (déclencheurs SQL) : on la contrepasse.
 */
@Controller("entries")
export class EntriesController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @RequirePermission("entries:view")
  @Get()
  list(@Query() query: unknown): Promise<{ entries: EntryView[]; next: string | null }> {
    return translate(() => this.entries.list(query));
  }

  @RequirePermission("entries:view")
  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<EntryView> {
    return translate(() => this.entries.get(id));
  }

  @RequirePermission("entries:create")
  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<EntryView> {
    return translate(() => this.entries.createDraft(body, request.auth!.user.id));
  }

  @RequirePermission("entries:create")
  @Put(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<EntryView> {
    return translate(() => this.entries.updateDraft(id, body, request.auth!.user.id));
  }

  @RequirePermission("entries:create")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await translate(() => this.entries.deleteDraft(id, request.auth!.user.id));
  }

  @RequirePermission("entries:post")
  @Post(":id/post")
  @HttpCode(HttpStatus.OK)
  post(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<EntryView> {
    return translate(() => this.entries.post(id, request.auth!.user.id));
  }

  @RequirePermission("entries:post")
  @Post(":id/reverse")
  reverse(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<EntryView> {
    return translate(() => this.entries.reverse(id, body ?? {}, request.auth!.user.id));
  }
}
