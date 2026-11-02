export interface ReleaseGroup {
  /** Rubrique (« Nouveautés », « À savoir avant de mettre à jour »…), absente pour les puces sans titre. */
  title: string | null;
  items: string[];
}

export interface Release {
  /** Titre de la section : « 1.2.0 — 2026-11-10 » ou « Non publié ». */
  heading: string;
  /** Vrai si le titre désigne la version déployée. */
  current: boolean;
  groups: ReleaseGroup[];
}

/** Retire la mise en forme Markdown courante : l'écran affiche du texte, jamais du HTML issu du fichier. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function mentionsVersion(heading: string, version: string): boolean {
  const bare = version.replace(/^v/i, "");
  if (!bare || bare === "développement") return false;
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z.])v?${escaped}($|[^0-9A-Za-z.])`).test(heading);
}

/**
 * Lit un fichier de notes de version : titres `##` (versions), `###` (rubriques) et puces `-`. Le reste (introduction,
 * paragraphes) est ignoré. Une puce qui se poursuit sur la ligne suivante, indentée, est recollée.
 */
export function parseReleaseNotes(markdown: string, version: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let group: ReleaseGroup | null = null;
  let lastItem = false;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      const heading = plain(line.slice(3));
      release = { heading, current: mentionsVersion(heading, version), groups: [] };
      releases.push(release);
      group = null;
      lastItem = false;
    } else if (release && line.startsWith("### ")) {
      group = { title: plain(line.slice(4)), items: [] };
      release.groups.push(group);
      lastItem = false;
    } else if (release && /^[-*] /.test(line)) {
      if (!group) {
        group = { title: null, items: [] };
        release.groups.push(group);
      }
      group.items.push(plain(line.slice(2)));
      lastItem = true;
    } else if (release && group && lastItem && /^\s+\S/.test(line)) {
      const items = group.items;
      items[items.length - 1] = `${items[items.length - 1]} ${plain(line)}`;
    } else {
      lastItem = false;
    }
  }
  return releases;
}
