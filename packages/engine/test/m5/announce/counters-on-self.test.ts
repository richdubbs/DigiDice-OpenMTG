/**
 * FAST3 integration (after M6-4): an activation restriction that counts the counters of one kind on the source itself, "Activate only if there are three or
 * more brick counters on this artifact" (Luxa River Shrine; CR 602.5b, 122.1). M6-4's condition hole parses "there are N or more <kind> counters on ~"; the
 * announcement reads it from the board (feature:announce.qty.counters, feature:announce.counters.self). Counters on any other object are not read here.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, GameState, ObjectId } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/index';
import { announceReadable } from '../../../src/actions/announce-cond';
import { activated, find, legal, scenario, synth } from '../helpers';

const brick = (n: number): Condition => ({ cond: 'compare', left: { q: 'counters', on: { ref: 'self' }, kind: 'brick' }, op: '>=', right: n });
const gadget = (onlyIf: Condition) => synth({ name: 'Test Gadget', type: 'Artifact', abilities: [activated('Do it.', {}, [], { onlyIf })] });
const withCounters = (s: GameState, id: ObjectId, counters: Record<string, number>): GameState => ({
  ...s, objects: { ...s.objects, [id]: { ...s.objects[id]!, counters } },
});

describe('CR 602.5b: "Activate only if there are three or more brick counters on ~"', () => {
  it('the capability is claimed for the source only', () => {
    expect(ENGINE_CAPABILITIES.has('feature:announce.qty.counters')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:announce.counters.self')).toBe(true);
    expect(announceReadable(brick(3), 'activate')).toBe(true);
    expect(announceReadable({ cond: 'compare', left: { q: 'counters', on: { ref: 'target', id: 't0' }, kind: 'brick' }, op: '>=', right: 3 }, 'activate')).toBe(false);
  });

  it('is offered with three brick counters, not with two or with three counters of another kind', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Gadget'] }, defs: [gadget(brick(3))] });
    const id = find(s0, 'Test Gadget', 'battlefield');
    expect(legal(s0, 'p1', 'activate')).toEqual([]);
    expect(legal(withCounters(s0, id, { brick: 2 }), 'p1', 'activate')).toEqual([]);
    expect(legal(withCounters(s0, id, { charge: 3 }), 'p1', 'activate')).toEqual([]);
    expect(legal(withCounters(s0, id, { brick: 3 }), 'p1', 'activate')).toHaveLength(1);
    expect(legal(withCounters(s0, id, { brick: 4 }), 'p1', 'activate')).toHaveLength(1);
  });
});
