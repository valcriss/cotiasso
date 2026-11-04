import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { RequirePermission } from "../authz/decorators.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { AccountMailService, InvalidTestRecipientError, type TestMailOutcome } from "../mail/account-mail.service.js";
import { BackupsService, type OperationsReport, type ReleaseNotesReport } from "./backups.service.js";
import { UpdateCheckService } from "./update-check.service.js";
import type { UpdateCheckReport } from "./update-check.js";

@Controller("operations")
export class OperationsController {
  constructor(
    @Inject(BackupsService) private readonly backups: BackupsService,
    @Inject(AccountMailService) private readonly mails: AccountMailService,
    @Inject(UpdateCheckService) private readonly updates: UpdateCheckService,
  ) {}

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

  /** Une version plus récente est-elle publiée ? Lecture des étiquettes du dépôt, gardée en mémoire ; jamais une erreur HTTP. */
  @RequirePermission("backups:admin")
  @Get("update-check")
  updateCheck(): Promise<UpdateCheckReport> {
    return this.updates.check();
  }

  /**
   * Essai d'envoi d'email, adressé à la personne connectée ou, si `to` est donné, à cette seule adresse (outil de test de
   * délivrabilité par exemple). Le résultat dit si l'envoi a réussi ; seule une adresse invalide donne une erreur 400.
   */
  @RequirePermission("backups:admin")
  @Post("test-email")
  @HttpCode(200)
  async testEmail(@Req() request: AuthenticatedRequest, @Body() body: { to?: unknown } | undefined): Promise<TestMailOutcome> {
    const to = typeof body?.to === "string" ? body.to : undefined;
    try {
      return await this.mails.sendTest(request.auth!.user.id, to);
    } catch (error) {
      if (error instanceof InvalidTestRecipientError) {
        throw new BadRequestException("L’adresse saisie n’est pas valide. Vérifiez qu’elle ressemble à nom@exemple.fr, puis réessayez.");
      }
      throw error;
    }
  }
}
