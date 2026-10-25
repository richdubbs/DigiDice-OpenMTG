/**
 * Reading our own stylesheets in tests (jsdom does no layout, so a few layout and contrast guarantees are checked on the CSS text itself, or on the
 * cascade with the sheets put into the document).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function cssOf(relative: string): string {
  return readFileSync(path.resolve(__dirname, '..', 'src', relative), 'utf8');
}

/** Puts our stylesheets (paths under src/) into the document, so `getComputedStyle` applies their cascade (jsdom matches selectors). Returns the undo. */
export function injectCss(...relative: string[]): () => void {
  const sheets = relative.map((r) => {
    const sheet = document.createElement('style');
    sheet.textContent = cssOf(r);
    document.head.appendChild(sheet);
    return sheet;
  });
  return () => sheets.forEach((s) => s.remove());
}

/** The stacking contexts from the document down to `el` (itself included): a positioned box with a z-index, or an isolated one (z 0). */
function stackingPath(el: Element): { el: Element; z: number }[] {
  const out: { el: Element; z: number }[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    const z = s.zIndex === '' || s.zIndex === 'auto' ? null : Number(s.zIndex);
    if ((z !== null && s.position !== '' && s.position !== 'static') || s.isolation === 'isolate') out.unshift({ el: e, z: z ?? 0 });
  }
  return out;
}

/**
 * Whether `a` is drawn over `b` where the two overlap (and so gets the clicks there, unless it lets them through), from the stylesheets in the document
 * (`injectCss`): in their closest common stacking context the higher z-index wins, then the later one in the document (CSS 2.1 appendix E). jsdom has
 * no `elementFromPoint` to ask instead.
 */
export function paintsOver(a: Element, b: Element): boolean {
  const pa = stackingPath(a);
  const pb = stackingPath(b);
  let i = 0;
  while (pa[i] !== undefined && pa[i]!.el === pb[i]?.el) i++;
  const [x, y] = [pa[i], pb[i]];
  if (!x || !y) throw new Error('paintsOver: one of the two is drawn inside the other\'s stacking context');
  return x.z !== y.z ? x.z > y.z : (y.el.compareDocumentPosition(x.el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The declarations of every rule whose selector list contains `selector` exactly, merged in order. */
export function declarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (!selectors.includes(selector)) continue;
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
};

/** WCAG 2 contrast ratio of two #rgb / #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
