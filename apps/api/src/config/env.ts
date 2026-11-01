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
  };
}
