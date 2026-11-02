import { Money } from "@cotiasso/accounting-domain";

const DAY_MS = 86_400_000;

/** Nombre de jours d'une période, bornes comprises (dates `AAAA-MM-JJ`). */
export function inclusiveDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
}

const toCents = (amount: string): bigint => BigInt(Money.parse(amount).toString().replace(".", ""));

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Part d'une ligne de budget qui tombe dans une période (un exercice) : le montant est réparti **au prorata du nombre de
 * jours** de la ligne compris dans la période. Calcul en centimes entiers, arrondi au centime le plus proche (0,5 vers le
 * haut). Une ligne entièrement dans la période est rendue telle quelle, une ligne hors période vaut zéro.
 * Les parts de deux exercices consécutifs peuvent différer d'un centime du montant total à cause de l'arrondi : la vue
 * globale (toute la vie du projet) utilise toujours le montant exact.
 */
export function prorate(amount: string, start: string, end: string, scopeStart: string, scopeEnd: string): string {
  const from = start > scopeStart ? start : scopeStart;
  const to = end < scopeEnd ? end : scopeEnd;
  if (from > to) return "0.00";
  const total = BigInt(inclusiveDays(start, end));
  const overlap = BigInt(inclusiveDays(from, to));
  const cents = toCents(amount);
  return fromCents((cents * overlap * 2n + total) / (2n * total));
}
