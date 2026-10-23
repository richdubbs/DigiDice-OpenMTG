/**
 * Dropdown lists (the opened <select>) follow the dark theme: the browser draws the popup from the options' own background-color and color, so they
 * need an opaque dark color and readable text (they came up white with near-white text). jsdom draws no popup, so the stylesheet text is checked.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeVars } from '../src/theme/theme';
import { contrast, cssOf, declarations } from './css-rules';

const css = cssOf('theme/styles.css');
const root = declarations(css, ':root');
const vars = themeVars();

/** A declared color with a `var(--x)` resolved through :root and the theme. */
function resolve(value: string | undefined): string {
  const m = /^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/.exec(value ?? '');
  if (!m) return value ?? '';
  return resolve(root[m[1]!] ?? vars[m[1]!] ?? m[2]);
}

describe('select dropdown theme', () => {
  it('asks for the dark color scheme and gives the select, its options and groups an opaque dark background with the UI text color', () => {
    for (const selector of ['select', 'select option', 'select optgroup']) {
      const d = declarations(css, selector);
      expect(d['color-scheme'], selector).toBe('dark');
      const bg = resolve(d['background-color']);
      expect(bg, selector).toMatch(/^#[0-9a-f]{6}$/i);
      // Dark: far darker than the white text; readable: AA contrast for the option text.
      expect(contrast(bg, '#ffffff'), selector).toBeGreaterThan(12);
      expect(contrast(bg, resolve(d['color'])), selector).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('highlights the hovered and chosen option with the UI highlight color, still readable', () => {
    for (const selector of ['select option:checked', 'select option:hover']) {
      const d = declarations(css, selector);
      const bg = resolve(d['background-color']);
      expect(bg, selector).toBe(resolve('var(--menu-hover)'));
      expect(bg, selector).not.toBe(resolve('var(--menu-bg)'));
      expect(contrast(bg, resolve(d['color'])), selector).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('no stylesheet rule on a select leaves its background see-through (the opened list would come up white)', () => {
    const src = path.resolve(__dirname, '..', 'src');
    const sheets = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(5);
    const clear = /var\(--surface(-strong)?\)|rgba?\([^)]*,\s*0?\.\d+\)|transparent/;
    for (const file of sheets) {
      const text = readFileSync(path.join(src, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      // The last background a sheet declares for each selector that ends in `select` (a later rule may make an earlier see-through one solid again).
      const last = new Map<string, string>();
      for (const m of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        const bgs = [...m[2]!.matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/g)].map((d) => d[1]!.trim());
        if (!bgs.length) continue;
        for (const s of m[1]!.split(',').map((x) => x.trim().replace(/\s+/g, ' '))) if (/(^|\s)select$/.test(s)) last.set(s, bgs.at(-1)!);
      }
      for (const [selector, bg] of last) expect(clear.test(bg), `${file}: ${selector} { background: ${bg} }`).toBe(false);
    }
  });
});
