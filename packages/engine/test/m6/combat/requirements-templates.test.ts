/**
 * M6-7: the template data of parser/templates/zz-m6/requirements.json (attack and block requirements that name the other creature, and the resolved ones
 * with a duration) and the renderer readings it needed (design 6.8 G6: render/stat.ts#requirementWithOther). Guard G9 (design 6.8): every example lowers
 * with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so these templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import { renderGate } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import requirements from '../../../src/parser/templates/zz-m6/requirements.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const REQ = requirements as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('M6-7 template file (design m6 4.2, m5 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-m6/requirements.json, path order: after zz-fast2/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-m6/requirements.json');
    expect(files.indexOf('zz-m6/requirements.json')).toBeGreaterThan(files.indexOf('zz-fast2/t9.json'));
    expect(files.indexOf('zz-m6/requirements.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is stable (three verified golden cards each, test/m5/golden/cards/m6-7-review.json) and of version 5', () => {
    expect(REQ.map((t) => t.id)).toEqual(['sta.must.lure', 'eff.must.lure', 'eff.must.block.other', 'eff.must.attack', 'eff.must.each.attack', 'eff.must.block', 'eff.must.beblocked']);
    for (const t of REQ) {
      expect(['effect', 'static'], t.id).toContain(t.kind);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(5);
    }
  });

  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of REQ) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('M6-7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of REQ) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bthis turn\b/, 'next turn'], [/\btarget\b/i, 'each'], [/\bblocks\b/, 'attacks'], [/\battacks\b/, 'blocks'], [/\bblock\b/, 'attack'], [/\battack\b/, 'block'],
    [/\bif able\b/, 'if it can'], [/\bdo so\b/, 'may do so'], [/\bAll creatures\b/, 'All other creatures'], [/\bmust\b/, "can't"], [/\bopponents\b/, 'teammates'],
    [/\bartifact creature\b/, 'enchantment creature'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('M6-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of REQ) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('M6-7 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of REQ) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const eot = { d: 'endOfTurn' };
const T0 = { id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } };
const T1 = { ...T0, id: 't1' };
const spell = (targets: unknown[], effects: unknown[]): AbilityDef => ({ kind: 'spell', text: '', effect: { targets, steps: [{ op: 'effect', duration: eot, effects }] } } as unknown as AbilityDef);
const gate = (def: AbilityDef, oracle: string, selfTypes = ['Sorcery']): boolean => renderGate(def, [oracle], { selfNames: ['Test Card'], selfTypes }).ok;
const EACH_CREATURE = { ref: 'each', filter: { types: ['Creature'] } };

describe('M6-7 renderer readings (design 6.8 G6): each new reading means exactly its JSON', () => {
  it('CR 509.1c: "All creatures able to block X do so" is each creature\'s block requirement naming X; "X must be blocked if able" is not', () => {
    const lure = { kind: 'static', text: '', effects: [{ s: 'restrict', subject: EACH_CREATURE, mode: 'mustIfAble', action: 'block', other: { is: { ref: 'self' } } }] } as unknown as AbilityDef;
    const plain = { kind: 'static', text: '', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'mustIfAble', action: 'beBlocked' }] } as unknown as AbilityDef;
    expect(gate(lure, 'All creatures able to block Test Card do so.', ['Creature'])).toBe(true);
    expect(gate(plain, 'All creatures able to block Test Card do so.', ['Creature'])).toBe(false);
    expect(gate(lure, 'Test Card must be blocked if able.', ['Creature'])).toBe(false);
  });

  it('CR 509.1c, 611.2a: "blocks target creature this turn if able" names the second target; without `other` it is "blocks this turn if able"', () => {
    const named = spell([T0, T1], [{ s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'mustIfAble', action: 'block', other: { is: { ref: 'target', id: 't1' } } }]);
    const any = spell([T0], [{ s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'mustIfAble', action: 'block' }]);
    expect(gate(named, 'Target creature blocks target creature this turn if able.')).toBe(true);
    expect(gate(named, 'Target creature blocks this turn if able.')).toBe(false);
    expect(gate(any, 'Target creature blocks this turn if able.')).toBe(true);
    expect(gate(any, 'Target creature blocks target creature this turn if able.')).toBe(false);
  });

  it('CR 508.1d, 611.2a: "attacks this turn if able" is a requirement until end of turn; "attacks each combat if able" (a static) is not that', () => {
    const def = spell([T0], [{ s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'mustIfAble', action: 'attack' }]);
    expect(gate(def, 'Target creature attacks this turn if able.')).toBe(true);
    expect(gate(def, 'Target creature blocks this turn if able.')).toBe(false);
    expect(gate(def, 'Target creature attacks each combat if able.')).toBe(false);
  });

  it('CR 509.1c: a requirement whose `other` is a filter (not one object) has no wording here: refused, never rendered as something else', () => {
    const def = spell([T0], [{ s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'mustIfAble', action: 'block', other: { subtypes: ['Wall'] } }]);
    expect(gate(def, 'Target creature blocks a Wall this turn if able.')).toBe(false);
    expect(gate(def, 'Target creature blocks this turn if able.')).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('M6-7 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = REQ.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
