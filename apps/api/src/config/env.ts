export interface SessionSettings {
  /** Durée d'inactivité avant expiration, en minutes. */
  idleMinutes: number;
  /** Durée de vie maximale d'une session, en heures. */
  maxHours: number;
}

/** Envoi d'emails par SMTP (invitations, réinitialisations). Absent tant que SMTP_HOST n'est pas renseigné. */
export interface SmtpSettings {
  host: string;
  port: number;
  /** TLS dès la connexion (port 465). Sinon STARTTLS est exigé quand le serveur le propose. */
  secure: boolean;
  user: string | null;
  password: string | null;
  /** Adresse d'expédition (adresse seule : le nom affiché est celui de l'association). */
  from: string;
  /** Adresse publique de l'application, sans « / » final : sert à fabriquer les liens des emails. */
  publicUrl: string;
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
  /** Dossier des sauvegardes, en lecture seule pour l'API (écran d'exploitation) ; absent si non configuré. */
  backupsDir: string | null;
  /** Fichier des notes de version (CHANGELOG.md), lu pour l'écran d'exploitation ; absent si non fourni. */
  changelogFile: string | null;
  /** Version de l'application, fixée au déploiement (COTIASSO_VERSION). */
  appVersion: string;
  /**
   * Dépôt GitHub (« propriétaire/nom ») dont on lit les étiquettes de version pour dire si une mise à jour existe ;
   * null si la vérification est désactivée (UPDATE_CHECK=false), seule requête sortante de l'application vers un tiers.
   */
  updateCheckRepository: string | null;
  /** Envoi d'emails ; null si non configuré (les liens restent alors transmis à la main par l'administrateur). */
  smtp: SmtpSettings | null;
  /**
   * Adresse publique de l'application (PUBLIC_URL), sans « / » final, lue même sans SMTP : les clés d'accès (ADR 0036) en tirent
   * leur domaine. Non validée ici (une valeur erronée ne doit pas empêcher de démarrer) : `passkeyAvailability` la contrôle.
   */
  publicUrl: string | null;
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

const EMAIL_ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * Configuration SMTP déclarative. Tout ou rien : dès que SMTP_HOST est renseigné, SMTP_FROM et PUBLIC_URL sont obligatoires
 * (un email sans adresse d'expédition ou sans lien utilisable serait inutile), et l'identifiant exige le mot de passe.
 */
function readSmtp(source: NodeJS.ProcessEnv): SmtpSettings | null {
  const host = source.SMTP_HOST?.trim();
  if (!host) return null;
  const from = source.SMTP_FROM?.trim() ?? "";
  if (!EMAIL_ADDRESS.test(from)) throw new Error("SMTP_FROM est obligatoire avec SMTP_HOST : une adresse email seule, par exemple no-reply@asso.fr.");
  const publicUrl = (source.PUBLIC_URL?.trim() ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(\/\S*)?$/.test(publicUrl)) {
    throw new Error("PUBLIC_URL est obligatoire avec SMTP_HOST : l'adresse publique de l'application, par exemple https://compta.asso.fr.");
  }
  const user = source.SMTP_USER?.trim() || null;
  const password = source.SMTP_PASSWORD || null;
  if ((user === null) !== (password === null)) throw new Error("SMTP_USER et SMTP_PASSWORD vont ensemble : renseignez les deux ou aucun.");
  const secure = readBoolean(source, "SMTP_SECURE", false);
  return { host, port: readPositiveInteger(source, "SMTP_PORT", secure ? 465 : 587), secure, user, password, from, publicUrl };
}

/** Vérification des versions : active par défaut sur le dépôt du projet, désactivable, ou pointée vers un fork. */
function readUpdateCheckRepository(source: NodeJS.ProcessEnv): string | null {
  if (!readBoolean(source, "UPDATE_CHECK", true)) return null;
  const repository = source.UPDATE_CHECK_REPOSITORY?.trim() || "valcriss/cotiasso";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`UPDATE_CHECK_REPOSITORY invalide : ${repository} (attendu : propriétaire/dépôt).`);
  }
  return repository;
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
    backupsDir: source.BACKUPS_DIR || null,
    changelogFile: source.CHANGELOG_FILE || null,
    appVersion: source.COTIASSO_VERSION || "développement",
    updateCheckRepository: readUpdateCheckRepository(source),
    smtp: readSmtp(source),
    publicUrl: source.PUBLIC_URL?.trim().replace(/\/+$/, "") || null,
  };
}
