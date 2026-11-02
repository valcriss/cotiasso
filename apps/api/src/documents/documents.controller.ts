import "@fastify/multipart";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { RequirePermission, RequireProjectAccess } from "../authz/decorators.js";
import { DOCUMENT_CATEGORIES, LINKABLE_OBJECT_TYPES } from "./categories.js";
import { DocumentStorage } from "./document-storage.js";
import {
  DocumentArchivedError,
  DocumentNotFoundError,
  FileTooLargeError,
  InvalidDocumentError,
  InvalidFileError,
  RestrictedAccessError,
  ScopeAccessError,
} from "./errors.js";
import { ALLOWED_EXTENSIONS } from "./file-types.js";
import {
  DocumentsService,
  type DocumentDetail,
  type DocumentSummary,
  type DuplicateInfo,
  type IncomingFile,
  type Viewer,
} from "./documents.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new NotFoundException();
  return value;
}

function bool(value: string | undefined): boolean {
  return value === "true";
}

/** En-tête de téléchargement : nom ASCII de repli et nom UTF-8 encodé (RFC 6266 et 5987), toujours en pièce jointe. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function translate(error: unknown): never {
  if (error instanceof DocumentNotFoundError) throw new NotFoundException(error.message);
  if (error instanceof FileTooLargeError) throw new PayloadTooLargeException(error.message);
  if (error instanceof InvalidFileError) throw new UnsupportedMediaTypeException(error.message);
  if (error instanceof InvalidDocumentError) throw new BadRequestException(error.message);
  if (error instanceof DocumentArchivedError) throw new ConflictException(error.message);
  if (error instanceof RestrictedAccessError) throw new ForbiddenException(error.message);
  if (error instanceof ScopeAccessError) throw new ForbiddenException(error.message);
  throw error;
}

@Controller("documents")
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(DocumentStorage) private readonly storage: DocumentStorage,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  /** Catégories et types d'objets liables, pour construire les formulaires. */
  @RequireProjectAccess("documents:view")
  @Get("options")
  options(): { categories: { key: string; label: string }[]; objectTypes: readonly string[]; allowedExtensions: string[] } {
    return {
      categories: Object.entries(DOCUMENT_CATEGORIES).map(([key, label]) => ({ key, label })),
      objectTypes: LINKABLE_OBJECT_TYPES,
      allowedExtensions: ALLOWED_EXTENSIONS,
    };
  }

  @RequireProjectAccess("documents:view")
  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query("q") q?: string,
    @Query("category") category?: string,
    @Query("objectType") objectType?: string,
    @Query("objectId") objectId?: string,
    @Query("includeArchived") includeArchived?: string,
    @Query("page") page?: string,
  ): Promise<{ items: DocumentSummary[]; total: number; pageSize: number }> {
    const pageNumber = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new BadRequestException("Paramètre invalide : page.");
    if ([q, category, objectType, objectId].some((v) => v !== undefined && v.length > 200)) {
      throw new BadRequestException("Paramètre trop long.");
    }
    return this.documents.list(
      {
        ...(q && { q }),
        ...(category && { category }),
        ...(objectType && { objectType }),
        ...(objectId && { objectId }),
        includeArchived: bool(includeArchived),
      },
      await this.viewer(request),
      pageNumber,
    );
  }

  @RequireProjectAccess("documents:view")
  @Get(":id")
  async get(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<DocumentDetail> {
    try {
      return await this.documents.get(uuid(id), await this.viewer(request));
    } catch (error) {
      return translate(error);
    }
  }

  /** Téléchargement toujours en pièce jointe, avec le type détecté à l'envoi et sans interprétation par le navigateur. */
  @RequireProjectAccess("documents:view")
  @Get(":id/download")
  async download(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query("version") version?: string,
  ): Promise<StreamableFile> {
    const number = version === undefined ? undefined : Number(version);
    if (number !== undefined && (!Number.isInteger(number) || number < 1)) throw new BadRequestException("Paramètre invalide : version.");
    try {
      const file = await this.documents.download(uuid(id), number, await this.viewer(request));
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
      reply.header("Cache-Control", "private, no-store");
      return new StreamableFile(file.stream, { type: file.mimeType, length: file.size, disposition: contentDisposition(file.filename) });
    } catch (error) {
      return translate(error);
    }
  }

  @RequireProjectAccess("documents:create")
  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ document: DocumentDetail; duplicates: DuplicateInfo[] }> {
    const { fields, file } = await this.readUpload(request);
    if (!file) throw new BadRequestException("Aucun fichier reçu.");
    try {
      return await this.documents.create(
        {
          title: fields.title ?? "",
          category: fields.category ?? "",
          restricted: bool(fields.restricted),
          ...(fields.comment && { comment: fields.comment }),
          links: this.parseLinks(fields.links),
        },
        file,
        await this.viewer(request),
      );
    } catch (error) {
      // Le fichier est déjà sur disque : tout échec avant ou pendant la création doit le retirer (opération idempotente).
      await this.storage.remove(file.storageKey);
      return translate(error);
    }
  }

  @RequireProjectAccess("documents:create")
  @Post(":id/versions")
  async addVersion(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ document: DocumentDetail; duplicates: DuplicateInfo[] }> {
    const { fields, file } = await this.readUpload(request);
    if (!file) throw new BadRequestException("Aucun fichier reçu.");
    try {
      return await this.documents.addVersion(uuid(id), file, fields.comment, await this.viewer(request));
    } catch (error) {
      await this.storage.remove(file.storageKey);
      return translate(error);
    }
  }

  @RequireProjectAccess("documents:create")
  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentDetail> {
    if (typeof body !== "object" || body === null) throw new BadRequestException("Corps de requête invalide.");
    const { title, category, restricted } = body as Record<string, unknown>;
    if (
      (title !== undefined && typeof title !== "string") ||
      (category !== undefined && typeof category !== "string") ||
      (restricted !== undefined && typeof restricted !== "boolean")
    ) {
      throw new BadRequestException("Champ invalide.");
    }
    try {
      return await this.documents.update(
        uuid(id),
        {
          ...(title !== undefined && { title: title as string }),
          ...(category !== undefined && { category: category as string }),
          ...(restricted !== undefined && { restricted: restricted as boolean }),
        },
        await this.viewer(request),
      );
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("documents:create")
  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  async archive(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<DocumentDetail> {
    try {
      return await this.documents.setArchived(uuid(id), true, await this.viewer(request));
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("documents:create")
  @Post(":id/unarchive")
  @HttpCode(HttpStatus.OK)
  async unarchive(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<DocumentDetail> {
    try {
      return await this.documents.setArchived(uuid(id), false, await this.viewer(request));
    } catch (error) {
      return translate(error);
    }
  }

  @RequireProjectAccess("documents:create")
  @Post(":id/links")
  @HttpCode(HttpStatus.OK)
  async addLink(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<DocumentDetail> {
    const { objectType, objectId } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    if (typeof objectType !== "string" || typeof objectId !== "string") throw new BadRequestException("Lien invalide.");
    try {
      return await this.documents.addLink(uuid(id), { objectType, objectId }, await this.viewer(request));
    } catch (error) {
      return translate(error);
    }
  }

  @RequirePermission("documents:create")
  @Delete(":id/links/:linkId")
  async removeLink(
    @Param("id") id: string,
    @Param("linkId") linkId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<DocumentDetail> {
    try {
      return await this.documents.removeLink(uuid(id), uuid(linkId), await this.viewer(request));
    } catch (error) {
      return translate(error);
    }
  }

  private async viewer(request: AuthenticatedRequest): Promise<Viewer> {
    const userId = request.auth!.user.id;
    const permissions = await this.authorization.permissionsFor(userId);
    // Droit global : aucun filtre. Sinon la route a posé la portée (ADR 0022) : le service ne montre que les documents de ces projets.
    const access = request.projectAccess;
    return {
      userId,
      canSeeRestricted: permissions.has("documents.restricted:view"),
      ...(access && !access.all && { scope: access.ids }),
    };
  }

  private parseLinks(raw: string | undefined): { objectType: string; objectId: string }[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !Array.isArray(parsed) ||
        parsed.some((l) => typeof l?.objectType !== "string" || typeof l?.objectId !== "string")
      ) {
        throw new Error();
      }
      return parsed as { objectType: string; objectId: string }[];
    } catch {
      throw new BadRequestException("Liens invalides.");
    }
  }

  /**
   * Lit un envoi multipart : champs de texte et un seul fichier, écrit en flux sur disque (jamais en mémoire).
   * Le fichier est retiré si la lecture échoue ; sinon c'est le service qui le retire en cas de refus.
   */
  private async readUpload(request: FastifyRequest): Promise<{ fields: Record<string, string>; file: IncomingFile | null }> {
    if (!request.isMultipart()) throw new UnsupportedMediaTypeException("Envoi multipart/form-data attendu.");

    const fields: Record<string, string> = {};
    let file: IncomingFile | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (file) {
            part.file.resume();
            throw new BadRequestException("Un seul fichier par envoi.");
          }
          const stored = await this.storage.save(part.file);
          file = { ...stored, originalName: part.filename };
        } else if (typeof part.value === "string") {
          fields[part.fieldname] = part.value;
        }
      }
    } catch (error) {
      if (file) await this.storage.remove(file.storageKey);
      if (error instanceof FileTooLargeError) throw new PayloadTooLargeException(error.message);
      const code = (error as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeException("Le fichier dépasse la taille maximale autorisée.");
      }
      // Limites du plugin multipart (nombre de fichiers, de champs ou de parties) : un envoi mal formé, pas une surcharge.
      if (code === "FST_FILES_LIMIT" || code === "FST_FIELDS_LIMIT" || code === "FST_PARTS_LIMIT") {
        throw new BadRequestException("Envoi invalide : un seul fichier et quelques champs de texte sont autorisés.");
      }
      throw error;
    }
    return { fields, file };
  }
}
