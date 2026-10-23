/**
 * WP30 review (the `blocks` counterpart of W1 follow-up d): "Whenever [a creature] blocks" triggers once per combat for that creature even if it blocks several
 * attackers (CR 509.3a); "Whenever [a creature] blocks a creature" triggers once for each attacker it blocks (CR 509.3b). The normalizer emits one `blocks`
 * event per blocker/attacker pair and flags the first pair of each blocker; a pattern without `attacker` matches only first pairs, in the trigger matcher and
 * in the history alike.
 */
import { describe, expect, it } from 'vitest';
import type { EventPattern, GameState } from '../../../src/index';
import { collectPendingTriggers } from '../../../src/core/triggers';
import { countHistory, entryMatches } from './history-api';
import { trig, vanilla } from './cards';
import { find, gameOf, scenario, synth } from './helpers';

const blocksPattern: EventPattern = { ev: 'blocks', blocker: { self: true } };
const blocksACreature: EventPattern = { ev: 'blocks', blocker: { self: true }, attacker: { types: ['Creature'] } };

const wall = () => synth({
  name: 'Test Watchful Wall', cost: '{1}', type: 'Creature — Wall', pt: ['0', '5'],
  abilities: [trig('Whenever ~ blocks, you gain 1 life.', [blocksPattern]), trig('Whenever ~ blocks a creature, you gain 1 life.', [blocksACreature])],
});

/** p1 attacks with two creatures; p2's Test Watchful Wall blocks both (two pairs, one blocker). */
function blockedTwice(): GameState {
  const s0 = scenario(['Plains'], { defs: [vanilla(), vanilla('Test Other', ['3', '3']), wall()], p1: { battlefield: ['Test Vanilla', 'Test Other'] }, p2: { battlefield: ['Test Watchful Wall'] } });
  const a = find(s0, 'Test Vanilla', 'battlefield');
  const b = find(s0, 'Test Other', 'battlefield');
  const w = find(s0, 'Test Watchful Wall', 'battlefield');
  const g = gameOf(s0);
  g.emit({ type: 'attackersDeclared', attackers: [{ attacker: a, defender: 'p2' }, { attacker: b, defender: 'p2' }] });
  g.emit({ type: 'blockersDeclared', blocks: [{ blocker: w, attacker: a }, { blocker: w, attacker: b }] });
  collectPendingTriggers(g);
  return g.s;
}

const pendingBy = (s: GameState, text: string): number => s.pendingTriggers.filter((t) => {
  const def = s.defs[s.objects[t.sourceId]?.defId ?? '']?.faces[0]?.abilities[t.abilityRef.index];
  return def?.text === text;
}).length;

describe('CR 509.3a-b: a creature that blocks two attackers', () => {
  it('CR 509.3a: "Whenever ~ blocks" triggers once', () => {
    expect(pendingBy(blockedTwice(), 'Whenever ~ blocks, you gain 1 life.')).toBe(1);
  });

  it('CR 509.3b: "Whenever ~ blocks a creature" triggers once per attacker it blocks', () => {
    expect(pendingBy(blockedTwice(), 'Whenever ~ blocks a creature, you gain 1 life.')).toBe(2);
  });

  it('CR 509.3a-b in the history: "blocked" counts the blocker once, "blocked a creature" counts each pair', () => {
    const s = blockedTwice();
    const pairs = s.history.filter((e) => e.ev === 'blocks');
    expect(pairs).toHaveLength(2);
    expect(pairs.map((e) => e.facts['first'])).toEqual([true, false]);
    expect(countHistory(s, { ev: 'blocks' }, 'turn', 'p2')).toBe(1);
    expect(countHistory(s, { ev: 'blocks', attacker: { types: ['Creature'] } }, 'turn', 'p2')).toBe(2);
    // An entry written before `first` existed counts as a first pair.
    const legacy = { ...pairs[1]!, facts: { ...pairs[1]!.facts } };
    delete legacy.facts['first'];
    expect(entryMatches({ ev: 'blocks' }, legacy, 'p2')).toBe(true);
    expect(entryMatches({ ev: 'blocks' }, pairs[1]!, 'p2')).toBe(false);
  });
});
