/**
 * r5-cost: a cost increase in life (`CostModDef.change.life`, actions/cast.ts#modifiedPlan), played with synthetic cards (design 6.10).
 *
 *   CR 601.2c, 601.2f, 119.4   "Spells your opponents cast that target ~ cost an additional 2 life to cast.": the targets are chosen before the total cost, which
 *                              then includes 2 life; a spell that doesn't target it costs no life; a player with less life than that can't pay it (CR 119.4)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, answer, card, drive, find, full, lifeOf, named, obj, resolveAll, scenario } from './support';

const DRAKE = card('Test Peak Drake', 'Creature — Dragon', 'Flying\nSpells your opponents cast that target this creature cost an additional 2 life to cast.', '{0}', ['3', '3']);
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to any target.', '{0}');
const DEFS = [DRAKE, ZAP];

/** p2 casts the Zap at `target` during p1's main phase (p1 passes priority first). */
function zapBy2(s0: GameState, target: { kind: 'object'; id: string } | { kind: 'player'; id: string }): GameState {
  const s1 = act(s0, { type: 'pass', player: 'p1' });
  return drive(act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Zap', 'hand', 'p2') }), { targets: [[target]] });
}

describe('r5-cost: a cost increase in life', () => {
  it('the card is automated', () => expect(full(DRAKE)).toBe(true));

  it('CR 601.2f, 119.4: an opponent\'s spell that targets it costs 2 life more', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Peak Drake'] }, p2: { hand: ['Test Zap'] } });
    const drake = find(s0, 'Test Peak Drake', 'battlefield', 'p1');
    const s = resolveAll(zapBy2(s0, obj(drake)));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(named(s, 'Test Peak Drake')).toHaveLength(0);
  });

  it('CR 601.2f: a spell that targets something else costs no life', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Peak Drake'] }, p2: { hand: ['Test Zap'] } });
    const s = resolveAll(zapBy2(s0, { kind: 'player', id: 'p1' }));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(17);
  });

  it('CR 119.4, 601.2h: with 1 life the opponent can\'t pay 2 life, so the cast at the Drake is refused', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Peak Drake'] }, p2: { hand: ['Test Zap'] } });
    const low: GameState = { ...s0, players: s0.players.map((p) => (p.id === 'p2' ? { ...p, life: 1 } : p)) };
    const drake = find(low, 'Test Peak Drake', 'battlefield', 'p1');
    const s1 = act(low, { type: 'pass', player: 'p1' });
    const s2 = act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Zap', 'hand', 'p2') });
    expect(s2.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s2, { kind: 'chooseTargets', targets: [obj(drake)] })).toThrow(/life/i);
    // a target it can pay for is still fine
    expect(lifeOf(resolveAll(answer(s2, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] })), 'p1')).toBe(17);
  });
});
