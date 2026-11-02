import { SetMetadata } from "@nestjs/common";
import type { Permission } from "./permissions.js";

export const REQUIRED_PERMISSIONS = "requiredPermissions";
export const AUTHENTICATED_ONLY = "authenticatedOnly";

/**
 * Exige une session ET toutes les permissions listées. Chaque route doit déclarer explicitement
 * `@Public()`, `@Authenticated()` ou `@RequirePermission(...)` : sans déclaration, l'accès est refusé.
 */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const REQUIRED_PROJECT_ACCESS = "requiredProjectAccess";

/**
 * Route sur des projets (ADR 0022) : ouverte à qui a la permission globalement ou sur au moins un projet. Le garde pose
 * la portée sur la requête (`projectAccess`) et le service filtre : un projet hors portée est introuvable.
 */
export const RequireProjectAccess = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PROJECT_ACCESS, permission);

/** Route ouverte à tout utilisateur connecté, sans permission particulière (ex. son propre profil). */
export const Authenticated = (): MethodDecorator & ClassDecorator => SetMetadata(AUTHENTICATED_ONLY, true);
