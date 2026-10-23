/**
 * The board stylesheet as test data. jsdom does no layout, so layout rules (no clipping, no overlap, contrast) are checked on the stylesheet itself:
 * `decl(selector)` returns the declarations of one exact selector, `injectBoardCss()` puts the sheet into the document so `getComputedStyle` applies the
 * cascade (jsdom matches selectors, it does not compute layout), and `resolveColor` turns `var(--x)` into a colour with the theme's values.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { themeVars } from '../../src/theme/theme';

export const BOARD_CSS = readFileSync(path.resolve(__dirname, '../../src/board/board.css'), 'utf8');

export interface CssRule {
  selectors: string[];
  decls: Record<string, string>;
  /** The @media prelude the rule sits in, if any. */
  media?: string;
}

function parseDecls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Every style rule, with one level of @media nesting. */
export function cssRules(css = BOARD_CSS): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: CssRule[] = [];
  let i = 0;
  const readBlock = (media?: string) => {
    while (i < text.length) {
      const open = text.indexOf('{', i);
      const close = text.indexOf('}', i);
      if (close >= 0 && (open < 0 || close < open)) {
        i = close + 1;
        return;
      }
      if (open < 0) return;
      const prelude = text.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith('@media')) {
        readBlock(prelude);
        continue;
      }
      const end = text.indexOf('}', i);
      const rule: CssRule = { selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls: parseDecls(text.slice(i, end)) };
      if (media) rule.media = media;
      out.push(rule);
      i = end + 1;
    }
  };
  readBlock();
  return out;
}

/** The declarations of an exact selector outside @media (later rules win). */
export function decl(selector: string, media?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of cssRules()) if (r.media === media && r.selectors.includes(selector)) Object.assign(out, r.decls);
  return out;
}

let injected: HTMLStyleElement | null = null;
export function injectBoardCss(): void {
  if (injected) return;
  injected = document.createElement('style');
  injected.textContent = BOARD_CSS;
  document.head.appendChild(injected);
}
export function removeBoardCss(): void {
  injected?.remove();
  injected = null;
}

type Rgba = [number, number, number, number];

/** The board's own variables (declared on .game-board) plus the theme's. */
function vars(): Record<string, string> {
  return { ...themeVars(), ...Object.fromEntries(Object.entries(decl('.game-board')).filter(([k]) => k.startsWith('--'))) };
}

/** A colour value (hex, rgb(a), or var() of one) as RGBA. */
export function resolveColor(value: string): Rgba {
  const v = value.trim();
  const m = /var\((--[\w-]+)\)/.exec(v);
  if (m) {
    const next = vars()[m[1]!];
    if (next === undefined) throw new Error(`unknown variable ${m[1]}`);
    return resolveColor(next);
  }
  if (v.startsWith('#')) {
    const h = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join('') : v.slice(1);
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const r = /rgba?\(([^)]+)\)/.exec(v);
  if (r) {
    const [a, b, c, d] = r[1]!.split(',').map((x) => parseFloat(x));
    return [a!, b!, c!, d ?? 1];
  }
  throw new Error(`cannot resolve colour ${value}`);
}

/** `top` drawn over the opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

/** WCAG 2.x contrast ratio of two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const lum = (c: Rgba) =>
    [c[0], c[1], c[2]]
      .map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, x, i) => sum + [0.2126, 0.7152, 0.0722][i]! * x, 0);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
