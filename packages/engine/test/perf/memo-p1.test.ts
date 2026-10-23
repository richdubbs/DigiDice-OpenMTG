/**
 * Package P1 (engine performance): the compile-side memos give exactly what a fresh computation gives.
 *  - parser/chart.ts: a template array seen for the first time with the same templates in the same order reuses the compiled grammar; another order, a
 *    missing template or a different template object compiles again.
 *  - parser/parse-memo.ts: the same card content and options parse once; the result is frozen and equal to a fresh parse; other options or another card
 *    parse again.
 *  - cards/compile-memo.ts: `compileCard(card)` answers a card compiled before with its own copy, equal to a fresh compile.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, compileCardV2, defaultCompileSources, parseCard, type OracleCard, type ParseOptions } from '../../src/index';
import { compileCardDetailed } from '../../src/cards/pipeline';
import { compileTemplates } from '../../src/parser/chart';
import { TEMPLATE_SET } from '../../src/parser/template-set';
import { getCard } from '../fixtures';

describe('P1 parser/chart.ts: compiled grammars by template identity', () => {
  it('a new array with the same templates in the same order reuses the grammar; another order or set compiles its own', () => {
    const a = [...TEMPLATE_SET];
    const g = compileTemplates(a);
    expect(compileTemplates([...TEMPLATE_SET])).toBe(g);
    const without = TEMPLATE_SET.filter((_, i) => i !== 3);
    const h = compileTemplates(without);
    expect(h).not.toBe(g);
    expect(h.prods.length).toBeLessThan(g.prods.length);
    expect(compileTemplates([...without])).toBe(h);
    const reversed = [...TEMPLATE_SET].reverse();
    expect(compileTemplates(reversed)).not.toBe(g);
    // a copy of a template is another template (it may be edited): compiled again
    const copied = TEMPLATE_SET.map((t, i) => (i === 0 ? { ...t } : t));
    expect(compileTemplates(copied)).not.toBe(g);
  });

  it('a reused grammar is the grammar a fresh compile builds: same productions in order, words and errors', () => {
    const strip = (c: ReturnType<typeof compileTemplates>) => ({ prods: c.prods.map(({ tpl, ...p }) => ({ ...p, tpl: tpl?.id })), errors: c.errors, words: [...c.words] });
    for (const keep of [(i: number) => i % 3 !== 0, (i: number) => i !== 7]) {
      const subset = TEMPLATE_SET.filter((_, i) => keep(i));
      const first = compileTemplates([...subset]);
      expect(compileTemplates([...subset])).toBe(first);
      // a fresh compile: new template objects are not the cached ones
      const fresh = compileTemplates(subset.map((t) => ({ ...t })));
      expect(fresh).not.toBe(first);
      expect(strip(first)).toEqual(strip(fresh));
    }
  });
});

const NAMES = ['Lightning Bolt', 'Serra Angel', 'Fire // Ice', 'Bonecrusher Giant // Stomp', 'Chandra, Torch of Defiance', 'Kitchen Finks', 'Pacifism', 'Delver of Secrets // Insectile Aberration'];

describe('P1 parser/parse-memo.ts: a card parsed again with the same options is parsed once', () => {
  const opts: ParseOptions = defaultCompileSources().parse;

  it('same content and options: the same frozen result, equal to a parse with fresh options', () => {
    for (const name of NAMES) {
      const card = getCard(name);
      const r1 = parseCard(card, opts);
      const r2 = parseCard(structuredClone(card), opts);
      expect(r2, name).toBe(r1);
      expect(Object.isFrozen(r1)).toBe(true);
      expect(Object.isFrozen(r1.faces[0]!.abilities)).toBe(true);
      const fresh = parseCard(card, { ...opts }); // another options object: parsed again
      expect(fresh).not.toBe(r1);
      expect(JSON.stringify(fresh), name).toBe(JSON.stringify(r1));
    }
  });

  it('other options (another template array, a capability added in place, a budget) parse again', () => {
    const card = getCard('Lightning Bolt');
    const caps = new Set(opts.capabilities);
    const o: ParseOptions = { ...opts, capabilities: caps, templates: [...opts.templates] };
    const r = parseCard(card, o);
    expect(parseCard(card, o)).toBe(r);
    o.templates.pop();
    expect(parseCard(card, o)).not.toBe(r);
    const r2 = parseCard(card, o);
    caps.add('test:p1');
    expect(parseCard(card, o)).not.toBe(r2);
    expect(parseCard(card, { ...o, budget: 5 })).not.toBe(parseCard(card, o));
  });

  it('an edited card (another oracle text) is parsed again', () => {
    const card: OracleCard = { ...getCard('Lightning Bolt') };
    const r = parseCard(card, opts);
    card.oracle_text = 'Lightning Bolt deals 2 damage to any target.';
    const r2 = parseCard(card, opts);
    expect(r2).not.toBe(r);
    expect(JSON.stringify(r2)).not.toBe(JSON.stringify(r));
  });
});

describe('P1 cards/compile-memo.ts: compileCard(card) copies a definition compiled before', () => {
  it('each call returns its own copy, equal to a fresh compile through the pipeline', () => {
    for (const name of NAMES) {
      const card = getCard(name);
      const a = compileCard(card);
      const b = compileCard(structuredClone(card));
      expect(b).not.toBe(a);
      expect(b.faces).not.toBe(a.faces);
      expect(JSON.stringify(b), name).toBe(JSON.stringify(a));
      expect(JSON.stringify(compileCardV2(card, defaultCompileSources())), name).toBe(JSON.stringify(a));
      // editing what one caller got changes nothing for the next one
      (a.faces[0] as { name: string }).name = 'Edited';
      a.faces[0]!.abilities.length = 0;
      expect(JSON.stringify(compileCard(card))).toBe(JSON.stringify(b));
    }
  });

  it('keys with undefined values survive the copy (a copy is the same object shape as a fresh compile)', () => {
    const card = getCard('Fire // Ice');
    const fresh = compileCardV2(card, defaultCompileSources());
    compileCard(card);
    const copied = compileCard(card);
    const keys = (x: unknown): string[] => (x !== null && typeof x === 'object' ? Object.keys(x).flatMap((k) => [k, ...keys((x as Record<string, unknown>)[k]).map((s) => `${k}.${s}`)]) : []);
    expect(keys(copied)).toEqual(keys(fresh));
  });
});

/** Every path inside `x` to an object or array that is frozen ('' is `x` itself). */
function frozenPaths(x: unknown, path = ''): string[] {
  if (x === null || typeof x !== 'object') return [];
  const here = Object.isFrozen(x) ? [path] : [];
  return [...here, ...Object.keys(x).flatMap((k) => frozenPaths((x as Record<string, unknown>)[k], `${path}.${k}`))];
}

