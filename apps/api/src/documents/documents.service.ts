import type { ReadStream } from "node:fs";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { isDocumentCategory, isLinkableObjectType } from "./categories.js";
import { DocumentStorage, type StoredFile } from "./document-storage.js";
import { DocumentArchivedError, DocumentNotFoundError, InvalidDocumentError, InvalidFileError, RestrictedAccessError, ScopeAccessError } from "./errors.js";
import { detectFileType, sanitizeFilename } from "./file-types.js";

export interface IncomingFile extends StoredFile {
  /** Nom fourni par le client : informatif, nettoyé avant d'être conservé. */
  originalName: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  restricted: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  versionCount: number;
  linkCount: number;
  latest: { number: number; originalName: string; mimeType: string; size: number; uploadedAt: Date };
}

export interface DocumentDetail extends DocumentSummary {
  versions: { number: number; originalName: string; mimeType: string; size: number; sha256: string; comment: string | null; uploadedAt: Date; uploadedBy: string | null }[];
  links: { id: string; objectType: string; objectId: string; createdAt: Date }[];
}

export interface DocumentFilters {
  q?: string;
  category?: string;
  objectType?: string;
  objectId?: string;
  includeArchived?: boolean;
}

export interface Viewer {
  userId: string;
  /** Détient documents.restricted:view : peut voir et télécharger les documents restreints. */
  canSeeRestricted: boolean;
  /**
   * Projets auxquels l'accès est limité (ADR 0024, tranche 4.5) ; absent = droit global, aucun filtre. Une personne limitée à des
   * projets ne voit que les documents liés à l'un d'eux (ou à une subvention qui en finance un), jamais ceux liés à un membre.
   */
  scope?: ReadonlySet<string>;
}

/** Filtres de visibilité d'un lecteur : documents visibles, et liens qu'il a le droit de voir. */
interface Access {
  where: Prisma.DocumentWhereInput;
  linkWhere?: Prisma.DocumentLinkWhereInput;
  /** Subventions de la portée (ids), pour valider les liens d'un dépôt. */
  grantIds: ReadonlySet<string>;
}

export interface DuplicateInfo {
  documentId: string;
  title: string;
}

const MAX_TITLE = 200;
const MAX_COMMENT = 500;
const MAX_OBJECT_ID = 100;
const PAGE_SIZE = 50;

