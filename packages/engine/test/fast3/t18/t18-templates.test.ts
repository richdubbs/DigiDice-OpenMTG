/**
 * T18 (FAST3 wave, template family R2-D: effects whose object or amount is a reference: it, them, those, that much, the sacrificed creature): the template
 * data of parser/templates/zz-fast3/t18.json. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations (an appended "unless", "instead", "at random" or "twice", a
 * swapped key word) fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic
 * wordings (design 6.10): no example is a line of a real card (checked against the local index when it is present).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T18 templates compose with every other file.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROMO2_GOLDEN, PROMO2_PROMOTED } from '../../fast5/promo2/evidence';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t18 from '../../../src/parser/templates/zz-fast3/t18.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T18 = t18 as Template[];
const OPTS = defaultParseOptions();
/** A triggered example is a creature's ability (a trigger of an instant never functions, CR 113.6); everything else as the shared helper makes it. */
const cardOf = (t: Template, text: string) =>
  (/^(when|whenever|at)\b/i.test(text) ? { ...exampleCard(t, text), type_line: 'Creature — Spirit', power: '2', toughness: '2' } : exampleCard(t, text));
const parsedWith = (t: Template, text: string) => parseCard(cardOf(t, text), OPTS).faces[0]!;

describe('T18 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast3/t18.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast3/t18.json');
    expect(files.indexOf('zz-fast3/t18.json')).toBeGreaterThan(files.indexOf('zz-fast3/t14.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 5', () => {
    expect(T18.length).toBeGreaterThan(0);
    for (const t of T18) {
      expect(t.id, t.id).toMatch(/^eff\.t18\./);
      expect(t.kind, t.id).toBe('effect');
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(5);
    }
  });
  // design 6.9: a template is stable only with its evidence: three verified golden cards (golden/cards/fast3-t18-review.json)
  const STABLE: Record<string, string[]> = {
    'eff.t18.may.untapRemoveFromCombat': ['Gustcloak Harrier', 'Gustcloak Runner', 'Gustcloak Sentinel', 'Gustcloak Skirmisher'],
    'eff.t18.pump.forEachBlocking': ['Elvish Berserker', 'Gang of Elk', 'Rabid Elephant', 'General Marhault Elsdragon', 'Berserk Murlodont', 'Sparring Golem'],
    'eff.t18.shuffle.self.ownersLibrary': ['Beacon of Destruction', 'Beacon of Unrest', 'Fblthp, the Lost'],
    'eff.t18.counters.eachOfGroup': ['Smile at Death', 'Vrestin, Menoptra Leader', 'Vulture, Feathered Fiend', 'Gideon, the Oathsworn'],
  };
  it('design 6.9: a T18 template is stable only with three verified golden cards; the others are experimental (cards that use them are capped at partial)', () => {
    const golden = (JSON.parse(readFileSync(new URL('../../m5/golden/cards/fast3-t18-review.json', import.meta.url), 'utf8')) as { card: string }[]).map((e) => e.card);
    for (const t of T18) {
      const cards = STABLE[t.id] ?? PROMO2_PROMOTED[t.id]?.golden; // FAST5 PROMO2: promoted after its review (test/fast5/promo2/evidence.ts)
      expect(t.status, t.id).toBe(cards ? 'stable' : 'experimental');
      for (const c of cards ?? []) expect([...golden, ...PROMO2_GOLDEN], `${t.id}: ${c}`).toContain(c);
      if (cards && !PROMO2_PROMOTED[t.id]) expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T18) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T18 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T18) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const sentences = text.split(/(?<=\.)\s+/);
  const body = sentences[0]!.replace(/\.$/, '');
  const rest = sentences.slice(1).join(' ');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\buntap\b/, 'tap'], [/\bblocking\b/, 'attacking'], [/\bowner's\b/, 'controller\'s'], [/\blibrary\b/, 'graveyard'], [/\btarget\b/, 'each'], [/\bgains\b/, 'loses'],
    [/\beach of\b/, 'one of'], [/\bmay\b/, 'must'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => (rest === '' ? m : `${m} ${rest}`));
}

describe('T18 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T18) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T18 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T18) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          // r4-fxb: the kind of a counter is any word (CR 122.1), and eff.fxb.counter.eachOfThem reads "put a <kind> counter on each of them" for every kind
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T18 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura)\b/g, '~').trim());
        }
      }
    }
    const verbatim = T18.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
