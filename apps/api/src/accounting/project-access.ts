import type { ProjectAccess } from "../auth/auth.guard.js";
import { AccountingNotFoundError } from "./errors.js";

/** Un projet hors de la portée de l'utilisateur est introuvable : on ne révèle pas son existence (ADR 0022). */
export function assertProjectAccess(projectId: string, access?: ProjectAccess): void {
  if (access && !access.all && !access.ids.has(projectId)) throw new AccountingNotFoundError("Projet");
}
