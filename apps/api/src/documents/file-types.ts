export interface DetectedFileType {
  /** Extension normalisée, sans point. */
  extension: string;
  /** Type MIME servi au téléchargement : toujours celui détecté, jamais celui déclaré par le client. */
  mimeType: string;
}

interface AllowedType {
  mimeType: string;
  kind: "pdf" | "png" | "jpeg" | "zip" | "text" | "ofx";
}

/**
 * Liste blanche stricte. Les formats actifs (HTML, SVG, scripts, exécutables) sont exclus : un fichier déposé
 * ne doit jamais pouvoir s'exécuter ni s'interpréter comme une page dans le navigateur d'un autre utilisateur.
 */
const ALLOWED: Record<string, AllowedType> = {
  pdf: { mimeType: "application/pdf", kind: "pdf" },
  png: { mimeType: "image/png", kind: "png" },
  jpg: { mimeType: "image/jpeg", kind: "jpeg" },
  jpeg: { mimeType: "image/jpeg", kind: "jpeg" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "zip" },
  xlsx: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "zip" },
  pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "zip" },
  odt: { mimeType: "application/vnd.oasis.opendocument.text", kind: "zip" },
  ods: { mimeType: "application/vnd.oasis.opendocument.spreadsheet", kind: "zip" },
  odp: { mimeType: "application/vnd.oasis.opendocument.presentation", kind: "zip" },
  csv: { mimeType: "text/csv; charset=utf-8", kind: "text" },
  txt: { mimeType: "text/plain; charset=utf-8", kind: "text" },
};

/**
 * Types que seule l'application dépose elle-même (jamais un utilisateur) : le fichier d'origine d'un import bancaire. Ils restent
 * hors de la liste proposée au dépôt, mais passent les mêmes contrôles (contenu ET extension) et sont servis en pièce jointe.
 */
const SYSTEM_ONLY: Record<string, AllowedType> = {
  ofx: { mimeType: "application/x-ofx", kind: "ofx" },
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

const startsWith = (head: Uint8Array, signature: number[]): boolean =>
  head.length >= signature.length && signature.every((byte, index) => head[index] === byte);

function isUtf8Text(head: Uint8Array): boolean {
  if (head.includes(0)) return false;
  try {
    // `stream: true` tolère une séquence multi-octets coupée à la fin de l'échantillon.
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** Un relevé OFX est du texte (UTF-8 ou Windows-1252, donc sans test d'encodage) qui s'annonce par OFXHEADER ou une balise OFX. */
function isOfx(head: Uint8Array): boolean {
  if (head.length === 0 || head.includes(0)) return false;
  return /OFXHEADER|<OFX[\s>]/i.test(Buffer.from(head).toString("latin1"));
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index <= 0 ? "" : filename.slice(index + 1).toLowerCase();
}

/**
 * Détermine le type d'un fichier d'après son contenu (signature) ET son extension : les deux doivent concorder.
 * Renvoie null si le type est absent de la liste blanche ou si le contenu contredit l'extension.
 */
export function detectFileType(head: Uint8Array, filename: string, options: { system?: boolean } = {}): DetectedFileType | null {
  const extension = extensionOf(filename);
  const allowed = ALLOWED[extension] ?? (options.system ? SYSTEM_ONLY[extension] : undefined);
  if (!allowed) return null;

  const matches =
    (allowed.kind === "pdf" && startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) ||
    (allowed.kind === "png" && startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (allowed.kind === "jpeg" && startsWith(head, [0xff, 0xd8, 0xff])) ||
    (allowed.kind === "zip" && startsWith(head, [0x50, 0x4b, 0x03, 0x04])) ||
    (allowed.kind === "text" && head.length > 0 && isUtf8Text(head)) ||
    (allowed.kind === "ofx" && isOfx(head));

  return matches ? { extension, mimeType: allowed.mimeType } : null;
}

const MAX_NAME_LENGTH = 120;

/**
 * Nom d'affichage sûr : sans chemin, sans caractère de contrôle ni de séparateur, de longueur bornée.
 * Il sert à l'affichage et à l'en-tête de téléchargement, jamais de chemin sur le serveur.
 */
export function sanitizeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[.\s]+/, "")
    .trim();
  if (cleaned === "") return "document";
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  const extension = extensionOf(cleaned);
  const keep = MAX_NAME_LENGTH - (extension ? extension.length + 1 : 0);
  return extension ? `${cleaned.slice(0, keep)}.${extension}` : cleaned.slice(0, MAX_NAME_LENGTH);
}
