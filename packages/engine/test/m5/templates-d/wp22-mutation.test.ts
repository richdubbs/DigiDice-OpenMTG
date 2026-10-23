/**
 * WP22 near-miss and nonsense-word mutations (design 6.8 guards G2, G3, G9). Every example of every WP22 template is mutated mechanically; a mutation must
 * never parse to the SAME automated JSON as the example (that would mean the template ignores the words that changed), and an invented word must never
 * leave an automated ability at all (G2: closed vocabulary).
 *
 *   unless    "... unless you control a Swamp." appended: a condition no template of the sentence states (G1, G3)
 *   instead   "... instead." appended: a replacement word the template does not consume (G3)
 *   number    the first digit changed: the value must come from a hole, never be a constant of the build (G9)
 *   target    "target" swapped for "each", and for "all" (G9)
 *   each/all  "each" swapped for "all" and "all" for "each" (G9)
 *   up to     "up to" inserted before the first count or "target" (G9: a chosen number is not a fixed one, CR 601.2c)
 *   negate    the first verb negated with "doesn't" / "don't" (or "can't" turned into "can"): the opposite meaning (G9)
 *   duration  the duration dropped: a resolved effect with no duration would last forever (CR 611.2a), so it must not parse the same (G9)
 *   nonsense  each content word, one at a time, replaced by an invented word (G2). The word in front of "counter(s)" is excluded: counter names are an
 *             open class by design (6.11, WP6's CounterKind hole).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { parseUnit } from '../../../src/parser/chart';
import { adaptTokens, canonicalJson } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import { WP22_TEMPLATES, automated, exampleCard, face, meaning, options } from './support';

const opts = options();
const parse = (t: Template, text: string) => face(exampleCard(t, text), opts);
const beforePeriod = (text: string, insert: string): string => (text.endsWith('.') ? `${text.slice(0, -1)}${insert}.` : `${text}${insert}`);

function nearMisses(text: string): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  out.push({ kind: 'unless', text: beforePeriod(text, ' unless you control a Swamp') });
  out.push({ kind: 'instead', text: beforePeriod(text, ' instead') });
  const digit = /\d/.exec(text);
  if (digit) out.push({ kind: 'number', text: text.slice(0, digit.index) + String((Number(digit[0]) + 1) % 10) + text.slice(digit.index + 1) });
  if (/\btarget\b/i.test(text)) {
    out.push({ kind: 'target', text: text.replace(/\btarget\b/i, (w) => keepCase(w, 'each')) });
    out.push({ kind: 'target', text: text.replace(/\btarget\b/i, (w) => keepCase(w, 'all')) });
  }
  if (/\beach\b/i.test(text)) out.push({ kind: 'each/all', text: text.replace(/\beach\b/i, (w) => keepCase(w, 'all')) });
  if (/\ball\b/i.test(text)) out.push({ kind: 'each/all', text: text.replace(/\ball\b/i, (w) => keepCase(w, 'each')) });
  // a count ("a", "two", "3", "X") or "target" (as "up to one target"); not a signed P/T, a mana symbol or an amount of life
  const count = /\b(?:target|a|an|one|two|three|four|five|six|seven|eight|nine|(?<![-+/{])\d+|X)\b(?! life\b)/i.exec(text);
  if (count) {
    const what = count[0].toLowerCase() === 'target' ? 'one target' : count.index === 0 ? count[0].toLowerCase() : count[0];
    out.push({ kind: 'up to', text: `${text.slice(0, count.index)}${count.index === 0 ? 'Up to' : 'up to'} ${what}${text.slice(count.index + count[0].length)}` });
  }
  const negated = negate(text);
  if (negated !== null) out.push({ kind: 'negate', text: negated });
  for (const d of [' until end of turn', ' this turn', ' until your next turn']) if (text.includes(d)) out.push({ kind: 'duration', text: text.replace(d, '') });
  return out;
}

/** `to` with the case of the first letter of `like`. */
const keepCase = (like: string, to: string): string => (/^[A-Z]/.test(like) ? to.charAt(0).toUpperCase() + to.slice(1) : to);

/** Verbs and their "doesn't" / "don't" forms: the first one in the text is negated. */
const NEGATIONS: [RegExp, string][] = [
  [/\bcan't\b/, 'can'], [/\bgets\b/, "doesn't get"], [/\bget\b/, "don't get"], [/\bhas\b/, "doesn't have"], [/\bhave\b/, "don't have"],
  [/\bgains\b/, "doesn't gain"], [/\bgain\b/, "don't gain"], [/\benters\b/, "doesn't enter"], [/\bcosts\b/, "doesn't cost"], [/\bcost\b/, "don't cost"],
  [/\bloses\b/, "doesn't lose"], [/\blose\b/, "don't lose"], [/\bbecomes\b/, "doesn't become"], [/\battacks\b/, "doesn't attack"], [/\bblocks\b/, "doesn't block"],
  [/\bdoesn't untap\b/, 'untaps'], [/\bmay\b/, "don't"], [/\bmust\b/, "doesn't have to"], [/\bis\b/, "isn't"], [/\bare\b/, "aren't"],
];

function negate(text: string): string | null {
  let best: { at: number; re: RegExp; to: string } | null = null;
  for (const [re, to] of NEGATIONS) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, re, to };
  }
  return best === null ? null : text.replace(best.re, best.to);
}

