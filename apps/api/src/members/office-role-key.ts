/**
 * Clé de comparaison d'un nom de fonction : sans casse, sans accents, espaces réduits (ADR 0035).
 * « Présidente », « présidente » et « Presidente  » désignent la même fonction.
 * La migration `add_office_roles` applique la même règle en SQL pour reprendre les intitulés existants.
 */
export function officeRoleKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
