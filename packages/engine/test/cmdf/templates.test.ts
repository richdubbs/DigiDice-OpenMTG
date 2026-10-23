/**
 * CMDF (Commander follow-ups): the templates of parser/templates/zz-m11/cmdf.json. Guard G9 (design 6.8 of the milestone 5 design): every example lowers with
 * its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations
 * fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are invented wordings (design 6.10).
 * Also the parse of "when you cast your commander" (parser/holes/event.ts, CR 903.3d) and "~ can be your commander" on a spell face (CR 113.6n, 903.3a).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../src/parser/types';
import { compileCard, type CardDef, type OracleCard } from '../../src/index';
import { defaultParseOptions, parseCard } from '../../src/parser/parse';
import { validateTemplates } from '../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../src/parser/template-set';
import cmdf from '../../src/parser/templates/zz-m11/cmdf.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../m5/templates/support';

const CMDF = cmdf as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const synth = (name: string, type: string, text: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{1}', type_line: type, oracle_text: text, colors: [] } as unknown as OracleCard);
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

describe('CMDF template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-m11/cmdf.json, before zz-m11/commander.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-m11/cmdf.json')).toBe(files.indexOf('zz-m11/commander.json') - 1);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has two examples and two counter-examples, is namespaced m11 and of version 8', () => {
    expect(CMDF.map((t) => t.id)).toEqual([
      'eff.m11.token.forEachCommanderCast', 'eff.m11.pump.forEachCommanderCast', 'sta.m11.anthem.aCommanderCasts', 'sta.m11.enters.counter.forEachCommanderCast',
      'sta.m11.enters.counters.nForEachCommanderCast', 'sta.m11.spells.less.forEachCommanderCast', 'sta.m11.deckConstruction.canBeCommander',
    ]);
    for (const t of CMDF) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.m11\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.cr.some((cr) => cr.startsWith('CR 903')), t.id).toBe(true);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });

  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of CMDF) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'must', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('CMDF guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of CMDF) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\byour commander\b/, "an opponent's commander"], [/\ba commander\b/, 'a creature'], [/\bthe command zone\b/, 'your graveyard'], [/\byou've cast\b/, 'an opponent has cast'],
    [/\bthis game\b/, 'this turn'], [/\bless\b/, 'more'], [/\byou cast\b/, 'your opponents cast'], [/\bcan be\b/, "can't be"],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('CMDF guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of CMDF) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('CMDF guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of CMDF) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual or different`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsedWith(t, mutated);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), mutated).toBe(false);
        });
      }
    });
  }
});

describe('CMDF: the hole-grammar readings', () => {
  it('CR 903.3d, 903.3e: "When you cast your commander, ..." is a cast trigger of a commander spell you own; "an opponent casts their commander" is not read', () => {
    const d = synth('Test Bell', 'Enchantment', 'When you cast your commander, draw a card.');
    expect(full(d)).toBe(true);
    expect(JSON.stringify((d.faces[0]!.abilities[0] as { trigger: unknown }).trigger)).toBe('{"on":[{"ev":"cast","player":"you","spell":{"commander":true,"owner":"you"}}]}');
    expect(full(synth('Test Bell', 'Enchantment', 'Whenever you cast your commanders, draw a card.'))).toBe(false);
    expect(full(synth('Test Bell', 'Enchantment', 'Whenever an opponent casts your commander, draw a card.'))).toBe(false);
  });

  it('CR 113.6n, 903.3a: "~ can be your commander" on a legendary sorcery is a static ability of its own (it functions before the game, in no zone)', () => {
    const d = compileCard({ name: 'Test Bond', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Legendary Sorcery', oracle_text: 'Draw a card.\nTest Bond can be your commander.', colors: [] } as unknown as OracleCard);
    expect(full(d), JSON.stringify(d.automation)).toBe(true);
    expect(d.faces[0]!.abilities.map((a) => a.kind)).toEqual(['spell', 'static']);
    expect(JSON.stringify(d.faces[0]!.abilities[1])).toContain('{"s":"deckConstruction","rule":"canBeCommander"}');
  });
});