function nonsense(text: string): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  words.forEach((w, i) => {
    const bare = w.replace(/[.,:'"]+$/g, '').replace(/'s$/, '');
    if (!/^[A-Za-z][A-Za-z-]{2,}$/.test(bare)) return;
    if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // CounterKind: open class (design 6.11)
    out.push(words.map((x, k) => (k === i ? x.replace(bare, 'Zorblat') : x)).join(' '));
  });
  return out;
}

describe('WP22 near-miss mutations never give the same automated JSON (design 6.8 G9)', () => {
  for (const t of WP22_TEMPLATES) {
    it(`${t.id}: unless / instead / number / target / each-all / up to / negate / duration mutations of every example`, () => {
      for (const e of t.examples) {
        const base = parse(t, e.text);
        for (const m of nearMisses(e.text)) {
          const f = parse(t, m.text);
          const same = automated(f.abilities) && meaning(f.abilities) === meaning(base.abilities);
          expect(same, `${m.kind}: ${m.text}`).toBe(false);
        }
      }
    });
  }
});

describe('WP22 nonsense-word mutations never leave an automated ability (design 6.8 G2)', () => {
  for (const t of WP22_TEMPLATES) {
    it(`${t.id}: every content word of every example replaced by an invented word`, () => {
      for (const e of t.examples) {
        for (const m of nonsense(e.text)) {
          const f = parse(t, m);
          expect(automated(f.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('the mutation harness itself: what it would catch is also refused by the render gate (design 6.8 G6 behind G9)', () => {
  it('design 6.8 G9: it generates every near-miss the design lists (append unless, swap target/each/all, add instead, insert up to, negate with "don\'t", drop the duration)', () => {
    const kinds = new Set(['Target creature gets +2/+2 until end of turn.', 'Each creature you control gets +1/+0.', 'All creatures get -1/-0 until end of turn.'].flatMap((x) => nearMisses(x).map((m) => m.kind)));
    expect([...kinds].sort()).toEqual(['duration', 'each/all', 'instead', 'negate', 'number', 'target', 'unless', 'up to']);
    expect(nearMisses('Target creature gets +2/+2 until end of turn.').map((m) => m.text)).toEqual(expect.arrayContaining([
      'Each creature gets +2/+2 until end of turn.', 'All creature gets +2/+2 until end of turn.', 'Up to one target creature gets +2/+2 until end of turn.',
      "Target creature doesn't get +2/+2 until end of turn.",
    ]));
    expect(nearMisses('All creatures get -1/-0 until end of turn.').map((m) => m.text)).toEqual(expect.arrayContaining(['Each creatures get -1/-0 until end of turn.', "All creatures don't get -1/-0 until end of turn."]));
  });
  it('a test template whose build hard-codes +3/+3 parses "+4/+3" at the chart level to the same JSON as "+3/+3" (the number mutation flags it), and the exact gate refuses it', () => {
    const bad: Template = {
      id: 'test.wp22.bad', kind: 'effect', cr: ['CR 613.4c'], pattern: '{o:Obj} gets {pt:PT} {d:Dur}', subject: 'object',
      build: { op: 'effect', duration: '$d', effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: '7c', power: 3, toughness: 3 }] }] },
      examples: [{ text: 'Target creature gets +3/+3 until end of turn.' }], counterExamples: ['a', 'b'], status: 'experimental', since: 1,
    };
    const env = { lexicon: opts.lexicon, keywords: opts.keywords };
    const chartValue = (text: string): string => {
      const r = parseUnit({ tokens: adaptTokens(tokenize(text)), templates: [bad], env, goal: 'effects' });
      return r.status === 'ok' ? canonicalJson(r.derivation.value) : r.status;
    };
    const m = nearMisses('Target creature gets +3/+3 until end of turn.').find((x) => x.kind === 'number')!;
    expect(m.text).toBe('Target creature gets +4/+3 until end of turn.');
    expect(chartValue(m.text)).toBe(chartValue('Target creature gets +3/+3 until end of turn.'));
    const f = face(exampleCard(bad, m.text), options([], { templates: [bad] }));
    expect(automated(f.abilities)).toBe(false);
    expect(f.diagnostics.some((d) => d.code === 'gate-mismatch')).toBe(true);
  });
});