describe('P1 compile outputs stay the caller\'s own mutable data (as before P1), whatever the call history', () => {
  it('compileCardV2 / compileCardDetailed: nothing frozen, and two compiles share no ability object (none comes from the frozen parse memo)', () => {
    for (const name of NAMES) {
      const card = getCard(name);
      const sources = defaultCompileSources();
      const a = compileCardV2(card, sources);
      const b = compileCardV2(card, sources);
      const d = compileCardDetailed(card, sources);
      expect(frozenPaths(a), name).toEqual([]);
      expect(frozenPaths(d.def), name).toEqual([]);
      expect(frozenPaths(d.report), name).toEqual([]);
      a.faces.forEach((f, i) => f.abilities.forEach((ab, k) => expect(ab, `${name} ${i}/${k}`).not.toBe(b.faces[i]!.abilities[k])));
    }
  });

  it('compileCard: the first compile of a card and every later one are equally mutable and equally the caller\'s own', () => {
    for (const name of NAMES) {
      const card = { ...getCard(name), oracle_id: `p1-fresh-${name}` }; // content never compiled before in this process: the first call is a memo miss
      const first = compileCard(card);
      const second = compileCard(card);
      expect(frozenPaths(first), name).toEqual([]);
      expect(frozenPaths(second), name).toEqual([]);
      const ab = first.faces[0]!.abilities[0];
      if (ab !== undefined) (ab as { text: string }).text = 'edited';
      expect(JSON.stringify(compileCard(card)), name).toBe(JSON.stringify(second)); // the edit reached neither the memo nor the parse memo
    }
  });
});
