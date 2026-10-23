/**
 * LOOK3 and guard G10 (design 6.8): "If you don't put the card onto the battlefield, put it into your hand." becoming understood names the move it reads, nested in the
 * option of the condition before it ("If it's a land card, you may put it onto the battlefield."): that move gains an `as` and nothing else. The gate's rule for a
 * step nested in the step that took in the next sentence (Cloud std-fin, packages/cards/src/coverage/snapshot.ts#keepsAutomated, cherry-picked from f73dc9a9) accepts
 * exactly that, at any depth; anything else that changes inside is still a change.
 */
import { describe, expect, it } from 'vitest';
import { keepsAutomated, MANUAL_MARK } from '../../src/coverage/snapshot';

const M = MANUAL_MARK;
const you = { ref: 'you' };
const look = { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 1 }, as: 'seen' };
const move = { op: 'move', what: { ref: 'bound', name: 'seen' }, to: { zone: 'battlefield', controller: you } };
const offer = (m: Record<string, unknown>) => ({ op: 'if', cond: { cond: 'matches', object: { ref: 'bound', name: 'seen' }, filter: { types: ['Land'], isCard: true } }, then: [{ op: 'may', who: you, do: [m] }] });
const rider = { op: 'if', cond: { cond: 'did', step: 'moved', not: true, to: 'battlefield' }, then: [{ op: 'move', what: { ref: 'bound', name: 'seen' }, to: { zone: 'hand' } }] };
const program = (steps: unknown[]) => ({ effect: { targets: [], steps } });

describe('LOOK3 (G10, keepsAutomated): the move the rider reads gains its name inside the `if` and the `may` of the step before the formerly manual sentence', () => {
  it('the name alone, two steps deep: kept', () => {
    expect(keepsAutomated(program([look, offer(move), M]), program([look, offer({ ...move, as: 'moved' }), rider]))).toBe(true);
  });
  it('anything else that changes inside (the zone, who chooses, the look) is a change', () => {
    expect(keepsAutomated(program([look, offer(move), M]), program([look, offer({ ...move, as: 'moved', to: { zone: 'hand' } }), rider]))).toBe(false);
    const theirs = { ...offer(move), then: [{ op: 'may', who: { ref: 'each', who: 'opponent' }, do: [{ ...move, as: 'moved' }] }] };
    expect(keepsAutomated(program([look, offer(move), M]), program([look, theirs, rider]))).toBe(false);
    expect(keepsAutomated(program([look, offer(move), M]), program([{ ...look, as: 'top' }, offer({ ...move, as: 'moved' }), rider]))).toBe(false);
  });
  it('a name gained where no formerly manual sentence follows is a change', () => {
    expect(keepsAutomated(program([look, offer(move)]), program([look, offer({ ...move, as: 'moved' })]))).toBe(false);
  });
});
