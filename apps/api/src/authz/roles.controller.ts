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
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuthorizationService } from "./authorization.service.js";
import { Authenticated, RequirePermission } from "./decorators.js";
import {
  AssignmentNotFoundError,
  DuplicateRoleError,
  InvalidRoleError,
  LastAdministratorError,
  RoleNotFoundError,
} from "./errors.js";
import { PERMISSIONS } from "./permissions.js";
import { RolesService, type RoleInput } from "./roles.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 500;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new NotFoundException();
  return value;
}

function text(value: unknown, field: string, { required }: { required: boolean }): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && value.trim() === "") || value.length > MAX_TEXT) {
    throw new BadRequestException(`Champ invalide : ${field}.`);
  }
  return value;
}

function readRole(body: unknown, { withKey }: { withKey: boolean }): RoleInput {
  if (typeof body !== "object" || body === null) throw new BadRequestException("Corps de requête invalide.");
  const record = body as Record<string, unknown>;
  const permissions = record.permissions;
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== "string")) {
    throw new BadRequestException("Champ invalide : permissions.");
  }
  if (record.requiresMfa !== undefined && typeof record.requiresMfa !== "boolean") {
    throw new BadRequestException("Champ invalide : requiresMfa.");
  }
  return {
    ...(withKey && { key: text(record.key, "key", { required: true }) }),
    ...(record.requiresMfa !== undefined && { requiresMfa: record.requiresMfa }),
    name: text(record.name, "name", { required: true }),
    description: text(record.description, "description", { required: false }),
    permissions: permissions as string[],
  };
}

function readDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`Date invalide : ${field}.`);
  return date;
}

/** Traduit les erreurs métier en réponses HTTP, sans exposer de détail interne. */
function translate(error: unknown): never {
  if (error instanceof RoleNotFoundError || error instanceof AssignmentNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof DuplicateRoleError || error instanceof LastAdministratorError) {
    throw new ConflictException(error.message);
  }
  if (error instanceof InvalidRoleError) throw new BadRequestException(error.message);
  throw error;
}

@Controller()
export class RolesController {
  constructor(
    @Inject(RolesService) private readonly roles: RolesService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  @Authenticated()
  @Get("authz/permissions")
  permissions(): { key: string; label: string }[] {
    return Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label }));
  }

  @RequirePermission("users:view")
  @Get("roles")
  listRoles() {
    return this.roles.listRoles();
  }

  @RequirePermission("users:admin")
  @Post("roles")
  async createRole(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    try {
      return await this.roles.createRole(readRole(body, { withKey: true }), request.auth!.user.id);
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("users:admin")
  @Put("roles/:id")
  async updateRole(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    try {
      return await this.roles.updateRole(uuid(id), readRole(body, { withKey: false }), request.auth!.user.id);
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("users:view")
  @Get("users")
  listUsers() {
    return this.roles.listUsers();
  }

  /** Écran « Accès effectifs » : les permissions d'un utilisateur et le rôle qui les accorde. */
  @RequirePermission("users:view")
  @Get("users/:id/access")
  async access(@Param("id") id: string) {
    return { permissions: await this.authorization.effectiveAccess(uuid(id)), projectPermissions: await this.authorization.scopedAccess(uuid(id)) };
  }

  @RequirePermission("users:admin")
  @Post("users/:id/assignments")
  async assign(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (typeof body !== "object" || body === null || typeof (body as { roleId?: unknown }).roleId !== "string") {
      throw new BadRequestException("Champ invalide : roleId.");
    }
    const record = body as { roleId: string; projectId?: unknown; startsAt?: unknown; endsAt?: unknown };
    if (record.projectId !== undefined && record.projectId !== null && typeof record.projectId !== "string") {
      throw new BadRequestException("Champ invalide : projectId.");
    }
    try {
      const endsAt = readDate(record.endsAt, "endsAt");
      const startsAt = readDate(record.startsAt, "startsAt");
      return await this.roles.assign(
        uuid(id),
        { roleId: uuid(record.roleId), ...(record.projectId ? { projectId: uuid(record.projectId) } : {}), ...(startsAt && { startsAt }), ...(endsAt && { endsAt }) },
        request.auth!.user.id,
      );
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("users:admin")
  @Delete("assignments/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    try {
      await this.roles.revoke(uuid(id), request.auth!.user.id);
    } catch (error) {
      translate(error);
    }
  }
}
