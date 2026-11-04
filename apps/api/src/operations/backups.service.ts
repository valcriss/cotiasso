import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AppEnv } from "../config/env.js";
import { ENV } from "../config/tokens.js";
import {
  evaluateBackupHealth,
  evaluateOffsiteHealth,
  type BackupHealthReport,
  type BackupStatusFile,
  type OffsiteHealthReport,
  type OffsiteStatusFile,
} from "./backup-health.js";
import { parseReleaseNotes, type Release } from "./release-notes.js";

const statusSchema = z.object({
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  intervalHours: z.number().positive(),
  retentionDays: z.number().positive(),
});

const offsiteSchema = z.object({
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  target: z.string(),
});

const manifestSchema = z.object({
  name: z.string().regex(/^cotiasso-\d{8}T\d{6}Z$/),
  createdAt: z.string(),
  appVersion: z.string(),
  migrations: z.number(),
  archiveBytes: z.number().optional(),
  archiveSha256: z.string().optional(),
  counts: z.object({
    users: z.number(),
    documents: z.number(),
    documentVersions: z.number(),
    auditEvents: z.number(),
  }),
});

export interface BackupEntry {
  name: string;
  createdAt: string;
  appVersion: string;
  bytes: number | null;
  migrations: number;
  counts: { users: number; documents: number; documentVersions: number; auditEvents: number };
  /** Faux si l'archive a disparu alors que son manifeste existe. */
  archivePresent: boolean;
}

export interface OperationsReport {
  version: string;
  backups: {
    configured: boolean;
    report: BackupHealthReport | null;
    status: BackupStatusFile | null;
    entries: BackupEntry[];
  };
  /** Copie hors site des archives chiffrées ; « NONE » tant qu'elle n'est pas configurée. */
  offsite: { report: OffsiteHealthReport; status: OffsiteStatusFile | null };
  /** Envoi d'emails : seulement ce qui se lit sans risque (jamais d'identifiant ni de mot de passe). */
  mail: MailConfigReport;
}

export type MailConfigReport =
  | { configured: false }
  | { configured: true; host: string; port: number; secure: boolean; from: string; authenticated: boolean };

export interface ReleaseNotesReport {
  version: string;
  available: boolean;
  releases: Release[];
}

/** Lit l'état des sauvegardes écrit par le service backup, en lecture seule : l'API ne sauvegarde ni ne restaure rien. */
@Injectable()
export class BackupsService {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  async report(now: Date = new Date()): Promise<OperationsReport> {
    const dir = this.env.backupsDir;
    if (!dir) {
      return {
        version: this.env.appVersion,
        backups: { configured: false, report: null, status: null, entries: [] },
        offsite: { status: null, report: evaluateOffsiteHealth(null, 24, now) },
        mail: this.mailConfig(),
      };
    }

    const status = await this.readJson(join(dir, "status.json"), statusSchema);
    const entries = await this.entries(dir);
    const offsiteStatus = await this.readJson(join(dir, "offsite.json"), offsiteSchema);
    return {
      version: this.env.appVersion,
      backups: {
        configured: true,
        status,
        entries,
        report: evaluateBackupHealth(status, entries.filter((e) => e.archivePresent).length, now),
      },
      offsite: { status: offsiteStatus, report: evaluateOffsiteHealth(offsiteStatus, status?.intervalHours ?? 24, now) },
      mail: this.mailConfig(),
    };
  }

  private mailConfig(): MailConfigReport {
    const smtp = this.env.smtp;
    if (!smtp) return { configured: false };
    return { configured: true, host: smtp.host, port: smtp.port, secure: smtp.secure, from: smtp.from, authenticated: smtp.user !== null };
  }

  /** Notes de version du fichier CHANGELOG.md livré avec l'image ; vide si le fichier est absent ou illisible. */
  async releaseNotes(): Promise<ReleaseNotesReport> {
    const version = this.env.appVersion;
    const file = this.env.changelogFile;
    if (!file) return { version, available: false, releases: [] };
    try {
      return { version, available: true, releases: parseReleaseNotes(await readFile(file, "utf8"), version) };
    } catch {
      return { version, available: false, releases: [] };
    }
  }

  private async entries(dir: string): Promise<BackupEntry[]> {
    let names: string[];
    try {
      names = (await readdir(dir)).filter((name) => /^cotiasso-\d{8}T\d{6}Z\.manifest\.json$/.test(name));
    } catch {
      return [];
    }

    const entries: BackupEntry[] = [];
    for (const file of names) {
      const manifest = await this.readJson(join(dir, file), manifestSchema);
      if (!manifest) continue;
      entries.push({
        name: manifest.name,
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        bytes: manifest.archiveBytes ?? null,
        migrations: manifest.migrations,
        counts: manifest.counts,
        archivePresent: await access(join(dir, `${manifest.name}.tar.enc`)).then(() => true, () => false),
      });
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
