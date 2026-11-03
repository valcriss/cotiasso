/**
 * Dates : l'API échange des chaînes `AAAA-MM-JJ` (jamais des instants). Ces fonctions ne passent par `Date` que pour lire
 * l'horloge du navigateur ; l'affichage découpe la chaîne, sans fuseau horaire donc sans décalage d'un jour.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Date du jour **dans le fuseau de la personne** (`toISOString()` donnerait la veille entre minuit et 1 h ou 2 h à Paris). */
export function todayLocalIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** `2026-11-02` → `02/11/2026`. Une valeur vide ou inattendue est rendue telle quelle (jamais d'exception à l'affichage). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = ISO_DATE.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** `2026-11-02` → `2 novembre 2026` (`1er` pour le premier du mois), pour les phrases. */
export function formatDateLong(value: string | null | undefined): string {
  if (!value) return '';
  const match = ISO_DATE.exec(value);
  if (!match) return value;
  const day = Number(match[3]);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value;
  return `${day === 1 ? '1er' : day} ${month} ${match[1]}`;
}