type Tx = Prisma.TransactionClient;

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DocumentStorage) private readonly storage: DocumentStorage,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Crée un document et sa première version. Le fichier est déjà sur disque : il est retiré si quoi que ce soit échoue. */
  async create(
    input: { title: string; category: string; restricted: boolean; comment?: string; links?: { objectType: string; objectId: string }[] },
    file: IncomingFile,
    viewer: Viewer,
  ): Promise<{ document: DocumentDetail; duplicates: DuplicateInfo[] }> {
    try {
      const title = this.title(input.title);
      this.category(input.category);
      if (input.restricted && !viewer.canSeeRestricted) throw new RestrictedAccessError();
      if (input.restricted && viewer.scope) throw new ScopeAccessError("Rendre un document restreint est réservé aux droits globaux.");
      const links = (input.links ?? []).map((link) => this.link(link));
      if (viewer.scope) await this.assertScopedLinks(links, viewer, true);
      const version = this.version(file);

      const created = await this.prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: { title, category: input.category, restricted: input.restricted, createdBy: viewer.userId },
        });
        await tx.documentVersion.create({ data: { ...version, documentId: document.id, number: 1, comment: this.comment(input.comment), uploadedBy: viewer.userId } });
        for (const link of links) await tx.documentLink.create({ data: { ...link, documentId: document.id, createdBy: viewer.userId } });
        return document;
      });

      await this.audit.record({
        action: "document.created",
        objectType: "Document",
        objectId: created.id,
        actorId: viewer.userId,
        details: { category: input.category, restricted: input.restricted, sha256: version.sha256 },
      });
      return { document: await this.get(created.id, viewer), duplicates: await this.duplicates(version.sha256, created.id, viewer) };
    } catch (error) {
      await this.storage.remove(file.storageKey);
      throw error;
    }
  }

  /** Ajoute une version : l'ancienne est conservée, ses liens et son historique aussi. */
  async addVersion(
    documentId: string,
    file: IncomingFile,
    comment: string | undefined,
    viewer: Viewer,
  ): Promise<{ document: DocumentDetail; duplicates: DuplicateInfo[] }> {
    try {
      const version = this.version(file);
      const number = await this.prisma.$transaction(async (tx) => {
        // Verrouille le document pour que deux dépôts simultanés reçoivent deux numéros distincts.
        await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${documentId}::uuid FOR UPDATE`;
        const document = await this.visible(tx, documentId, viewer);
        if (document.archivedAt) throw new DocumentArchivedError();

        const last = await tx.documentVersion.aggregate({ where: { documentId }, _max: { number: true } });
        const next = (last._max.number ?? 0) + 1;
        await tx.documentVersion.create({ data: { ...version, documentId, number: next, comment: this.comment(comment), uploadedBy: viewer.userId } });
        await tx.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });
        return next;
      });

      await this.audit.record({
        action: "document.version-added",
        objectType: "Document",
        objectId: documentId,
        actorId: viewer.userId,
        details: { number, sha256: version.sha256 },
      });
      return { document: await this.get(documentId, viewer), duplicates: await this.duplicates(version.sha256, documentId, viewer) };
    } catch (error) {
      await this.storage.remove(file.storageKey);
      throw error;
    }
  }

  async list(filters: DocumentFilters, viewer: Viewer, page = 1): Promise<{ items: DocumentSummary[]; total: number; pageSize: number }> {
    const access = await this.access(viewer);
    const where = this.where(filters, viewer, access);
    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: this.summaryInclude(access),
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (Math.max(page, 1) - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.document.count({ where }),
    ]);
    return { items: rows.map((row) => this.summary(row)), total, pageSize: PAGE_SIZE };
  }

  async get(documentId: string, viewer: Viewer): Promise<DocumentDetail> {
    const access = await this.access(viewer);
    const row = await this.prisma.document.findFirst({
      where: { AND: [{ id: documentId }, access.where, ...(viewer.canSeeRestricted ? [] : [{ restricted: false }])] },
      include: {
        ...this.summaryInclude(access),
        versions: { orderBy: { number: "desc" } },
        // Une personne limitée à des projets ne voit que les liens de sa portée, pas ceux vers d'autres projets ou objets.
        links: { ...(access.linkWhere && { where: access.linkWhere }), orderBy: { createdAt: "asc" } },
      },
    });
    if (!row) throw new DocumentNotFoundError();

    return {
      ...this.summary({ ...row, versions: row.versions.slice(0, 1) }),
      versions: row.versions.map((v) => ({
        number: v.number,
        originalName: v.originalName,
        mimeType: v.mimeType,
        size: v.size,
        sha256: v.sha256,
        comment: v.comment,
        uploadedAt: v.uploadedAt,
        uploadedBy: v.uploadedBy,
      })),
      links: row.links.map((l) => ({ id: l.id, objectType: l.objectType, objectId: l.objectId, createdAt: l.createdAt })),
    };
  }

  /** Prépare un téléchargement. Les téléchargements de documents restreints sont audités. */
  async download(
    documentId: string,
    versionNumber: number | undefined,
    viewer: Viewer,
  ): Promise<{ stream: ReadStream; filename: string; mimeType: string; size: number }> {
    const document = await this.visible(this.prisma, documentId, viewer);
    const version = await this.prisma.documentVersion.findFirst({
      where: { documentId, ...(versionNumber !== undefined && { number: versionNumber }) },
      orderBy: { number: "desc" },
    });
    if (!version) throw new DocumentNotFoundError();

    const stream = await this.storage.open(version.storageKey);
    if (document.restricted) {
      await this.audit.record({
        action: "document.downloaded",
        objectType: "Document",
        objectId: documentId,
        actorId: viewer.userId,
        details: { number: version.number },
      });
    }
    return { stream, filename: version.originalName, mimeType: version.mimeType, size: version.size };
  }

  async update(documentId: string, changes: { title?: string; category?: string; restricted?: boolean }, viewer: Viewer): Promise<DocumentDetail> {
    const document = await this.visible(this.prisma, documentId, viewer);
    if (document.archivedAt) throw new DocumentArchivedError();
    if (changes.restricted !== undefined && changes.restricted !== document.restricted && !viewer.canSeeRestricted) {
      throw new RestrictedAccessError();
    }
    if (changes.restricted !== undefined && changes.restricted !== document.restricted && viewer.scope) {
      throw new ScopeAccessError("Rendre un document restreint, ou le rendre à nouveau visible, est réservé aux droits globaux.");
    }
    if (changes.category !== undefined) this.category(changes.category);

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        ...(changes.title !== undefined && { title: this.title(changes.title) }),
        ...(changes.category !== undefined && { category: changes.category }),
        ...(changes.restricted !== undefined && { restricted: changes.restricted }),
      },
    });
    await this.audit.record({
      action: "document.updated",
      objectType: "Document",
      objectId: documentId,
      actorId: viewer.userId,
      details: { fields: Object.keys(changes) },
    });
    return this.get(documentId, viewer);
  }

  /** Un document ne se supprime pas : il s'archive (réversible) et disparaît des listes par défaut. */
  async setArchived(documentId: string, archived: boolean, viewer: Viewer): Promise<DocumentDetail> {
    await this.visible(this.prisma, documentId, viewer);
    await this.prisma.document.update({ where: { id: documentId }, data: { archivedAt: archived ? new Date() : null } });
    await this.audit.record({
      action: archived ? "document.archived" : "document.unarchived",
      objectType: "Document",
      objectId: documentId,
      actorId: viewer.userId,
    });
    return this.get(documentId, viewer);
  }

  async addLink(documentId: string, link: { objectType: string; objectId: string }, viewer: Viewer): Promise<DocumentDetail> {
    const document = await this.visible(this.prisma, documentId, viewer);
    if (document.archivedAt) throw new DocumentArchivedError();
    const clean = this.link(link);
    if (viewer.scope) await this.assertScopedLinks([clean], viewer, false);

    await this.prisma.documentLink.upsert({
      where: { documentId_objectType_objectId: { documentId, ...clean } },
      create: { documentId, ...clean, createdBy: viewer.userId },
      update: {},
    });
    await this.audit.record({ action: "document.linked", objectType: "Document", objectId: documentId, actorId: viewer.userId, details: clean });
    return this.get(documentId, viewer);
  }

  /** Retirer un lien ne supprime jamais le document : il peut être utilisé ailleurs. */
  async removeLink(documentId: string, linkId: string, viewer: Viewer): Promise<DocumentDetail> {
    await this.visible(this.prisma, documentId, viewer);
    const link = await this.prisma.documentLink.findFirst({ where: { id: linkId, documentId } });
    if (!link) throw new DocumentNotFoundError();

    await this.prisma.documentLink.delete({ where: { id: linkId } });
    await this.audit.record({
      action: "document.unlinked",
      objectType: "Document",
      objectId: documentId,
      actorId: viewer.userId,
      details: { objectType: link.objectType, objectId: link.objectId },
    });
    return this.get(documentId, viewer);
  }

  /**
   * Document visible par ce lecteur, sinon introuvable : un document restreint exige le droit dédié, et une personne limitée
   * à des projets ne voit que les documents de sa portée. On ne distingue jamais « n'existe pas » de « pas à vous ».
   */
  private async visible(db: Pick<Tx, "document">, documentId: string, viewer: Viewer) {
    const access = await this.access(viewer);
    const document = await db.document.findFirst({
      where: { AND: [{ id: documentId }, access.where, ...(viewer.canSeeRestricted ? [] : [{ restricted: false }])] },
    });
    if (!document) throw new DocumentNotFoundError();
    return document;
  }

  /** Documents déjà déposés avec exactement le même contenu : signalés, jamais bloqués (un justificatif peut servir deux fois). */
  private async duplicates(sha256: string, excludeId: string, viewer: Viewer): Promise<DuplicateInfo[]> {
    const access = await this.access(viewer);
    const rows = await this.prisma.document.findMany({
      // Même filtre de visibilité que partout : un doublon hors portée ne doit pas révéler son titre.
      where: { AND: [{ id: { not: excludeId }, versions: { some: { sha256 } } }, access.where, ...(viewer.canSeeRestricted ? [] : [{ restricted: false }])] },
      select: { id: true, title: true },
      take: 5,
    });
    return rows.map((row) => ({ documentId: row.id, title: row.title }));
  }

  /**
   * Visibilité d'un lecteur. Droit global : aucun filtre. Limité à des projets : lié à l'un d'eux ou à une subvention qui en
   * finance un, et jamais lié à un membre (les pièces personnelles ne s'ouvrent pas par la portée d'un projet).
   */
  private async access(viewer: Viewer): Promise<Access> {
    if (!viewer.scope) return { where: {}, grantIds: new Set() };
    const projects = [...viewer.scope];
    const grants = await this.prisma.grant.findMany({ where: { allocations: { some: { projectId: { in: projects } } } }, select: { id: true } });
    const grantIds = grants.map((g) => g.id);
    const linkWhere: Prisma.DocumentLinkWhereInput = {
      OR: [{ objectType: "project", objectId: { in: projects } }, { objectType: "grant", objectId: { in: grantIds } }],
    };
    return {
      where: { AND: [{ links: { some: linkWhere } }, { links: { none: { objectType: "member" } } }] },
      linkWhere,
      grantIds: new Set(grantIds),
    };
  }

  private summaryInclude(access: Access) {
    return {
      versions: { orderBy: { number: "desc" }, take: 1 },
      _count: { select: { versions: true, links: access.linkWhere ? { where: access.linkWhere } : true } },
    } satisfies Prisma.DocumentInclude;
  }

  /**
   * Les liens qu'une personne limitée à des projets peut poser : des projets de sa portée et des subventions de sa portée, rien
   * d'autre (ni autre projet, ni membre, ni écriture). Au dépôt, il en faut au moins un : le document doit appartenir à son projet.
   */
  private async assertScopedLinks(links: { objectType: string; objectId: string }[], viewer: Viewer, requireOne: boolean): Promise<void> {
    const access = await this.access(viewer);
    for (const link of links) {
      const allowed =
        (link.objectType === "project" && viewer.scope!.has(link.objectId)) || (link.objectType === "grant" && access.grantIds.has(link.objectId));
      if (!allowed) {
        throw new ScopeAccessError("Vous ne pouvez lier un document qu'à vos projets, ou aux subventions qui les financent.");
      }
    }
    if (requireOne && links.length === 0) {
      throw new ScopeAccessError("Un document déposé pour un projet doit être lié à ce projet : indiquez le projet concerné.");
    }
  }

  private where(filters: DocumentFilters, viewer: Viewer, access: Access): Prisma.DocumentWhereInput {
    return {
      AND: [
        access.where,
        {
          ...(viewer.canSeeRestricted ? {} : { restricted: false }),
          ...(filters.includeArchived ? {} : { archivedAt: null }),
          ...(filters.category && { category: filters.category }),
          ...(filters.q && { title: { contains: filters.q, mode: "insensitive" as const } }),
          // Filtrer par objet lié : une personne limitée à des projets ne peut filtrer que sur les liens qu'elle a le droit de voir,
          // sinon la liste révélerait un lien (vers un autre projet, un membre) qu'on lui cache.
          ...(filters.objectType && {
            links: {
              some: {
                AND: [
                  ...(access.linkWhere ? [access.linkWhere] : []),
                  { objectType: filters.objectType, ...(filters.objectId && { objectId: filters.objectId }) },
                ],
              },
            },
          }),
        },
      ],
    };
  }

  private summary(row: {
    id: string; title: string; category: string; restricted: boolean; archivedAt: Date | null; createdAt: Date; updatedAt: Date;
    versions: { number: number; originalName: string; mimeType: string; size: number; uploadedAt: Date }[];
    _count: { versions: number; links: number };
  }): DocumentSummary {
    const latest = row.versions[0]!;
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      restricted: row.restricted,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      versionCount: row._count.versions,
      linkCount: row._count.links,
      latest: { number: latest.number, originalName: latest.originalName, mimeType: latest.mimeType, size: latest.size, uploadedAt: latest.uploadedAt },
    };
  }

  /** Contrôle le fichier déposé d'après son contenu et son extension, puis prépare les champs de la version. */
  private version(file: IncomingFile) {
    const originalName = sanitizeFilename(file.originalName);
    if (file.size === 0) throw new InvalidFileError("Le fichier est vide.");
    const type = detectFileType(file.head, originalName);
    if (!type) {
      throw new InvalidFileError("Type de fichier non autorisé, ou contenu qui ne correspond pas à l'extension.");
    }
    return { originalName, mimeType: type.mimeType, size: file.size, sha256: file.sha256, storageKey: file.storageKey };
  }

  private title(value: string): string {
    const title = value.trim();
    if (title === "" || title.length > MAX_TITLE) throw new InvalidDocumentError("Le titre est obligatoire (200 caractères au plus).");
    return title;
  }

  private category(value: string): void {
    if (!isDocumentCategory(value)) throw new InvalidDocumentError("Catégorie inconnue.");
  }

  private comment(value: string | undefined): string | null {
    const comment = value?.trim();
    if (!comment) return null;
    if (comment.length > MAX_COMMENT) throw new InvalidDocumentError("Le commentaire est trop long (500 caractères au plus).");
    return comment;
  }

  private link(link: { objectType: string; objectId: string }): { objectType: string; objectId: string } {
    if (!isLinkableObjectType(link.objectType)) throw new InvalidDocumentError("Type d'objet lié inconnu.");
    const objectId = link.objectId.trim();
    if (objectId === "" || objectId.length > MAX_OBJECT_ID) throw new InvalidDocumentError("Identifiant d'objet lié invalide.");
    return { objectType: link.objectType, objectId };
  }
}
