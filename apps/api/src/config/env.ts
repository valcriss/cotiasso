export interface SessionSettings {
  /** Durée d'inactivité avant expiration, en minutes. */
  idleMinutes: number;
  /** Durée de vie maximale d'une session, en heures. */
  maxHours: number;
}

export interface AppEnv {
  databaseUrl: string;
  host: string;
  port: number;
  session: SessionSettings;
  /** Cookie `Secure` (HTTPS) : à désactiver uniquement en développement local en HTTP. */
  cookieSecure: boolean;
  /** À activer derrière un reverse proxy de confiance pour lire l'IP réelle (X-Forwarded-For). */
  trustProxy: boolean;
  /** Clé AES-256 qui chiffre les secrets TOTP au repos. À sauvegarder avec la base. */
  mfaKey: Buffer;
  /** Dossier privé des documents déposés : à sauvegarder avec la base, jamais servi directement. */
  documentsDir: string;
  /** Taille maximale d'un fichier déposé, en octets. */
  documentsMaxBytes: number;
}

function readPositiveInteger(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = source[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${key} invalide : ${raw}`);
  }
  return value;
}

function readBoolean(source: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = source[key];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${key} doit valoir true ou false : ${raw}`);
}

function readKey(source: NodeJS.ProcessEnv, key: string): Buffer {
  const raw = source[key];
  if (!raw) throw new Error(`${key} est obligatoire : 32 octets en base64 (voir .env.example).`);
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) throw new Error(`${key} doit décoder exactement 32 octets en base64.`);
  return bytes;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL est obligatoire (voir .env.example).");
  }
  const port = Number(source.API_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT invalide : ${source.API_PORT}`);
  }
  return {
    databaseUrl,
    host: source.API_HOST ?? "127.0.0.1",
    port,
    session: {
      idleMinutes: readPositiveInteger(source, "SESSION_IDLE_MINUTES", 120),
      maxHours: readPositiveInteger(source, "SESSION_MAX_HOURS", 12),
    },
    cookieSecure: readBoolean(source, "COOKIE_SECURE", true),
    trustProxy: readBoolean(source, "TRUST_PROXY", false),
    mfaKey: readKey(source, "MFA_ENCRYPTION_KEY"),
    documentsDir: source.DOCUMENTS_DIR || "./storage/documents",
    documentsMaxBytes: readPositiveInteger(source, "DOCUMENTS_MAX_MB", 25) * 1024 * 1024,
  };
}
