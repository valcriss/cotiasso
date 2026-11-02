import { Controller, Get, Inject } from "@nestjs/common";
import { RequirePermission } from "../authz/decorators.js";
import { BackupsService, type OperationsReport, type ReleaseNotesReport } from "./backups.service.js";

@Controller("operations")
export class OperationsController {
  constructor(@Inject(BackupsService) private readonly backups: BackupsService) {}

  /** Version déployée et état des sauvegardes : réservé à l'administration de l'exploitation. */
  @RequirePermission("backups:admin")
  @Get()
  report(): Promise<OperationsReport> {
    return this.backups.report();
  }

  /** Notes de version (CHANGELOG.md), pour savoir ce qui change et quoi vérifier avant une mise à jour. */
  @RequirePermission("backups:admin")
  @Get("release-notes")
  releaseNotes(): Promise<ReleaseNotesReport> {
    return this.backups.releaseNotes();
  }
}
