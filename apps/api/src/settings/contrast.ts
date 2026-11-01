/** Luminance relative d'une couleur #RRGGBB (WCAG 2.x). */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 (identiques) à 21 (noir sur blanc). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Seuil WCAG AA pour du texte courant. */
export const MIN_TEXT_CONTRAST = 4.5;
