/**
 * C6 integration: the work packages' stylesheets share one page (Vite bundles them all), so a class one package defines at the top level must not be
 * used or defined by another package (STATUS.md wave M8-W1 gap 3: C2, C3 and C4 each styled `.card-frame`, `.mana-cost`, ...; with C2's card on the
 * board, hand cards were squeezed and cut off). Shared utilities live in theme/styles.css only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { declarations } from './css-rules';

const SRC = path.resolve(__dirname, '..', 'src');
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).map((f) => path.join(SRC, f));
const pkgOf = (f: string) => path.relative(SRC, f).split(path.sep)[0]!;

/** Classes a stylesheet styles on their own: the first compound of a selector is one class (plus pseudo-classes or attributes), e.g. `.count`, `.x:hover`. */
function topLevelClasses(css: string): Set<string> {
  const out = new Set<string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}@]+)\{/g)) {
    for (const sel of m[1]!.split(',')) {
      const first = sel.trim().split(/[\s>+~]+/)[0] ?? '';
      const classes = first.match(/\.[A-Za-z][\w-]*/g) ?? [];
      if (first.startsWith('.') && classes.length === 1) out.add(classes[0]!.slice(1));
    }
  }
  return out;
}

/** Every class named anywhere in a stylesheet's selectors (descendant and compound parts too). */
function selectorClasses(css: string): Set<string> {
  const out = new Set<string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}@]+)\{/g)) for (const c of m[1]!.match(/\.[A-Za-z][\w-]*/g) ?? []) out.add(c.slice(1));
  return out;
}

/** Class names written literally in a package's markup (className="..." and the static parts of className={`...`}). */
function usedClasses(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    for (const c of (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (c) out.add(c);
  }
  return out;
}

const defs = new Map<string, Set<string>>();
const uses = new Map<string, Set<string>>();
const named = new Map<string, Set<string>>();
for (const f of files) {
  const pkg = pkgOf(f);
  if (f.endsWith('.css') && pkg !== 'theme') {
    const css = readFileSync(f, 'utf8');
    for (const c of topLevelClasses(css)) defs.set(pkg, (defs.get(pkg) ?? new Set()).add(c));
    for (const c of selectorClasses(css)) named.set(pkg, (named.get(pkg) ?? new Set()).add(c));
  }
  if (f.endsWith('.tsx')) for (const c of usedClasses(readFileSync(f, 'utf8'))) uses.set(pkg, (uses.get(pkg) ?? new Set()).add(c));
}

describe('C6: one stylesheet per package, no global class clashes', () => {
  it('reads every package stylesheet', () => {
    expect([...defs.keys()].sort()).toEqual(expect.arrayContaining(['board', 'cards', 'decks', 'game', 'images', 'prompts']));
    expect(defs.get('board')!.has('board-card')).toBe(true);
  });

  it('no class is styled at the top level by two packages', () => {
    const clashes: string[] = [];
    for (const [a, ca] of defs) for (const [b, cb] of defs) if (a < b) for (const c of ca) if (cb.has(c)) clashes.push(`.${c}: ${a} and ${b}`);
    expect(clashes).toEqual([]);
  });

  it("no package's markup uses a class another package styles at the top level", () => {
    const leaks: string[] = [];
    for (const [user, classes] of uses)
      for (const [owner, styled] of defs) if (owner !== user) for (const c of classes) if (styled.has(c)) leaks.push(`.${c}: used in ${user}, styled by ${owner}`);
    expect(leaks).toEqual([]);
  });

  it("no stylesheet reaches into another package's markup: no selector names a class another package styles (descendant selectors too)", () => {
    const leaks: string[] = [];
    for (const [pkg, classes] of named)
      for (const [owner, styled] of defs) if (owner !== pkg) for (const c of classes) if (styled.has(c)) leaks.push(`.${c}: named in ${pkg}'s CSS, styled by ${owner}`);
    expect(leaks).toEqual([]);
  });

  it("the board sets C2's public custom properties for its card text instead of styling C2's frame: a 7 px floor at board size", () => {
    const board = readFileSync(path.join(SRC, 'board', 'board.css'), 'utf8');
    const cards = readFileSync(path.join(SRC, 'cards', 'cards.css'), 'utf8');
    expect(declarations(board, '.board-card-image')['--card-min-font']).toBe('7px');
    expect(declarations(cards, '.card-frame')['font-size']).toBe('max(var(--card-min-font, 0px), calc(var(--card-w) / 15))');
  });

  it('the board, the card component and the deck screens keep their own card classes (gap 3)', () => {
    for (const c of ['card-slot', 'card-frame', 'card-back', 'mana-cost', 'mana-glyph', 'automation-badge', 'card-image']) {
      expect(defs.get('board')!.has(c), `board .${c}`).toBe(false);
      expect(defs.get('decks')!.has(c), `decks .${c}`).toBe(false);
    }
  });
});
