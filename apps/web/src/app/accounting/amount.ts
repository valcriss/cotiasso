/**
 * Montants saisis à la française (« 12,5 », « 1 250.00 ») convertis en centimes entiers : aucun calcul d'argent en
 * flottant. Les montants échangés avec l'API sont des chaînes décimales à deux décimales.
 */
export function parseAmountToCents(input: string | null | undefined): number | null {
  const text = (input ?? '').replace(/\s/g, '').replace(',', '.');
  if (text === '') return 0;
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Centimes → chaîne décimale pour l'API (« 1250.50 »). */
export function centsToApi(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Centimes → affichage français (« 1 250,50 »). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')}`;
}

/** Chaîne décimale de l'API → affichage français. */
export function formatApiAmount(value: string): string {
  // Un résultat peut être négatif (déficit) : le signe est lu à part, le montant reste exact.
  const negative = value.startsWith('-');
  const cents = parseAmountToCents(negative ? value.slice(1) : value);
  if (cents === null) return value;
  return negative && cents !== 0 ? `-${formatCents(cents)}` : formatCents(cents);
}

/** Solde (débit − crédit) de l'API en affichage français, avec son sens : « 1 180,00 D » ou « 300,00 C ». */
export function formatBalance(value: string): string {
  const cents = parseAmountToCents(value.replace(/^-/, ''));
  if (cents === null) return value;
  if (cents === 0) return formatCents(0);
  return `${formatCents(cents)} ${value.startsWith('-') ? 'C' : 'D'}`;
}
