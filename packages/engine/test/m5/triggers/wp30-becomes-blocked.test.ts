/**
 * WP30 (W1 follow-up d): "became blocked" in the history counts each attacker once per combat (CR 509.3c), "became blocked by a creature" counts each blocker
 * (CR 509.3d). The history keeps one entry per attacker/blocker pair (so the blocker's facts can be asked about) and marks the first pair of each attacker.
 */
import { describe, expect, it } from 'vitest';
import type { EventPattern, GameState } from '../../../src/index';
import { collectPendingTriggers } from '../../../src/core/triggers';
import { countHistory, entryMatches } from './history-api';
import { vanilla } from './cards';
import { find, gameOf, scenario } from './helpers';

const board = (): GameState => scenario(['Plains'], {
  defs: [vanilla(), vanilla('Test Other', ['3', '3']), vanilla('Test Wall', ['0', '4']), vanilla('Test Guard', ['1', '1'])],
  p1: { battlefield: ['Test Vanilla', 'Test Other'] },
  p2: { battlefield: ['Test Wall', 'Test Guard'] },
});

/** p1 attacks with both creatures; Test Wall and Test Guard both block Test Vanilla (two pairs), then Test Wall alone blocks Test Other in a later combat. */
function blocked(): { s: GameState; vanilla: string; other: string } {
  const s0 = board();
  const vanillaId = find(s0, 'Test Vanilla', 'battlefield');
  const other = find(s0, 'Test Other', 'battlefield');
  const wall = find(s0, 'Test Wall', 'battlefield');
  const guard = find(s0, 'Test Guard', 'battlefield');
  const g = gameOf(s0);
  g.emit({ type: 'attackersDeclared', attackers: [{ attacker: vanillaId, defender: 'p2' }, { attacker: other, defender: 'p2' }] });
  g.emit({ type: 'blockersDeclared', blocks: [{ blocker: wall, attacker: vanillaId }, { blocker: guard, attacker: vanillaId }] });
  collectPendingTriggers(g);
  return { s: g.s, vanilla: vanillaId, other };
}

const becameBlocked: EventPattern = { ev: 'becomesBlocked' };
const byACreature: EventPattern = { ev: 'becomesBlocked', by: { types: ['Creature'] } };

describe('CR 509.3c-d: becoming blocked in the history', () => {
  it('CR 509.3c: an attacker blocked by two creatures became blocked ONCE this turn', () => {
    const { s } = blocked();
    expect(s.history.filter((e) => e.ev === 'becomesBlocked')).toHaveLength(2); // one entry per pair: the blockers' facts are kept
    expect(countHistory(s, becameBlocked, 'turn', 'p1')).toBe(1);
    expect(countHistory(s, { ev: 'becomesBlocked', attacker: { name: 'Test Vanilla' } }, 'turn', 'p1')).toBe(1);
    expect(countHistory(s, { ev: 'becomesBlocked', attacker: { name: 'Test Other' } }, 'turn', 'p1')).toBe(0); // it attacked and was not blocked
  });

  it('CR 509.3d: "became blocked by a creature" counts each blocker; a filter on the blocker reads that blocker\'s facts', () => {
    const { s } = blocked();
    expect(countHistory(s, byACreature, 'turn', 'p1')).toBe(2);
    expect(countHistory(s, { ev: 'becomesBlocked', by: { name: 'Test Guard' } }, 'turn', 'p1')).toBe(1); // the second pair still counts with `by`
    expect(countHistory(s, { ev: 'becomesBlocked', by: { name: 'Test Wall' } }, 'turn', 'p1')).toBe(1);
    expect(countHistory(s, { ev: 'becomesBlocked', by: { power: { op: '>=', value: 5 } } }, 'turn', 'p1')).toBe(0);
  });

  it('CR 509.3c: becoming blocked again in another combat is another time (the first pair of each declaration counts)', () => {
    const { s: s1, other } = blocked();
    const g = gameOf(s1);
    const wall = find(g.s, 'Test Wall', 'battlefield');
    g.s.combat = null;
    g.emit({ type: 'attackersDeclared', attackers: [{ attacker: other, defender: 'p2' }] });
    g.emit({ type: 'blockersDeclared', blocks: [{ blocker: wall, attacker: other }] });
    collectPendingTriggers(g);
    expect(countHistory(g.s, becameBlocked, 'turn', 'p1')).toBe(2); // Test Vanilla once, Test Other once
    expect(countHistory(g.s, byACreature, 'turn', 'p1')).toBe(3); // three pairs
  });

  it('the `first` fact is written on the first pair of each attacker only; an entry written before it existed counts as a first pair', () => {
    const { s } = blocked();
    const pairs = s.history.filter((e) => e.ev === 'becomesBlocked');
    expect(pairs.map((e) => e.facts['first'])).toEqual([true, false]);
    const legacy = { ...pairs[1]!, facts: { ...pairs[1]!.facts } };
    delete legacy.facts['first'];
    expect(entryMatches(becameBlocked, legacy, 'p1')).toBe(true);
    expect(entryMatches(becameBlocked, pairs[1]!, 'p1')).toBe(false);
    expect(entryMatches(byACreature, pairs[1]!, 'p1')).toBe(true);
  });
});
