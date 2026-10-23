/**
 * FAST3 T13: the template data of parser/templates/zz-fast3/t13.json (type, color and ability changes and their choices: layers 4-6 resolved effects and Aura
 * statics) and the renderer readings it needed (design 6.8 G6: render/fold.ts#choiceThenEffect and #choicePump, render/mods.ts, render/np.ts). Guard G9
 * (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T13 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import { renderGate } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t13 from '../../../src/parser/templates/zz-fast3/t13.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T13 = t13 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast3/t13.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast3/t13.json');
    expect(files.indexOf('zz-fast3/t13.json')).toBeGreaterThan(files.indexOf('zz-fast2/t9.json'));
    expect(files.indexOf('zz-fast3/t13.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 5 (FAST3)', () => {
    expect(T13.length).toBe(17);
    for (const t of T13) {
      expect(['effect', 'static'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(eff|sta)\.t13\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(5);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T13) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T13 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T13) {
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
    [/\buntil end of turn\b/i, 'until your next turn'], [/\btarget\b/i, 'each'], [/\bgets\b/, 'gains'], [/\bloses\b/, 'gains'], [/\blose\b/, 'gain'],
    [/\bbecomes\b/, 'is'], [/\byour choice\b/, 'their choice'], [/\bartifact creature\b/, 'enchantment creature'], [/\bwith\b/, 'without'],
    [/\bbasic land type\b/, 'land type'], [/\bcreature type\b/, 'card type'], [/\bmana value\b/, 'power'], [/\ball abilities\b/, 'flying'],
    [/\bor\b/, 'and'], [/\bforestwalk\b/, 'mountainwalk'], [/\bislandwalk\b/, 'plainswalk'], [/\bswampwalk\b/, 'desertwalk'], [/\bEnchanted land is\b/, 'Enchanted land has'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T13) {
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

describe('T13 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T13) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

/** One activated ability with cost {1} whose effect is these steps. */
const activated = (steps: unknown[], targets: unknown[] = []): AbilityDef => ({ kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets, steps } } as unknown as AbilityDef);
const gate = (def: AbilityDef, oracle: string, selfTypes = ['Creature']): boolean => renderGate(def, [oracle], { selfNames: ['Test Card'], selfTypes }).ok;
const eot = { d: 'endOfTurn' };
const land = [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Land'] } }];

describe('T13 renderer readings (design 6.8 G6): each new reading means exactly its JSON', () => {
  const choose = (what: string, options?: string[]) => ({ op: 'chooseValue', who: { ref: 'you' }, what, ...(options ? { options } : {}), as: 'pick', link: 'pick' });
  const setChosen = (affects: unknown) => ({ op: 'effect', duration: eot, effects: [{ s: 'continuous', affects, mods: [{ layer: 4, subtypes: { chosen: 'pick', chosenSets: true } }] }] });
  const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

  it('CR 305.7, 608.2d: "becomes the basic land type of your choice" is a choice among the five basic land types that SETS the subtype', () => {
    const def = activated([choose('landType', BASICS), setChosen({ ref: 'target', id: 't0' })], land);
    expect(gate(def, '{1}: Target land becomes the basic land type of your choice until end of turn.', ['Creature'])).toBe(true);
    // any land type is not "basic"; a type that joins the others is "in addition to its other types"
    expect(gate(activated([choose('landType'), setChosen({ ref: 'target', id: 't0' })], land), '{1}: Target land becomes the basic land type of your choice until end of turn.')).toBe(false);
    const adds = activated([choose('landType', BASICS), { op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: 4, subtypes: { chosen: 'pick' } }] }] }], land);
    expect(gate(adds, '{1}: Target land becomes the basic land type of your choice until end of turn.')).toBe(false);
  });
  it('CR 205.1a, 608.2d: "becomes the creature type of your choice"; a choice another player makes is not "your choice"', () => {
    expect(gate(activated([choose('creatureType'), setChosen({ ref: 'self' })]), '{1}: Test Card becomes the creature type of your choice until end of turn.')).toBe(true);
    const theirs = activated([{ ...choose('creatureType'), who: { ref: 'anOpponent' } }, setChosen({ ref: 'self' })]);
    expect(gate(theirs, '{1}: Test Card becomes the creature type of your choice until end of turn.')).toBe(false);
  });
  it('CR 608.2d: the fold needs the effect to use the choice; a later step that reads it is not covered', () => {
    const unused = activated([choose('creatureType'), { op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }]);
    expect(gate(unused, '{1}: Test Card gets +1/+1 until end of turn.')).toBe(false);
    const readLater = activated([choose('creatureType'), setChosen({ ref: 'self' }), { op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], chosen: { link: 'pick', quality: 'creatureType' } } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }]);
    expect(gate(readLater, '{1}: Test Card becomes the creature type of your choice until end of turn. Creatures of the creature type of your choice get +1/+1 until end of turn.')).toBe(false);
  });
  it('CR 608.2d, 613.4c: "creatures of the creature type of your choice get +0/+3"', () => {
    const pump = (filter: Record<string, unknown>) => activated([choose('creatureType'), { op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'each', filter }, mods: [{ layer: '7c', power: 0, toughness: 3 }] }] }]);
    expect(gate(pump({ types: ['Creature'], chosen: { link: 'pick', quality: 'creatureType' } }), '{1}: Creatures of the creature type of your choice get +0/+3 until end of turn.')).toBe(true);
    expect(gate(pump({ types: ['Creature'], controller: 'you', chosen: { link: 'pick', quality: 'creatureType' } }), '{1}: Creatures of the creature type of your choice get +0/+3 until end of turn.')).toBe(false);
  });
  it('CR 608.2d, 613.4c: "gets +1/-1 or -1/+1": one branch per listed option, in order, each exactly that change', () => {
    const branch = (equals: string, p: number, t: number) => ({ op: 'if', cond: { cond: 'chosen', link: 'pick', equals }, then: [{ op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: p, toughness: t }] }] }] });
    const oracle = '{1}: Test Card gets +1/-1 or -1/+1 until end of turn.';
    expect(gate(activated([choose('option', ['+1/-1', '-1/+1']), branch('+1/-1', 1, -1), branch('-1/+1', -1, 1)]), oracle)).toBe(true);
    expect(gate(activated([choose('option', ['+1/-1', '-1/+1']), branch('+1/-1', 1, -1), branch('-1/+1', -1, 2)]), oracle)).toBe(false);
    expect(gate(activated([choose('option', ['+1/-1', '-1/+1']), branch('+1/-1', 1, -1)]), oracle)).toBe(false);
  });
  it('CR 205.1b, 613.4b: "becomes an artifact creature with power and toughness each equal to its mana value" needs no "still a land" rider', () => {
    const mv = { q: 'stat', stat: 'manaValue', of: { ref: 'target', id: 't0' } };
    const animate = (types: Record<string, unknown>) => activated([{ op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: 4, types }, { layer: '7b', power: mv, toughness: mv }] }] }],
      [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Artifact'], notTypes: ['Creature'] } }]);
    const oracle = '{1}: Target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value until end of turn.';
    expect(gate(animate({ add: ['Artifact', 'Creature'] }), oracle)).toBe(true);
    expect(gate(animate({ add: ['Creature'] }), oracle)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T13 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle|permanent)\b/gi, '~').trim());
        }
      }
    }
    const shared = new Set(['Enchant land', 'Enchant creature']);
    const verbatim = T13.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !shared.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
