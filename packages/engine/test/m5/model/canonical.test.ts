/**
 * The canonical form (design 5.3): one JSON per meaning. Idempotent; insensitive to key order and to the order of the arrays whose order means
 * nothing; removes the defaults the model has (and no other); never touches the actors or the order of anything executed.
 */
import { describe, expect, it } from 'vitest';
import { canonicalize, validateAbility } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const c = (x: J): J => canonicalize(ab(x)) as unknown as J;
const spell = (steps: J[], targets: J[] = [], extra: J = {}): J => ({ kind: 'spell', text: 'x', effect: { targets, steps, ...extra } });
const tap = (filter: J): J => ({ op: 'tap', what: { ref: 'each', filter } });
const stepsOf = (x: J): J[] => ((x['effect'] as J)['steps'] as J[]);
const filterOf = (x: J): J => (((stepsOf(x)[0]!['what']) as J)['filter'] as J);

/** The same JSON with the keys of every object in reverse order. */
const reversed = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v;

describe('canonicalize', () => {
  it('is idempotent and keeps the ability valid, for every worked example', () => {
    for (const ex of EXAMPLES) {
      for (const a of ex.faces.flatMap((f) => f.abilities)) {
        const once = canonicalize(a);
        expect(canonicalize(once), ex.name).toEqual(once);
        expect(validateAbility(once), ex.name).toEqual([]);
      }
    }
  });
  it('does not depend on the order of the keys of the input', () => {
    for (const ex of EXAMPLES) {
      for (const a of ex.faces.flatMap((f) => f.abilities)) {
        expect(JSON.stringify(canonicalize(reversed(a) as AbilityDef)), ex.name).toBe(JSON.stringify(canonicalize(a)));
      }
    }
  });
  it('writes the discriminator first, then the other keys alphabetically; drops undefined', () => {
    const out = c(spell([{ op: 'draw', who: { ref: 'you' }, count: 1, as: 'd', guard: undefined }]));
    expect(Object.keys(out)).toEqual(['kind', 'effect', 'text']);
    expect(Object.keys(stepsOf(out)[0]!)).toEqual(['op', 'as', 'count', 'who']);
  });
  it('does not modify its input', () => {
    const input = spell([tap({ types: ['Land', 'Artifact'], zone: 'battlefield' })]);
    const before = JSON.stringify(input);
    c(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('sorts the sets: types, subtypes, keywords, zones, colors in WUBRG order; removes duplicates', () => {
    const f = filterOf(c(spell([tap({ types: ['Land', 'Artifact', 'Land'], subtypes: ['Zombie', 'Elf'], colors: ['G', 'W', 'B'], notColors: ['R', 'U'], keyword: ['reach', 'flying'], zone: ['graveyard', 'battlefield'] })])));
    expect(f).toMatchObject({ types: ['Artifact', 'Land'], subtypes: ['Elf', 'Zombie'], colors: ['W', 'B', 'G'], notColors: ['U', 'R'], keyword: ['flying', 'reach'], zone: ['battlefield', 'graveyard'] });
  });
  it('a one-element keyword or zone list takes its scalar form', () => {
    const f = filterOf(c(spell([tap({ keyword: ['flying'], notKeyword: ['reach'], zone: ['graveyard'] })])));
    expect(f).toMatchObject({ keyword: 'flying', notKeyword: 'reach', zone: 'graveyard' });
  });
  it('removes the defaults the model has: a filter\'s battlefield zone, a library destination\'s top, a chooser that is the controller', () => {
    expect(filterOf(c(spell([tap({ zone: 'battlefield', types: ['Land'] })])))).toEqual({ types: ['Land'] });
    const lib = c(spell([{ op: 'move', what: { ref: 'self' }, to: { zone: 'library', position: 'top' } }]));
    expect(stepsOf(lib)[0]!['to']).toEqual({ zone: 'library' });
    const bottom = c(spell([{ op: 'move', what: { ref: 'self' }, to: { zone: 'library', position: 'bottom' } }]));
    expect((stepsOf(bottom)[0]!['to'] as J)['position']).toBe('bottom');
    const t = c(spell([], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'p', chooser: { ref: 'you' } }, { id: 't1', kind: 'player', min: 1, max: 1, text: 'p', chooser: { ref: 'anOpponent' } }]));
    const targets = (t['effect'] as J)['targets'] as J[];
    expect(targets[0]).not.toHaveProperty('chooser');
    expect(targets[1]!['chooser']).toEqual({ ref: 'anOpponent' });
  });
  it('the zone of a zone-change pattern\'s subject is ignored by the engine (design 3.3), so it is dropped', () => {
    const t = c({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'zoneChange', subject: { zone: 'graveyard', types: ['Creature'] }, to: 'battlefield' }] }, effect: { targets: [], steps: [] } });
    expect(((t['trigger'] as J)['on'] as J[])[0]!['subject']).toEqual({ types: ['Creature'] });
  });
  it('removes an optional flag that is false, but never inside a filter, where false means "not" (untapped, not a token)', () => {
    const out = c({ kind: 'activated', text: 'x', isMana: false, sorcerySpeed: false, cost: { other: [{ kind: 'discard', count: 1, random: false, self: false }] }, effect: { targets: [], steps: [{ op: 'createToken', who: { ref: 'you' }, count: 1, tapped: false, token: { name: 'x', types: ['Creature'] } }, tap({ tapped: false, token: false })] } });
    expect(out).not.toHaveProperty('isMana');
    expect(out).not.toHaveProperty('sorcerySpeed');
    expect(((out['cost'] as J)['other'] as J[])[0]).toEqual({ kind: 'discard', count: 1 });
    expect(stepsOf(out)[0]).not.toHaveProperty('tapped');
    expect(filterOf({ ...out, effect: { ...(out['effect'] as J), steps: [stepsOf(out)[1]!] } })).toEqual({ tapped: false, token: false });
  });
  it('NEVER removes an actor: who, source, caster, payer and a battlefield controller stay, even when they are "you"', () => {
    const out = c(spell([{ op: 'draw', who: { ref: 'you' }, count: 1 }, { op: 'damage', source: { ref: 'self' }, to: { ref: 'self' }, amount: 1 }, { op: 'move', what: { ref: 'self' }, to: { zone: 'battlefield', controller: { ref: 'you' } } }]));
    const steps = stepsOf(out);
    expect(steps[0]!['who']).toEqual({ ref: 'you' });
    expect(steps[1]!['source']).toEqual({ ref: 'self' });
    expect((steps[2]!['to'] as J)['controller']).toEqual({ ref: 'you' });
    const cm = c({ kind: 'static', text: 'x', effects: [{ s: 'costMod', applies: { spells: { types: ['Creature'] }, caster: 'you' }, change: { kind: 'reduce', generic: 1 } }] });
    expect((((cm['effects'] as J[])[0]!['applies']) as J)['caster']).toBe('you');
  });

  it('conditions: single-element all/any collapse, nested all flattens, not-not cancels, operands are sorted', () => {
    const a = { cond: 'turnOf', whose: 'you' };
    const b = { cond: 'wasCast', kicked: true };
    const g = (cond: J): J => (stepsOf(c(spell([{ op: 'draw', who: { ref: 'you' }, count: 1, guard: cond }])))[0]!['guard'] as J);
    expect(g({ cond: 'all', of: [a] })).toEqual(a);
    expect(g({ cond: 'any', of: [{ cond: 'any', of: [b] }] })).toEqual(b);
    expect(g({ cond: 'all', of: [b, { cond: 'all', of: [a, b] }] })).toEqual({ cond: 'all', of: [a, b].sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)) });
    expect(g({ cond: 'not', of: { cond: 'not', of: a } })).toEqual(a);
    expect(g({ cond: 'all', of: [b, a] })).toEqual(g({ cond: 'all', of: [a, b] }));
  });
  it('filters: a lone anyOf of one filter is that filter; anyOf operands are sorted and deduplicated', () => {
    expect(filterOf(c(spell([tap({ anyOf: [{ types: ['Land'] }] })])))).toEqual({ types: ['Land'] });
    expect(filterOf(c(spell([tap({ anyOf: [{ types: ['Land'] }, { types: ['Artifact'] }, { types: ['Land'] }] })])))).toEqual({ anyOf: [{ types: ['Artifact'] }, { types: ['Land'] }] });
    expect(filterOf(c(spell([tap({ anyOf: [{ types: ['Land'] }, { types: ['Artifact'] }] })])))).toEqual(filterOf(c(spell([tap({ anyOf: [{ types: ['Artifact'] }, { types: ['Land'] }] })]))));
  });
  it('quantities: commutative math sorts its operands and a lone operand collapses; subtraction keeps its order', () => {
    const q = (m: J): unknown => stepsOf(c(spell([{ op: 'draw', who: { ref: 'you' }, count: m }])))[0]!['count'];
    expect(q({ q: 'math', op: '+', args: [{ q: 'X' }, 1] })).toEqual(q({ q: 'math', op: '+', args: [1, { q: 'X' }] }));
    expect(q({ q: 'math', op: 'max', args: [{ q: 'X' }] })).toEqual({ q: 'X' });
    expect(q({ q: 'math', op: '-', args: [{ q: 'X' }, 1] })).toEqual({ q: 'math', op: '-', args: [{ q: 'X' }, 1] });
    expect(q({ q: 'math', op: '-', args: [1, { q: 'X' }] })).toEqual({ q: 'math', op: '-', args: [1, { q: 'X' }] });
  });
  it('NEVER reorders what is executed: steps, cost parts and mana symbols keep their order', () => {
    const out = c({ kind: 'activated', text: 'x', cost: { mana: [{ kind: 'colored', color: 'U' }, { kind: 'generic', amount: 2 }], other: [{ kind: 'payLife', amount: 1 }, { kind: 'discard', count: 1 }] }, effect: { targets: [], steps: [{ op: 'scry', who: { ref: 'you' }, count: 1 }, { op: 'draw', who: { ref: 'you' }, count: 1 }] } });
    expect((out['cost'] as J)['mana']).toEqual([{ kind: 'colored', color: 'U' }, { kind: 'generic', amount: 2 }]);
    expect(((out['cost'] as J)['other'] as J[]).map((p) => p['kind'])).toEqual(['payLife', 'discard']);
    expect(stepsOf(out).map((s) => s['op'])).toEqual(['scry', 'draw']);
  });
  it('leaves display data, src and provenance alone', () => {
    const out = c({ kind: 'spell', text: 'Draw.', label: 'L', src: [2, 1], prov: { by: 'llm', reviewed: false }, effect: { targets: [], steps: [] } });
    expect(out).toMatchObject({ text: 'Draw.', label: 'L', src: [2, 1], prov: { by: 'llm', reviewed: false } });
  });
  it('two spellings of one meaning have one canonical form', () => {
    const one = c(spell([tap({ types: ['Land', 'Artifact'], keyword: ['flying'], zone: 'battlefield' })]));
    const two = c(spell([tap({ zone: ['battlefield'], keyword: 'flying', types: ['Artifact', 'Land'] })]));
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});
