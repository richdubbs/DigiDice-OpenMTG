/**
 * WP8: conditions at trigger time (CR 603.4 intervening "if", CR 603.8 state triggers), judged with the event in hand. The interpreter's evaluator (WP4) is used
 * for every condition it knows; the local one covers the rest and answers `undefined` ("cannot tell") rather than guess.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, GameState } from '../../../src/index';
import { holds, interveningIfHolds, localCondition, type CondEnv } from '../../../src/triggers/cond';
import { announcer, configureTriggers, conditionEvaluator } from '../../../src/triggers/wiring';
import { vanilla } from './cards';
import { find, gameOf, scenario, tweak } from './helpers';

const start = (): GameState => scenario(['Plains'], {
  defs: [vanilla(), vanilla('Test Other', ['3', '3'])],
  p1: { battlefield: ['Test Vanilla', 'Plains', 'Plains'], hand: ['Test Other'] },
  p2: { battlefield: ['Test Other'] },
});

const envFor = (s: GameState, name = 'Test Vanilla'): CondEnv => ({ source: { id: find(s, name, 'battlefield'), zone: 'battlefield' }, controller: 'p1', event: null });
const check = (s: GameState, c: Condition, env = envFor(s)): boolean | undefined => localCondition(gameOf(s), c, env);

describe('the conditions of triggers that need no resolution context', () => {
  const s = start();
  const creatures: Condition = { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } };

  it('exists / compare over what is on the battlefield', () => {
    expect(check(s, creatures)).toBe(true);
    expect(check(s, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, atLeast: 2 })).toBe(false);
    expect(check(s, { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } }, op: '>=', right: 2 })).toBe(true);
    expect(check(s, { cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '==', right: 20 })).toBe(true);
    expect(check(s, { cond: 'compare', left: { q: 'math', op: '+', args: [1, 2, { q: 'count', of: { ref: 'self' } }] }, op: '==', right: 4 })).toBe(true);
  });

  it('boolean structure, three-valued: one unknown part makes an "and" unknown unless another part is false', () => {
    const unknown: Condition = { cond: 'madeUp' } as unknown as Condition; // WP4 evaluates every condition of the model now; a name outside it stays unknown
    expect(check(s, { cond: 'all', of: [creatures, { cond: 'not', of: creatures }] })).toBe(false);
    expect(check(s, { cond: 'any', of: [creatures, unknown] })).toBe(true);
    expect(check(s, { cond: 'all', of: [creatures, unknown] })).toBeUndefined();
    expect(check(s, { cond: 'all', of: [{ cond: 'not', of: creatures }, unknown] })).toBe(false);
    expect(check(s, { cond: 'not', of: unknown })).toBeUndefined();
  });

  it('matches against the source or the event, turnOf, designations', () => {
    expect(check(s, { cond: 'matches', object: { ref: 'self' }, filter: { types: ['Creature'] } })).toBe(true);
    expect(check(s, { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } })).toBe(false);
    expect(check(s, { cond: 'turnOf', whose: 'you' })).toBe(true);
    expect(check(s, { cond: 'turnOf', whose: 'opponent' })).toBe(false);
    expect(check(s, { cond: 'turnOf', whose: 'you', step: ['main1', 'main2'] })).toBe(true);
    expect(check(s, { cond: 'turnOf', whose: 'you', step: 'end' })).toBe(false);
    expect(check(s, { cond: 'designation', who: { ref: 'you' }, what: 'monarch' })).toBe(false);
    expect(check(tweak(s, (t) => { t.designations.monarch = 'p1'; }), { cond: 'designation', who: { ref: 'you' }, what: 'monarch' })).toBe(true);
    const withEvent: CondEnv = { ...envFor(s), event: { ev: 'zoneChange', roles: { subject: { objects: [{ id: find(s, 'Test Other', 'battlefield', 'p2'), zone: 'battlefield' }] } }, before: {} } };
    expect(check(s, { cond: 'matches', object: { ref: 'event', role: 'subject' }, filter: { controller: 'opponent' } }, withEvent)).toBe(true);
  });

  it('cast history of the permanent (CR 400.7d, 607.2i): kicked, from where, X', () => {
    const kicked = tweak(s, (t) => { t.objects[find(t, 'Test Vanilla', 'battlefield')]!.cast = { costsPaid: { kicked: 1 }, from: 'hand', x: 3, turn: 1 }; });
    expect(check(kicked, { cond: 'wasCast', kicked: true })).toBe(true);
    expect(check(kicked, { cond: 'wasCast', kicked: false })).toBe(false);
    expect(check(kicked, { cond: 'wasCast', from: 'hand', xAtLeast: 3 })).toBe(true);
    expect(check(kicked, { cond: 'wasCast', xAtLeast: 4 })).toBe(false);
    expect(check(s, { cond: 'wasCast', kicked: true })).toBe(false); // put onto the battlefield, not cast
  });

  it('things that need a resolution context or a person are unknown, never guessed', () => {
    expect(check(s, { cond: 'did', step: 'a' })).toBeUndefined();
    expect(check(s, { cond: 'ask', text: 'Is it Tuesday?' })).toBeUndefined();
    expect(check(s, { cond: 'compare', left: { q: 'X' }, op: '>=', right: 1 })).toBeUndefined();
  });
});

describe('the interpreter\'s evaluator wins when it knows the condition', () => {
  it('holds() asks the wired evaluator first; an unknown condition falls back to the local one', () => {
    const s = start();
    const g = gameOf(s);
    const before = conditionEvaluator();
    const asked: string[] = [];
    configureTriggers({
      announcer: announcer(),
      conditions: { knows: (c) => c.cond === 'turnOf', evaluate: (_cx, c) => { asked.push(c.cond); return false; } },
    });
    try {
      expect(holds(g, { cond: 'turnOf', whose: 'you' }, envFor(s))).toBe(false); // the local evaluator would say true
      expect(holds(g, creaturesExist, envFor(s))).toBe(true); // not known by the wired one: local
      expect(asked).toEqual(['turnOf']);
    } finally {
      configureTriggers({ announcer: announcer(), ...(before ? { conditions: before } : {}) });
    }
  });

  it('interveningIfHolds: no condition holds; an unknown one is not false', () => {
    const s = start();
    const g = gameOf(s);
    expect(interveningIfHolds(g, undefined, envFor(s))).toBe(true);
    expect(interveningIfHolds(g, { cond: 'madeUp' } as unknown as Condition, envFor(s))).toBe(true);
    expect(interveningIfHolds(g, { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } }, envFor(s))).toBe(false);
  });
});

const creaturesExist: Condition = { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'] } } };
