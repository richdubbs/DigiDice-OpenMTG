/**
 * Merge wave 8, audit D3 guard (docs/audits/2026-10-18-STD.md, risk R3): a decision (`g.choose`, `game.choose`, `cx.g.choose`) asked inside the callback of a
 * search iterator (`find`, `findIndex`, `findLast`, `findLastIndex`, `filter`, `some`, `every`) is asked once for each element the search tests, because a
 * decision is replayed (core/game.ts#choose): riot asked twice and gave neither option (CR 702.136a, 614.12a). Ask the decision once, before the search.
 * This lint reads the engine sources and fails on such a call. (`map` / `forEach` / `flatMap` ask once per element on purpose and are not searched.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT } from '../../m5/helpers';

const SEARCHES = /\.(find|findIndex|findLast|findLastIndex|filter|some|every)\(/g;
const DECISION = /\bchoose\(\s*\{/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** The argument text of the call whose opening parenthesis is at `open` (balanced parentheses; strings and comments are not special-cased, which only errs towards reporting). */
function argumentOf(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

export function decisionsInSearches(text: string): number[] {
  const lines: number[] = [];
  for (const m of text.matchAll(SEARCHES)) {
    const open = m.index! + m[0].length - 1;
    if (DECISION.test(argumentOf(text, open))) lines.push(text.slice(0, m.index).split('\n').length);
  }
  return lines;
}

describe('no decision is asked inside a search iterator callback (audit D3, CR 614.12a)', () => {
  it('the lint finds the shape it guards against', () => {
    expect(decisionsInSearches("const pick = offered.find((x) => x.id === g.choose({ kind: 'chooseOption', player }).ids[0]);")).toEqual([1]);
    expect(decisionsInSearches("const id = g.choose({ kind: 'chooseOption', player }).ids[0];\nconst pick = offered.find((x) => x.id === id);")).toEqual([]);
  });
  it('no engine source has one', () => {
    const found: string[] = [];
    for (const file of sources(SRC_ROOT)) {
      for (const line of decisionsInSearches(readFileSync(file, 'utf8'))) found.push(`${relative(SRC_ROOT, file).split(sep).join('/')}:${line}`);
    }
    expect(found).toEqual([]);
  });
});
