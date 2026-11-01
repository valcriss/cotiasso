import { Controller, Get, Inject } from "@nestjs/common";
import { RequirePermission } from "../authz/decorators.js";
import { BackupsService, type OperationsReport } from "./backups.service.js";

@Controller("operations")
export class OperationsController {
  constructor(@Inject(BackupsService) private readonly backups: BackupsService) {}

  /** Version déployée et état des sauvegardes : réservé à l'administration de l'exploitation. */
  @RequirePermission("backups:admin")
  @Get()
  report(): Promise<OperationsReport> {
    return this.backups.report();
  }
}
