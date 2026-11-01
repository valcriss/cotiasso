import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { IS_PUBLIC } from "../auth/public.decorator.js";
import { AuthorizationService } from "./authorization.service.js";
import { AUTHENTICATED_ONLY, REQUIRED_PERMISSIONS } from "./decorators.js";
import type { Permission } from "./permissions.js";

/**
 * Deuxième garde globale, après `AuthGuard` : refus par défaut. Une route sans déclaration explicite est refusée
 * même pour un utilisateur connecté, afin qu'une nouvelle route ne soit jamais ouverte par oubli.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new ForbiddenException("Accès refusé.");

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (required) {
      const granted = await this.authorization.permissionsFor(request.auth.user.id);
      if (!required.every((permission) => granted.has(permission))) throw new ForbiddenException("Accès refusé.");
      return true;
    }

    if (this.reflector.getAllAndOverride<boolean | undefined>(AUTHENTICATED_ONLY, targets)) return true;

    throw new ForbiddenException("Accès refusé.");
  }
}
