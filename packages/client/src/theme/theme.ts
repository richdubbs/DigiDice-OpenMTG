/**
 * The theme: CSS custom properties derived from brand.json (a dark table with brand blue, magenta and white; docs/design/m8-client.md "Visual design").
 * styles.css uses only these variables for colors, so every screen follows the brand file.
 */
import { BRAND, type Brand } from '../branding/brand';

/** Contrast ratio of two #RRGGBB colors (WCAG 2.x relative luminance). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** "31, 184, 255" for #1fb8ff: the channels of a color, for `rgba(var(--x-rgb), alpha)`. */
export function rgbChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * The CSS variables of the theme. The stylesheets draw their translucent glows and edges as `rgba(var(--neon-rgb), alpha)` (brand blue) and
 * `rgba(var(--neon-2-rgb), alpha)` (brand magenta), so a UI profile (profiles/profiles.ts) can recolor them.
 */
export function themeVars(brand: Brand = BRAND): Record<string, string> {
  const c = brand.colors;
  return {
    '--brand-blue': c.blue,
    '--brand-blue-deep': c.blueDeep,
    '--brand-magenta': c.magenta,
    '--brand-white': c.white,
    '--brand-black': c.black,
    '--brand-navy': c.navy,
    '--table-bg': c.navy,
    '--surface': 'rgba(232, 232, 240, 0.06)',
    '--surface-strong': 'rgba(232, 232, 240, 0.12)',
    '--border': 'rgba(31, 184, 255, 0.35)',
    '--text': c.white,
    '--text-muted': 'rgba(232, 232, 240, 0.72)',
    '--accent': c.blue,
    '--accent-text': c.black,
    '--accent-2': c.magenta,
    '--focus': c.magenta,
    '--neon-rgb': rgbChannels(c.blue),
    '--neon-2-rgb': rgbChannels(c.magenta),
  };
}

/** Apply the theme to an element (the document root in main.tsx). */
export function applyTheme(el: HTMLElement, brand: Brand = BRAND): void {
  for (const [k, v] of Object.entries(themeVars(brand))) el.style.setProperty(k, v);
}
