/** Relative luminance (0..1) of a CSS rgb()/rgba() color, or null if transparent/unparsable. */
export function luminanceOf(color: string): number | null {
  const m = color.match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b, a = 1] = m.map(Number);
  if (a === 0) return null;
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** First non-transparent background in a chain (element up to html); white if none. */
export function pillTheme(backgrounds: string[]): "dark" | "light" {
  for (const c of backgrounds) {
    const l = luminanceOf(c);
    if (l !== null) return l < 0.4 ? "dark" : "light";
  }
  return "light";
}
