import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import { FileTooLargeError } from "./errors.js";

export interface StoredFile {
  storageKey: string;
  size: number;
  sha256: string;
  /** Début du fichier, pour en contrôler la signature sans le relire. */
  head: Buffer;
}

const HEAD_BYTES = 4096;
const KEY_FORMAT = /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Stockage privé des fichiers sur disque. La clé est opaque et générée par le serveur : le nom d'origine ne sert
 * jamais de chemin. Rien n'est servi directement : tout téléchargement passe par l'API et ses contrôles d'accès.
 */
@Injectable()
export class DocumentStorage {
  private readonly root: string;

  constructor(@Inject(ENV) private readonly env: AppEnv) {
    this.root = resolve(env.documentsDir);
  }

  /** Écrit le flux sur disque en calculant sa taille et son empreinte ; refuse de dépasser la taille maximale. */
  async save(stream: Readable): Promise<StoredFile> {
    const now = new Date();
    const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
    const target = this.pathFor(storageKey);
    const partial = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });

    const hash = createHash("sha256");
    const head: Buffer[] = [];
    let headLength = 0;
    let size = 0;
    const maxBytes = this.env.documentsMaxBytes;

    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) {
          callback(new FileTooLargeError(maxBytes));
          return;
        }
        hash.update(chunk);
        if (headLength < HEAD_BYTES) {
          const part = chunk.subarray(0, HEAD_BYTES - headLength);
          head.push(part);
          headLength += part.length;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(stream, meter, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    return { storageKey, size, sha256: hash.digest("hex"), head: Buffer.concat(head) };
  }

  /** Ouvre un fichier en lecture ; échoue d'emblée (avant tout envoi) s'il manque dans le stockage. */
  async open(storageKey: string): Promise<ReadStream> {
    const path = this.pathFor(storageKey);
    await access(path);
    return createReadStream(path);
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  /** Chemin d'une clé, toujours à l'intérieur du dossier de stockage (aucune traversée possible). */
  private pathFor(storageKey: string): string {
    if (!KEY_FORMAT.test(storageKey)) throw new Error("Clé de stockage invalide.");
    const path = resolve(join(this.root, storageKey));
    if (!path.startsWith(this.root + sep)) throw new Error("Clé de stockage invalide.");
    return path;
  }
}
