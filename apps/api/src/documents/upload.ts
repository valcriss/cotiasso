import "@fastify/multipart";
import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DocumentStorage } from "./document-storage.js";
import { FileTooLargeError } from "./errors.js";
import type { IncomingFile } from "./documents.service.js";

/**
 * Lit un envoi multipart : champs de texte et un seul fichier, écrit en flux sur disque (jamais en mémoire).
 * Le fichier est retiré si la lecture échoue ; sinon c'est le service qui le retire en cas de refus.
 */
export async function readUpload(storage: DocumentStorage, request: FastifyRequest): Promise<{ fields: Record<string, string>; file: IncomingFile | null }> {
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
        const stored = await storage.save(part.file);
        file = { ...stored, originalName: part.filename };
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (file) await storage.remove(file.storageKey);
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
