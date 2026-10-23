/**
 * WP7: activation restrictions (CR 602.5b: onlyIf with the controller's attestation, "only once" per game), the announcement-time evaluators, and the generic
 * mana reduction of CR 118.7a.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, GameState, Quantity } from '../../../src/index';
import { announceCond, announceQty, announceReadable } from '../../../src/actions/announce-cond';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import { reduceGeneric } from '../../../src/rules/payment-options';
import { cloneState } from '../../../src/util/clone';
import { act, activated, answer, find, legal, passBoth, reject, scenario, synth } from '../helpers';
import { drive, mana } from './support';

const gadget = (extra: Parameters<typeof activated>[3]) => synth({ name: 'Test Gadget', type: 'Artifact', abilities: [activated('Do it.', {}, [], extra)] });

const withBoard = (extra: Parameters<typeof activated>[3], battlefield: string[] = []): { s: GameState; id: string } => {
  const s = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Test Gadget', ...battlefield] }, p2: { battlefield: ['Hill Giant'] }, defs: [gadget(extra)] });
  return { s, id: find(s, 'Test Gadget', 'battlefield') };
};

describe('CR 602.5b: "Activate only once" per game (exhaust)', () => {
  it('the second activation is not offered; a new object (CR 400.7) has its use back', () => {
    const { s: s0, id } = withBoard({ limit: { per: 'game', max: 1 } });
    expect(legal(s0, 'p1', 'activate')).toHaveLength(1);
    const s1 = passBoth(drive(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }), [])); // it resolves
    expect(legal(s1, 'p1', 'activate')).toEqual([]);
    expect(reject(s1, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }).message).toContain('only once');
    // CR 400.7: the permanent leaves the battlefield and comes back as a new object, which has not been used.
    const g = new Game(cloneState(s1));
    const inHand = moveObject(g, id, 'hand')!;
    const again = moveObject(g, inHand, 'battlefield', { controller: 'p1' })!;
    expect(again).not.toBe(id);
    expect(legal(g.s, 'p1', 'activate').map((a) => a.object)).toEqual([again]);
  });
});

describe('CR 602.5b: onlyIf — the engine checks what it can read and the controller attests the rest', () => {
  it('a readable condition is evaluated against the board: "only if you control a creature"', () => {
    const only: Condition = { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } };
    const { s: without } = withBoard({ onlyIf: only });
    expect(legal(without, 'p1', 'activate')).toEqual([]);
    const { s: withCreature } = withBoard({ onlyIf: only }, ['Grizzly Bears']);
    expect(legal(withCreature, 'p1', 'activate')).toHaveLength(1);
  });

  it('an `ask` restriction is attested when the ability is activated: yes goes on, no refuses and cancel takes it back', () => {
    const { s: s0, id } = withBoard({ onlyIf: { cond: 'ask', text: 'You control three or more Gadgets.' } });
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    expect(s.pending).toMatchObject({ kind: 'yesNo', cancellable: true, prompt: expect.stringContaining('Gadgets') });
    const no = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'yesNo', yes: false } });
    expect(no.message).toContain('does not hold');
    s = drive(answer(s, { kind: 'yesNo', yes: true }), []);
    expect(s.zones.stack).toHaveLength(1);
  });
});

describe('announce-time evaluators (CR 601.2b-f)', () => {
  const { s, id } = withBoard({}, ['Grizzly Bears']);
  const env = { s, player: 'p1' as const, sourceId: id, costsPaid: { kicked: 1, additional: ['kicker'] }, x: 3, castFrom: 'hand' as const };

  it('quantities: numbers, X, arithmetic, counts of the board, life and zone sizes', () => {
    const q = (v: Quantity) => announceQty(env, v);
    expect(q(4)).toBe(4);
    expect(q({ q: 'X' })).toBe(3);
    expect(q({ q: 'math', op: '+', args: [{ q: 'X' }, 2] })).toBe(5);
    expect(q({ q: 'math', op: 'floorDiv', args: [7, 2] })).toBe(3);
    expect(q({ q: 'count', of: { ref: 'each', filter: { types: ['Creature'] } } })).toBe(2);
    expect(q({ q: 'life', of: { ref: 'you' } })).toBe(20);
    expect(q({ q: 'zoneSize', zone: 'battlefield', of: { ref: 'you' } })).toBe(s.zones.battlefield.length);
    expect(q({ q: 'dieResult' })).toBeUndefined(); // can't be read here: refused, not guessed
  });

  it('conditions are three-valued: unknown parts make `all` / `any` unknown unless another part decides', () => {
    const unknown: Condition = { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' }; // cloud std-tdm: this turn's history is read; last turn's is not
    const yes: Condition = { cond: 'wasCast', kicked: true };
    const no: Condition = { cond: 'wasCast', via: 'evoke' };
    expect(announceCond(env, { cond: 'all', of: [yes, unknown] })).toBeUndefined();
    expect(announceCond(env, { cond: 'all', of: [no, unknown] })).toBe(false);
    expect(announceCond(env, { cond: 'any', of: [yes, unknown] })).toBe(true);
    expect(announceCond(env, { cond: 'any', of: [no, unknown] })).toBeUndefined();
    expect(announceCond(env, { cond: 'not', of: no })).toBe(true);
    expect(announceCond(env, { cond: 'wasCast', xAtLeast: 3 })).toBe(true);
    expect(announceCond(env, { cond: 'wasCast', xAtLeast: 4 })).toBe(false);
    expect(announceCond(env, { cond: 'wasCast', from: 'hand' })).toBe(true);
    expect(announceCond(env, { cond: 'turnOf', whose: 'you', step: 'main1' })).toBe(true);
    expect(announceCond(env, { cond: 'turnOf', whose: 'opponent' })).toBe(false);
    expect(announceCond(env, { cond: 'compare', left: { q: 'X' }, op: '>=', right: 3 })).toBe(true);
  });

  it('announceReadable is a static check: `ask` only where an attestation is possible', () => {
    expect(announceReadable({ cond: 'ask', text: 'x' })).toBe(false);
    expect(announceReadable({ cond: 'ask', text: 'x' }, true)).toBe(true);
    expect(announceReadable({ cond: 'all', of: [{ cond: 'wasCast', kicked: true }, { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' }] })).toBe(false);
  });
});

describe('CR 118.7a: a generic reduction touches only the generic component', () => {
  it('colored symbols stay; the reduction stops at zero and reports how much it removed', () => {
    const cost = mana('{3}{R}{R}');
    expect(reduceGeneric(cost, 2)).toEqual({ mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'R' }, { kind: 'colored', color: 'R' }], removed: 2 });
    expect(reduceGeneric(cost, 9)).toEqual({ mana: [{ kind: 'colored', color: 'R' }, { kind: 'colored', color: 'R' }], removed: 3 });
  });
});
