/**
 * WP8 review fixes: "never silently do the wrong thing" for triggered abilities. A triggered ability that uses a TargetSpec / ModeSpec field this build does not
 * honor (model/forms.ts, actions/announce.ts#unsupportedForms) is not announced with the field ignored: it is not put on the stack and a `manual` log line names
 * what is missing (CR 603.3c-d = 601.2b-d).
 */
import { describe, expect, it } from 'vitest';
import type { EffectProgram, ModeSpec, TargetSpec } from '../../../src/index';
import { unsupportedForms } from '../../../src/actions/announce';
import { entersSelf, trig, vanilla } from './cards';
import { find, gameOf, move, scenario, settle, stackAbilities, synth } from './helpers';

const creatureSpec = (extra: Partial<TargetSpec> = {}): TargetSpec => ({ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature', ...extra });
const destroyT0 = [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] as const;
const program = (extra: Partial<TargetSpec>): EffectProgram => ({ targets: [creatureSpec(extra)], steps: [...destroyT0] });
const modal = (m: Partial<ModeSpec>, optionExtra: { cost?: never } = {}): EffectProgram => ({
  targets: [],
  steps: [],
  modes: { min: 1, max: 1, options: [{ text: 'You gain 1 life.', program: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] }, ...optionExtra }], ...m },
});
const cheap = { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } } as const;

/**
 * One unsupported field per case, with the capability name `model/forms.ts` gives it. WP7 announces divisions, group limits, distinct targets, target conditions,
 * choosers, player references, and mode choosers, overrides and costs (it claims their `feature:` names), so a triggered ability can use them now (see below);
 * what is left is a computed count that is not the colors, card types or objects of a group (FAST5 T69 announces those), which neither a spell nor a trigger announces.
 */
const CASES: [string, EffectProgram][] = [
  ['feature:count.quantity', program({ max: { q: 'count', of: { ref: 'self' } } as never })],
];

const cardFor = (i: number, p: EffectProgram) => synth({ name: `Test Unsupported ${i}`, cost: '{1}', type: 'Creature — Test', pt: ['1', '1'], abilities: [trig('When ~ enters, do something.', [entersSelf], p)] });

describe('CR 603.3c-d, 601.2b-d: a triggered ability that uses a field this build does not honor is not announced with the field ignored', () => {
  it('the walker-free detector names every case', () => {
    for (const [name, p] of CASES) expect(unsupportedForms(p), name).toContain(name);
  });

  for (const [i, [name, p]] of CASES.entries()) {
    it(`${name}: not put on the stack, no decision asked, logged as manual with the name`, () => {
      const card = cardFor(i, p);
      const s0 = scenario(['Plains'], { defs: [card, vanilla()], p1: { hand: [card.name] }, p2: { battlefield: ['Test Vanilla', 'Test Vanilla'] } });
      const g = gameOf(s0);
      move(g, find(s0, card.name, 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
      const s = settle(g); // would throw NeedDecision if the ability had been announced
      expect(stackAbilities(s)).toEqual([]);
      expect(s.pendingTriggers).toEqual([]);
      const manual = s.log.filter((l) => l.level === 'manual' && l.text.includes(name));
      expect(manual).toHaveLength(1);
      expect(manual[0]!.rules).toContain('CR 603.3');
      expect(manual[0]!.text).toContain(card.name);
    });
  }

  it('control: the same trigger without the unsupported field is announced as before', () => {
    const card = cardFor(99, program({}));
    const s0 = scenario(['Plains'], { defs: [card, vanilla()], p1: { hand: [card.name] }, p2: { battlefield: ['Test Vanilla'] } });
    const target = find(s0, 'Test Vanilla', 'battlefield');
    const g = gameOf(s0, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] }]);
    move(g, find(s0, card.name, 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(stackAbilities(settle(g))).toMatchObject([{ source: card.name, targets: [target] }]);
  });

  it('the features WP7 announces are no longer refused: a divided target is announced with its division (CR 603.3d, 601.2d), stored on the ability', () => {
    const card = cardFor(50, program({ max: 2, divide: { what: 'damage', total: 3 } }));
    const s0 = scenario(['Plains'], { defs: [card, vanilla()], p1: { hand: [card.name] }, p2: { battlefield: ['Test Vanilla', 'Test Vanilla'] } });
    const [t1, t2] = Object.values(s0.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p2').map((o) => o.id);
    expect(unsupportedForms(program({ max: 2, divide: { what: 'damage', total: 3 } }))).toEqual([]);
    const g = gameOf(s0, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: t1! }, { kind: 'object', id: t2! }] }, { kind: 'chooseDivision', amounts: [2, 1] }]);
    move(g, find(s0, card.name, 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    const s = settle(g);
    expect(stackAbilities(s)).toHaveLength(1);
    expect(s.objects[s.zones.stack[0]!]!.stack!.division).toEqual({ t0: [2, 1] });
    expect(s.log.some((l) => l.level === 'manual' && l.text.includes('feature:target.divide'))).toBe(false);
  });

  it('a reflexive ability (CR 603.12) with such a spec is refused the same way', async () => {
    const { putReflexiveTrigger } = await import('../../../src/triggers/stack');
    const s0 = scenario(['Plains'], { defs: [vanilla()], p1: { battlefield: ['Test Vanilla'] } });
    const g = gameOf(s0);
    const mine = find(s0, 'Test Vanilla', 'battlefield');
    const spec = creatureSpec({ max: { q: 'count', of: { ref: 'self' } } as never });
    putReflexiveTrigger(g, { source: { id: mine, zone: 'battlefield' }, controller: 'p1', text: 'When you do, ...', targets: [spec], steps: [...destroyT0] });
    settle(g); // it is put on the stack at the next priority, like every trigger
    expect(g.s.zones.stack).toEqual([]);
    expect(g.s.pendingTriggers).toEqual([]);
    expect(g.s.log.some((l) => l.level === 'manual' && l.text.includes('feature:count.quantity'))).toBe(true);
  });
});
