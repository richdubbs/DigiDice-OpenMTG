/**
 * FAST2 T9: the template data of parser/templates/zz-fast2/t9.json (continuous effects: until-end-of-turn P/T, abilities, types and colors; P/T statics and
 * lords) and the renderer readings it needed (design 6.8 G6: render/mods.ts, render/stat.ts, render/steps-lasting.ts, render/fold.ts, render/refs.ts,
 * render/np.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example
 * does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an
 * automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T9 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import { renderGate } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t9 from '../../../src/parser/templates/zz-fast2/t9.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T9 = t9 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast2/t9.json, path order) and its ids are unique in the whole set', () => {
    expect(TEMPLATE_FILES.some((f) => f.file === 'zz-fast2/t9.json')).toBe(true);
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-fast2/t9.json')).toBeGreaterThan(files.indexOf('zz-fast1/t6.json'));
    expect(files.indexOf('zz-fast2/t9.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 4 (FAST2)', () => {
    expect(T9.length).toBe(24);
    for (const t of T9) {
      expect(['effect', 'static'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(eff|sta)\.t9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(4);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T9) {
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
    [/\buntil end of turn\b/, 'until your next turn'], [/\bthis turn\b/, 'next turn'], [/\btarget\b/i, 'each'], [/\bcan't\b/, 'can'], [/\bgets\b/, 'gains'],
    [/\bloses\b/, 'gains'], [/\bbecomes\b/, 'is'], [/\bbecome\b/, 'are'], [/\bother\b/, 'another'], [/\bchosen\b/, 'named'], [/\bdefender\b/, 'flying'],
    [/\byour choice\b/, 'their choice'], [/\bartifact creature\b/, 'enchantment creature'], [/\bwith\b/, 'without'], [/\bits power\b/, 'its toughness'],
    [/\bmay have\b/, 'have'], [/\bin your hand\b/, 'in your graveyard'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T9) {
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

describe('T9 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T9) {
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

/** One ability that is a single resolved effect step (an activated ability with cost {1}). */
const activated = (steps: unknown[]): AbilityDef => ({ kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps } } as unknown as AbilityDef);
const gate = (def: AbilityDef, oracle: string, selfTypes = ['Creature']): boolean => renderGate(def, [oracle], { selfNames: ['Test Card'], selfTypes }).ok;
const eot = { d: 'endOfTurn' };
const goblins = { q: 'count', of: { ref: 'each', filter: { other: true, attacking: true, subtypes: ['Goblin'] } } };

describe('T9 renderer readings (design 6.8 G6): each new reading means exactly its JSON', () => {
  it('CR 613.4c: "+2/+0 for each other attacking Goblin" is 2 times the count; "+1/+0" is not', () => {
    const def = activated([{ op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'math', op: '*', args: [2, goblins] } }] }] }]);
    expect(gate(def, '{1}: Test Card gets +2/+0 until end of turn for each other attacking Goblin.')).toBe(true);
    expect(gate(def, '{1}: Test Card gets +1/+0 until end of turn for each other attacking Goblin.')).toBe(false);
  });
  it('CR 107.3: "-X/-X, where X is ..." is the negated quantity; the positive wording is not', () => {
    const hand = { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } };
    const neg = { q: 'math', op: '*', args: [-1, hand] };
    const def = activated([{ op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: neg, toughness: neg }] }] }]);
    expect(gate(def, '{1}: Test Card gets -X/-X until end of turn, where X is the number of cards in your hand.')).toBe(true);
    expect(gate(def, '{1}: Test Card gets +X/+X until end of turn, where X is the number of cards in your hand.')).toBe(false);
  });
  it('CR 205.1b: card types added while the creature type is set need "It\'s still a land."; "artifact creature" needs nothing', () => {
    const becomes = (types: string[]) => activated([{ op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { add: types }, subtypes: { set: ['Elemental'] } }, { layer: '7b', power: 5, toughness: 5 }] }] }]);
    expect(gate(becomes(['Creature']), '{1}: Test Card becomes a 5/5 Elemental creature until end of turn.', ['Land'])).toBe(false);
    expect(gate(becomes(['Creature']), "{1}: Test Card becomes a 5/5 Elemental creature until end of turn. It's still a land.", ['Land'])).toBe(true);
    expect(gate(becomes(['Artifact', 'Creature']), '{1}: Test Card becomes a 5/5 Elemental artifact creature until end of turn.', ['Artifact'])).toBe(true);
  });
  it('CR 115.1: "each" after a plural target subject only; not after a single target', () => {
    const one = { kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } };
    const def = (spec: Record<string, unknown>): AbilityDef => ({ kind: 'spell', text: '', effect: { targets: [{ id: 't0', ...spec }], steps: [{ op: 'effect', duration: eot, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }] } } as unknown as AbilityDef);
    expect(gate(def({ ...one, min: 2, max: 2 }), 'Two target creatures each get +1/+1 until end of turn.', ['Instant'])).toBe(true);
    expect(gate(def(one), 'Target creature each gets +1/+1 until end of turn.', ['Instant'])).toBe(false);
  });
  it('CR 109.2: "Other Zombie creatures get +1/+1" is every other Zombie, not only yours', () => {
    const lord = (filter: Record<string, unknown>): AbilityDef => ({ kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'each', filter }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] } as unknown as AbilityDef);
    expect(gate(lord({ other: true, subtypes: ['Zombie'], types: ['Creature'] }), 'Other Zombie creatures get +1/+1.')).toBe(true);
    expect(gate(lord({ other: true, subtypes: ['Zombie'], types: ['Creature'], controller: 'you' }), 'Other Zombie creatures get +1/+1.')).toBe(false);
  });
  it('CR 404.1: "in all graveyards" is a card in any graveyard; "your graveyard" is not', () => {
    const cda = (filter: Record<string, unknown>): AbilityDef => {
      const q = { q: 'count', of: { ref: 'each', filter } };
      return { kind: 'static', text: '', effects: [{ s: 'continuous', cda: true, affects: { ref: 'self' }, mods: [{ layer: '7a', power: q, toughness: q }] }] } as unknown as AbilityDef;
    };
    const oracle = "Test Card's power and toughness are each equal to the number of creature cards in all graveyards.";
    expect(gate(cda({ types: ['Creature'], zone: 'graveyard', isCard: true }), oracle)).toBe(true);
    expect(gate(cda({ types: ['Creature'], zone: 'graveyard', isCard: true, owner: 'you' }), oracle)).toBe(false);
  });
  it('CR 509.1b: "can\'t block ~" is a ban on blocking the source only', () => {
    const ban = (other: Record<string, unknown> | undefined): AbilityDef => ({ kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } }], steps: [{ op: 'effect', duration: eot, effects: [{ s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'cant', action: 'block', ...(other ? { other } : {}) }] }] } } as unknown as AbilityDef);
    expect(gate(ban({ self: true }), "{1}: Target creature can't block Test Card this turn.")).toBe(true);
    expect(gate(ban(undefined), "{1}: Target creature can't block Test Card this turn.")).toBe(false);
  });
});

const index = localIndex();

/** The one line of another template an example needs as it is: the producer of "the chosen type" (rep.enters.choose.creaturetype, CR 607.2d). */
const SHARED_LINES = new Set(['As ~ enters, choose a creature type.']);

describe.skipIf(index === null)('T9 design 6.10: examples are synthetic', () => {
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
    const verbatim = T9.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SHARED_LINES.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
