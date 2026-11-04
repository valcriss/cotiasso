import "@fastify/multipart";
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
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AccountingConflictError, AccountingNotFoundError, AccountingValidationError } from "../accounting/errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { Authenticated, RequirePermission } from "../authz/decorators.js";
import { contentDisposition, translate as translateDocumentError } from "../documents/documents.controller.js";
import { DocumentStorage } from "../documents/document-storage.js";
import type { DocumentDetail, DocumentSummary } from "../documents/documents.service.js";
import { DocumentNotFoundError } from "../documents/errors.js";
import { readUpload } from "../documents/upload.js";
import { ReimbursementsService, type Actor, type ListedReimbursement, type ReimbursementView } from "./reimbursements.service.js";

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AccountingValidationError) throw new BadRequestException({ message: error.message, issues: error.issues });
    if (error instanceof AccountingNotFoundError || error instanceof DocumentNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof AccountingConflictError) throw new ConflictException(error.message);
    return translateDocumentError(error);
  }
}

/**
 * Demandes de remboursement (ADR 0035). Déposer et suivre ses demandes : `reimbursements:create`. Voir toutes les demandes :
 * `reimbursements:view`. Décider d'une étape ne passe pas par un droit : c'est être désigné par le circuit, vérifié par le
 * service (une demande qu'on n'a pas le droit de voir est introuvable). Rembourser exige les droits de saisie comptable.
 */
@Controller()
export class ReimbursementsController {
  constructor(
    @Inject(ReimbursementsService) private readonly service: ReimbursementsService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(DocumentStorage) private readonly storage: DocumentStorage,
  ) {}

  @Authenticated()
  @Get("reimbursements/status")
  status(@Req() request: AuthenticatedRequest) {
    return this.service.status(request.auth!.user.id);
  }

  @RequirePermission("reimbursements:create")
  @Get("reimbursements/projects")
  projects() {
    return this.service.projects();
  }

  @RequirePermission("reimbursements:create")
  @Get("reimbursements/mine")
  mine(@Req() request: AuthenticatedRequest): Promise<ListedReimbursement[]> {
    return this.service.mine(request.auth!.user.id);
  }

  @RequirePermission("reimbursements:view")
  @Get("reimbursements")
  all(@Query("status") status?: string): Promise<ListedReimbursement[]> {
    return this.service.all(status ? { status } : {});
  }

  @Authenticated()
  @Get("reimbursements/to-decide")
  toDecide(@Req() request: AuthenticatedRequest) {
    return this.service.toDecide(request.auth!.user.id);
  }

  @Authenticated()
  @Get("reimbursements/:id")
  async get(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ReimbursementView> {
    const actor = await this.actor(request);
    return translate(() => this.service.get(id, actor));
  }

  @RequirePermission("reimbursements:create")
  @Post("reimbursements")
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ReimbursementView> {
    const actor = await this.actor(request);
    return translate(() => this.service.create(body, actor));
  }

  @RequirePermission("reimbursements:create")
  @Patch("reimbursements/:id")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ReimbursementView> {
    const actor = await this.actor(request);
    return translate(() => this.service.update(id, body, actor));
  }

  @RequirePermission("reimbursements:create")
  @Delete("reimbursements/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<void> {
    const actor = await this.actor(request);
    await translate(() => this.service.remove(id, actor));
  }

  @RequirePermission("reimbursements:create")
  @Post("reimbursements/:id/submit")
  @HttpCode(HttpStatus.OK)
  async submit(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<ReimbursementView> {
    const actor = await this.actor(request);
    return translate(() => this.service.submit(id, actor));
  }

  @RequirePermission("reimbursements:create")
  @Post("reimbursements/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ReimbursementView> {
    const actor = await this.actor(request);
    return translate(() => this.service.cancel(id, body, actor));
  }

  @Authenticated()
  @Post("reimbursements/:id/decision")
  @HttpCode(HttpStatus.OK)
  async decide(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ReimbursementView> {
    const actor = await this.actor(request);
    return translate(() => this.service.decide(id, body, actor));
  }

  @RequirePermission("transactions:manage", "entries:create")
  @Post("reimbursements/:id/process")
  @HttpCode(HttpStatus.OK)
  async process(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ReimbursementView> {
    const actor = await this.actor(request);
    return translate(() => this.service.process(id, body, actor));
  }

  @RequirePermission("transactions:manage", "financial-accounts:view")
  @Get("reimbursements/:id/transaction-candidates")
  candidates(@Param("id", ParseUUIDPipe) id: string) {
    return translate(() => this.service.candidates(id));
  }

  // --- justificatifs ---

  @RequirePermission("reimbursements:create")
  @Post("reimbursements/:id/documents")
  async addReceipt(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<DocumentDetail> {
    const { fields, file } = await readUpload(this.storage, request as unknown as FastifyRequest);
    if (!file) throw new BadRequestException("Aucun fichier reçu.");
    const actor = await this.actor(request);
    try {
      return await this.service.addReceipt(id, file, fields.title, actor);
    } catch (error) {
      // Le fichier est déjà sur disque : tout refus avant la création doit le retirer (opération idempotente).
      await this.storage.remove(file.storageKey);
      return translate(async () => {
        throw error;
      });
    }
  }

  @Authenticated()
  @Get("reimbursements/:id/documents")
  async receipts(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest): Promise<DocumentSummary[]> {
    const actor = await this.actor(request);
    return translate(() => this.service.receipts(id, actor));
  }

  /** Téléchargement toujours en pièce jointe, sans interprétation par le navigateur ; le document est confidentiel donc audité. */
  @Authenticated()
  @Get("reimbursements/:id/documents/:documentId/download")
  async download(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const actor = await this.actor(request);
    const file = await translate(() => this.service.downloadReceipt(id, documentId, actor));
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
    reply.header("Cache-Control", "private, no-store");
    return new StreamableFile(file.stream, { type: file.mimeType, length: file.size, disposition: contentDisposition(file.filename) });
  }

  @RequirePermission("reimbursements:create")
  @Delete("reimbursements/:id/documents/:documentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveReceipt(@Param("id", ParseUUIDPipe) id: string, @Param("documentId", ParseUUIDPipe) documentId: string, @Req() request: AuthenticatedRequest): Promise<void> {
    const actor = await this.actor(request);
    await translate(() => this.service.archiveReceipt(id, documentId, actor));
  }

  private async actor(request: AuthenticatedRequest): Promise<Actor> {
    const userId = request.auth!.user.id;
    const permissions = await this.authorization.permissionsFor(userId);
    return { userId, canViewAll: permissions.has("reimbursements:view"), canPost: permissions.has("entries:post") };
  }
}
