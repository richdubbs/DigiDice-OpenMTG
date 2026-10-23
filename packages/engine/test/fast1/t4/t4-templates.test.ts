/**
 * FAST1 T4: the template data of parser/templates/zz-fast1/t4.json (triggered and activated ability shapes). Guard G9 (design 6.8): every example lowers
 * with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic
 * wordings (design 6.10). A stable template with fewer than 20 reviewed corpus matches has three hand-verified golden cards (design 6.9:
 * test/m5/golden/cards/fast1-t4-review.json).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with) and the engine's capabilities.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/types/card';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import t4 from '../../../src/parser/templates/zz-fast1/t4.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { loadGolden } from '../../m5/golden/harness';

const T4 = t4 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });

/** The synthetic card an example is written for: an Aura when it enchants, an artifact creature for an activated ability, else a creature. */
function exampleCard(text: string): OracleCard {
  if (/^Enchant /m.test(text)) return card('Example Charm', 'Enchantment — Aura', text);
  if (/^[^"]*\}:/.test(text)) return card('Example Totem', 'Artifact Creature — Golem', text);
  return card('Example Wisp', 'Creature — Spirit', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

/** Templates under 20 reviewed corpus matches that are stable: their evidence is three golden cards (design 6.9). */
const BY_GOLDEN = ['trg.you.cycleOrDiscard', 'eff.return.self.gy.bf', 'eff.mana.additional', 'eff.mana.additional.player', 'eff.mana.additional.any.player'];
/** Stable on 20 or more reviewed corpus matches (FAST1 T4 review: battalion 22; graveyard returns of ~ 50 and 22; the enchanted creature's upkeep 30). */
const BY_REVIEW = ['trg.battalion', 'eff.return.self.gy.hand', 'eff.return.self.gy.bf.tapped', 'trg.upkeep.enchantedController'];
/** p2-promote-1 (6.9 deviation, narrow wordings printed on one or two cards): stable on those cards (fast1-t4-review.json) and the scenarios of test/cloud/p2-promote-1. */
const BY_NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.mana.additional.any': ['Regal Behemoth'],
  'eff.mana.additional.two.player': ['Market Festival', "Dawn's Reflection"],
};

describe('FAST1 T4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler in path order (zz-fast1/ before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast1/t4.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, and is of version 3', () => {
    for (const t of T4) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(3);
      expect(t.id, t.id).toMatch(t.kind === 'trigger' ? /^trg\./ : /^eff\./);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it('design 6.9: the stable templates are the reviewed ones; a stable template under 20 matches has three hand-verified golden cards', () => {
    expect(T4.filter((t) => t.status === 'stable').map((t) => t.id).sort()).toEqual([...BY_GOLDEN, ...BY_REVIEW, ...Object.keys(BY_NARROW)].sort());
    const golden = loadGolden().filter((e) => e.source === 'fast1-t4-review.json');
    for (const id of BY_GOLDEN) expect(golden.filter((e) => (e.verified ?? '').includes(`(${id})`)).length, id).toBeGreaterThanOrEqual(3);
    for (const [id, cards] of Object.entries(BY_NARROW)) expect(golden.filter((e) => (e.verified ?? '').includes(`(${id})`)).map((e) => e.card).sort(), id).toEqual([...cards].sort());
  });
});

describe('FAST1 T4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T4) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [[/\bat least two\b/, 'at least three'], [/\byour graveyard\b/, "an opponent's graveyard"], [/\badditional\b/, 'extra'], [/\bupkeep of\b/, 'draw step of'],
    [/\byou cycle or discard\b/, 'you cycle'], [/\btapped\b/, 'untapped'], [/\bcontroller\b/, 'owner']];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('FAST1 T4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T4) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('FAST1 T4 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T4) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('FAST1 T4 design 6.10: examples are synthetic', () => {
  it('no example or counter-example line is a line of a real card (with the card\'s own name or "this <noun>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|card|permanent)\b/g, '~').trim());
        }
      }
    }
    const verbatim = T4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !/^Enchant \w+$/.test(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
