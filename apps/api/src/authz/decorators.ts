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

/** Route ouverte à tout utilisateur connecté, sans permission particulière (ex. son propre profil). */
export const Authenticated = (): MethodDecorator & ClassDecorator => SetMetadata(AUTHENTICATED_ONLY, true);
