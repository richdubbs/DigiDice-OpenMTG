/**
 * Review round on model/canonical.ts and model/strip.ts: one JSON per meaning (design 5.3) for defaults and unordered lists, and hydration of nested
 * abilities.
 */
import { describe, expect, it } from 'vitest';
import { canonicalize, hydrateAbility, stripAbility, type FaceLines } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const c = (x: J): J => canonicalize(ab(x)) as unknown as J;
const spell = (steps: J[]): J => ({ kind: 'spell', text: 'x', effect: { targets: [], steps } });
const stepsOf = (x: J): J[] => ((x['effect'] as J)['steps'] as J[]);

describe('CR 113.6: an ability zone equal to the default battlefield is not written', () => {
  const trig = (extra: J): J => ({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'draw' }] }, effect: { targets: [], steps: [] }, ...extra });
  it('triggered, activated and static abilities with zone ["battlefield"] equal the same ability without it', () => {
    expect(c(trig({ zone: ['battlefield'] }))).toEqual(c(trig({})));
    expect(c(trig({ zone: ['battlefield'] }))['zone']).toBeUndefined();
    const act = (extra: J): J => ({ kind: 'activated', text: 'x', cost: { tap: true }, effect: { targets: [], steps: [] }, ...extra });
    expect(c(act({ zone: ['battlefield'] }))).toEqual(c(act({})));
    const stat = (extra: J): J => ({ kind: 'static', text: 'x', effects: [{ s: 'rule', rule: 'maxHandSize', value: 'none' }], ...extra });
    expect(c(stat({ zone: ['battlefield'] }))).toEqual(c(stat({})));
  });
  it('another zone, or several, is kept (sorted)', () => {
    expect(c(trig({ zone: ['graveyard'] }))['zone']).toEqual(['graveyard']);
    expect(c(trig({ zone: ['stack', 'battlefield'] }))['zone']).toEqual(['battlefield', 'stack']);
  });
});

describe('addMana.units: the types of one mana and the units are unordered (design 5.3)', () => {
  const mana = (units: string[][]): J => spell([{ op: 'addMana', who: { ref: 'you' }, units }]);
  it('[["W","U"]] and [["U","W"]] have one canonical form, in WUBRG order', () => {
    expect(c(mana([['W', 'U']]))).toEqual(c(mana([['U', 'W']])));
    expect(stepsOf(c(mana([['G', 'W', 'G']])))[0]!['units']).toEqual([['W', 'G']]);
  });
  it('the order of the units does not matter either, colorless last', () => {
    expect(c(mana([['G'], ['R'], ['C']]))).toEqual(c(mana([['C'], ['R'], ['G']])));
    expect(stepsOf(c(mana([['C'], ['G'], ['R']])))[0]!['units']).toEqual([['R'], ['G'], ['C']]);
  });
});

describe('delay.capture is a set of names', () => {
  it('["b","a"] and ["a","b"] have one form', () => {
    const d = (capture: string[]): J => spell([{ op: 'draw', who: { ref: 'you' }, count: 1, as: 'a' }, { op: 'draw', who: { ref: 'you' }, count: 1, as: 'b' }, { op: 'delay', when: { at: 'endOfCombat' }, capture, do: [] }]);
    expect(c(d(['b', 'a']))).toEqual(c(d(['a', 'b'])));
  });
});

describe('property: shuffling the order of unordered lists of the worked examples does not change the canonical form', () => {
  /** Reverse every array of single-mana-type lists and every list of mana types: the meaning does not change. */
  const shuffleMana = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(shuffleMana);
    if (v && typeof v === 'object') {
      const o = v as J;
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, k === 'units' && Array.isArray(x) ? [...x].reverse().map((u) => (Array.isArray(u) ? [...u].reverse() : u)) : shuffleMana(x)]));
    }
    return v;
  };
  it('all worked examples', () => {
    for (const e of EXAMPLES) for (const a of e.faces.flatMap((f) => f.abilities)) expect(canonicalize(shuffleMana(a) as AbilityDef), e.name).toEqual(canonicalize(a));
  });
});

describe('hydration of an ability nested in a node (a granted ability has no line of its own)', () => {
  it('the nested ability is not given the text of the whole enclosing line', () => {
    const sneak = EXAMPLES.find((e) => e.name === 'Sneak Attack')!.faces[0]!.abilities;
    const line = '{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice it at the beginning of the next end step.';
    const lines: FaceLines = { lines: [line], sentences: [line.split(/(?<=\.)\s/)] };
    const withSrc = sneak.map((a) => ({ ...a, src: [0] }) as AbilityDef);
    const stored = stripAbility(withSrc[0]!);
    const back = hydrateAbility(stored, lines, 'h', 'h');
    expect(back).not.toBeNull();
    const texts: string[] = [];
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') {
        const o = v as J;
        if (o['kind'] === 'keyword' && o['keyword'] === 'haste') texts.push(String(o['text']));
        Object.values(o).forEach(visit);
      }
    };
    visit(back);
    expect(texts).toEqual(['']);
    expect((back as unknown as J)['text']).toBe(line);
  });
});
