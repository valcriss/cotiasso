/** Rapport de contraste WCAG entre deux couleurs #RRGGBB ; null si l'une d'elles n'est pas valide. */
export function contrastRatio(foreground: string, background: string): number | null {
  const pattern = /^#[0-9a-fA-F]{6}$/;
  if (!pattern.test(foreground) || !pattern.test(background)) return null;
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((start) => {
      const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Seuil WCAG AA pour du texte courant, identique à celui que le serveur impose. */
export const MIN_TEXT_CONTRAST = 4.5;
