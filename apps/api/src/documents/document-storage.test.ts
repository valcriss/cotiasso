import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../config/env.js";
import { DocumentStorage } from "./document-storage.js";
import { FileTooLargeError } from "./errors.js";

async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) found.push(join(entry.parentPath, entry.name));
  }
  return found;
}

describe("DocumentStorage", () => {
  let root: string;
  let storage: DocumentStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cotiasso-docs-"));
    storage = new DocumentStorage({ documentsDir: root, documentsMaxBytes: 1024 } as AppEnv);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("écrit le flux sous une clé opaque, avec sa taille, son empreinte et son début", async () => {
    const content = Buffer.from("%PDF-1.7 contenu de test");
    const stored = await storage.save(Readable.from([content.subarray(0, 5), content.subarray(5)]));

    expect(stored.size).toBe(content.length);
    expect(stored.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(stored.head.toString()).toBe(content.toString());
    expect(stored.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(await readFile(join(root, stored.storageKey))).toEqual(content);
  });

  it("garde uniquement le début du fichier pour contrôler sa signature", async () => {
    const big = Buffer.alloc(1000, 0x61);
    const stored = await storage.save(Readable.from([big]));
    expect(stored.head.length).toBe(1000);
    const large = new DocumentStorage({ documentsDir: root, documentsMaxBytes: 100_000 } as AppEnv);
    expect((await large.save(Readable.from([Buffer.alloc(50_000, 0x62)]))).head.length).toBe(4096);
  });

  it("relit exactement ce qui a été écrit", async () => {
    const stored = await storage.save(Readable.from([Buffer.from("bonjour")]));
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.open(stored.storageKey)) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("bonjour");
  });

  it("refuse un fichier trop grand et ne laisse aucun reste sur le disque", async () => {
    await expect(storage.save(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]))).rejects.toBeInstanceOf(FileTooLargeError);
    expect(await listFiles(root)).toEqual([]);
  });

  it("refuse toute clé qui n'a pas été générée par le serveur (aucune traversée de chemin)", async () => {
    for (const key of ["../../etc/passwd", "2026/11/../../x", "/etc/passwd", "2026/11/facture.pdf", "", "2026/11/" + "g".repeat(36)]) {
      await expect(storage.open(key)).rejects.toThrow(/Clé de stockage invalide/);
      await expect(storage.remove(key)).rejects.toThrow(/Clé de stockage invalide/);
    }
  });

  it("échoue à l'ouverture d'un fichier manquant, avant tout envoi", async () => {
    await expect(storage.open("2026/11/00000000-0000-4000-8000-000000000000")).rejects.toThrow();
  });

  it("supprime un fichier, sans erreur s'il n'existe plus", async () => {
    const stored = await storage.save(Readable.from([Buffer.from("x")]));
    await storage.remove(stored.storageKey);
    await expect(stat(join(root, stored.storageKey))).rejects.toThrow();
    await expect(storage.remove(stored.storageKey)).resolves.toBeUndefined();
  });
});
