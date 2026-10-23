/**
 * WP8 review fix: a state trigger (CR 603.8) with a required target and no legal target is removed from the stack (CR 603.3d); because the state is still true it
 * would trigger again at once, forever. The game must go on (not spin into the loop guard), and the ability must trigger again once its state has been false.
 */
import { describe, expect, it } from 'vitest';
import type { EventPattern, GameState } from '../../../src/index';
import { putPendingTriggersOnStack } from '../../../src/core/triggers';
import { trig, vanilla } from './cards';
import { find, gameOf, move, pass, put, scenario, stackAbilities, synth, tweak } from './helpers';

const noCreatures: EventPattern = { ev: 'state', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } };
const hater = synth({
  name: 'Test Targeting State Trigger', cost: '{1}', type: 'Enchantment',
  abilities: [trig('When you control no creatures, destroy target artifact.', [noCreatures], {
    targets: [{ id: 't0', kind: 'object', filter: { types: ['Artifact'] }, min: 1, max: 1, text: 'target artifact' }], steps: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }],
  })],
});
const trinket = synth({ name: 'Test Trinket', cost: '{1}', type: 'Artifact', abilities: [] });
const defs = [hater, trinket, vanilla()];

/** Placed after the scenario reached its first main phase: a state trigger would otherwise act while the scenario passes priority. */
const placed = (extra: (t: GameState) => void = () => {}): GameState =>
  tweak(scenario(['Plains'], { defs, p1: { battlefield: [] } }), (t) => { put(t, 'p1', 'battlefield', 'Test Targeting State Trigger'); extra(t); });

describe('CR 603.8, 603.3d: a state trigger that has no legal target is removed and does not loop', () => {
  it('passing priority with no artifact anywhere does not crash with the loop guard; the game goes on', () => {
    const s = pass(placed());
    expect(s.pending!.kind).toBe('priority');
    expect(stackAbilities(s)).toEqual([]);
    expect(s.log.some((l) => l.rules?.includes('CR 603.3d') && /removed from the stack/.test(l.text))).toBe(true);
  });

  it('the removal is logged once, not once per loop iteration', () => {
    const s = pass(placed());
    expect(s.log.filter((l) => /removed from the stack/.test(l.text))).toHaveLength(1);
  });

  it('it triggers again after its state was false at least once (a creature came and went)', () => {
    let vanillaId = '';
    let trinketId = '';
    const s = tweak(pass(placed()), (t) => { vanillaId = put(t, 'p1', 'battlefield', 'Test Vanilla'); trinketId = put(t, 'p1', 'battlefield', 'Test Trinket'); });
    const g = gameOf(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: trinketId }] }]);
    expect(putPendingTriggersOnStack(g)).toBe(false); // the state is false: nothing happens
    move(g, vanillaId, 'graveyard');
    expect(putPendingTriggersOnStack(g)).toBe(true); // true again, and now there is a legal target
    expect(stackAbilities(g.s)).toMatchObject([{ source: 'Test Targeting State Trigger', targets: [trinketId] }]);
  });

  it('a new object (the permanent left and came back, CR 400.7) starts afresh', () => {
    let trinketId = '';
    const s = tweak(pass(placed()), (t) => { trinketId = put(t, 'p1', 'battlefield', 'Test Trinket'); });
    const g = gameOf(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: trinketId }] }]);
    move(g, find(s, 'Test Targeting State Trigger', 'battlefield'), 'graveyard');
    put(g.s, 'p1', 'battlefield', 'Test Targeting State Trigger');
    expect(putPendingTriggersOnStack(g)).toBe(true);
    expect(stackAbilities(g.s)).toMatchObject([{ targets: [trinketId] }]);
  });
});
