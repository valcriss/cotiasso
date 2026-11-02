import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { IS_PUBLIC } from "../auth/public.decorator.js";
import { AuthorizationService } from "./authorization.service.js";
import { AUTHENTICATED_ONLY, REQUIRED_PERMISSIONS, REQUIRED_PROJECT_ACCESS } from "./decorators.js";
import { ALLOW_PARTIAL_SESSION } from "./partial-session.js";
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

    // Second facteur à vérifier ou à activer : seules les routes marquées @AllowPartialSession() sont ouvertes.
    if (request.auth.mfa.state !== "OK" && !this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_PARTIAL_SESSION, targets)) {
      throw new ForbiddenException({ message: "Authentification à deux facteurs requise.", code: "MFA_REQUIRED", mfa: request.auth.mfa.state });
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (required) {
      const granted = await this.authorization.permissionsFor(request.auth.user.id);
      if (!required.every((permission) => granted.has(permission))) throw new ForbiddenException("Accès refusé.");
      return true;
    }

    const projectPermission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PROJECT_ACCESS, targets);
    if (projectPermission) {
      const granted = await this.authorization.permissionsFor(request.auth.user.id);
      if (granted.has(projectPermission)) {
        request.projectAccess = { all: true, ids: new Set() };
        return true;
      }
      const ids = (await this.authorization.projectAccessFor(request.auth.user.id))[projectPermission] ?? [];
      if (ids.length === 0) throw new ForbiddenException("Accès refusé.");
      request.projectAccess = { all: false, ids: new Set(ids) };
      return true;
    }

    if (this.reflector.getAllAndOverride<boolean | undefined>(AUTHENTICATED_ONLY, targets)) return true;

    throw new ForbiddenException("Accès refusé.");
  }
}
