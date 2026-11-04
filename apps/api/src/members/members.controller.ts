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
} from "@nestjs/common";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { RequirePermission } from "../authz/decorators.js";
import { MembersService, type CategoryView, type MemberView, type OfficeRoleView, type OfficeView } from "./members.service.js";

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

/** Membres : consultation `members:view`, gestion `members:manage` (ADR 0023). */
@Controller()
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @RequirePermission("members:view")
  @Get("members")
  list(@Query() query: unknown): Promise<{ members: MemberView[]; next: string | null }> {
    return translate(() => this.members.list(query));
  }

  @RequirePermission("members:view")
  @Get("members/:id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<{ member: MemberView; offices: OfficeView[] }> {
    return translate(() => this.members.get(id));
  }

  @RequirePermission("members:manage")
  @Post("members")
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MemberView> {
    return translate(() => this.members.create(body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Patch("members/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MemberView> {
    return translate(() => this.members.update(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Post("members/:id/anonymize")
  @HttpCode(HttpStatus.OK)
  anonymize(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MemberView> {
    return translate(() => this.members.anonymize(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:view")
  @Get("member-categories")
  categories(): Promise<CategoryView[]> {
    return this.members.listCategories();
  }

  @RequirePermission("members:manage")
  @Post("member-categories")
  createCategory(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CategoryView> {
    return translate(() => this.members.createCategory(body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Patch("member-categories/:id")
  updateCategory(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CategoryView> {
    return translate(() => this.members.updateCategory(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:view")
  @Get("office-roles")
  officeRoles(): Promise<OfficeRoleView[]> {
    return this.members.listOfficeRoles();
  }

  @RequirePermission("members:manage")
  @Post("office-roles")
  createOfficeRole(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OfficeRoleView> {
    return translate(() => this.members.createOfficeRole(body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Patch("office-roles/:id")
  updateOfficeRole(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OfficeRoleView> {
    return translate(() => this.members.updateOfficeRole(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Post("members/:id/offices")
  addOffice(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OfficeView> {
    return translate(() => this.members.addOffice(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Patch("member-offices/:id")
  updateOffice(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OfficeView> {
    return translate(() => this.members.updateOffice(id, body, request.auth!.user.id));
  }

  @RequirePermission("members:manage")
  @Delete("member-offices/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOffice(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await translate(() => this.members.removeOffice(id, request.auth!.user.id));
  }
}
