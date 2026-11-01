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
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { ClosingService, type CarryPreview, type ClosingReport } from "./closing.service.js";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "./errors.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) {
      throw new BadRequestException({ message: error.message, issues: error.issues });
    }
    if (error instanceof AccountingNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof AccountingConflictError) throw new ConflictException(error.message);
    throw error;
  }
}

/** Clôture d'exercice : tout est sous `fiscal-years:close`, y compris la lecture des contrôles. */
@Controller("fiscal-years/:id/closing")
export class ClosingController {
  constructor(@Inject(ClosingService) private readonly closing: ClosingService) {}

  @RequirePermission("fiscal-years:close")
  @Get()
  report(@Param("id", ParseUUIDPipe) id: string): Promise<ClosingReport> {
    return translate(() => this.closing.report(id));
  }

  @RequirePermission("fiscal-years:close")
  @Post("start")
  @HttpCode(HttpStatus.OK)
  start(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ClosingReport> {
    return translate(() => this.closing.startClosing(id, request.auth!.user.id));
  }

  @RequirePermission("fiscal-years:close")
  @Post("cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ClosingReport> {
    return translate(() => this.closing.cancelClosing(id, request.auth!.user.id));
  }

  @RequirePermission("fiscal-years:close")
  @Post("close")
  @HttpCode(HttpStatus.OK)
  close(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ openingEntryId: string; result: CarryPreview["result"] }> {
    return translate(() => this.closing.close(id, body, request.auth!.user.id));
  }
}
