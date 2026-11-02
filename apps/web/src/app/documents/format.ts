/** Taille lisible d'un fichier en octets, kilo-octets ou mégaoctets. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/** Libellé des types d'objets liables. */
export const OBJECT_TYPE_LABELS: Record<string, string> = {
  member: 'Membre',
  project: 'Projet',
  grant: 'Subvention',
  transaction: 'Transaction',
  expense: 'Dépense',
  'journal-entry': 'Écriture',
  import: 'Import bancaire',
};

export function objectTypeLabel(type: string): string {
  return OBJECT_TYPE_LABELS[type] ?? type;
}

/** Titre proposé à partir du nom de fichier : sans extension ni tirets bas. */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return base === '' ? filename : base;
}
