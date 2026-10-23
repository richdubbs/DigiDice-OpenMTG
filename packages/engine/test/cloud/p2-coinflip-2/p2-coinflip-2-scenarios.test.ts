/**
 * Phase 2 lane p2-coinflip, round p2-coinflip-2: the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified.
 *
 *   CR 705.2, 122.1       "flip a coin until you lose a flip. Put a +1/+1 counter on ~ for each flip you won.": one counter per won flip, none when the first is lost
 *   CR 121.1, 701.9b      "each player draws a card, then discards a card at random": each player discards one card of their own hand, no player is asked
 *   CR 701.20a, 119.3     "target player reveals a card at random from their hand, then loses life equal to that card's mana value"
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m5/helpers';
import { card, resolveAll } from '../cmd3/helpers';

const zoneNames = (s: GameState, zone: 'hand' | 'graveyard', p = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();

describe('CR 705.2, 122.1: "flip a coin until you lose a flip. Put a +1/+1 counter on ~ for each flip you won."', () => {
  const STREAK = card('Test Streak Imp', 'Creature — Imp', '{0}: Flip a coin until you lose a flip. Put a +1/+1 counter on this creature for each flip you won.', ['1', '1']);
  const DEFS: CardDef[] = [STREAK];
  /** Activate the flips, call heads each time, then resolve everything; return the state, the number of calls asked and the creature. */
  const flips = (seed: string): { s: GameState; calls: number; imp: string } => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Streak Imp'] }, defs: DEFS, seed });
    const imp = find(s, 'Test Streak Imp', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' });
    let calls = 0;
    for (let guard = 0; guard < 300; guard++) {
      const d = s.pending as unknown as { kind: string; prompt?: string } | undefined;
      if (d?.kind === 'chooseOption' && (d.prompt ?? '').startsWith('Call the coin flip')) {
        calls++;
        s = answer(s, { kind: 'chooseOption', ids: ['heads'] });
      } else if (d?.kind === 'priority' && s.zones.stack.length === 0) break;
      else if (d?.kind === 'priority') s = pass(s);
      else break;
    }
    return { s, calls, imp };
  };
  it('CR 705.2: every call but the last was a won flip, and each won flip is one +1/+1 counter; a first flip lost is no counter', () => {
    const seen = new Set<number>();
    for (const seed of ['streak-a', 'streak-b', 'streak-c', 'streak-d', 'streak-e', 'streak-f']) {
      const { s, calls, imp } = flips(seed);
      expect(calls, seed).toBeGreaterThanOrEqual(1);
      expect(s.objects[imp]!.counters['+1/+1'] ?? 0, seed).toBe(calls - 1);
      seen.add(calls - 1);
    }
    expect(seen.size, 'the seeds give different numbers of won flips').toBeGreaterThan(1);
  });
});

describe('CR 121.1, 701.9b: "When ~ enters, each player draws a card, then discards a card at random."', () => {
  const SCRAMBLER = card('Test Hand Scrambler', 'Creature — Goblin', 'When this creature enters, each player draws a card, then discards a card at random.', ['2', '2']);
  const BEAR = card('Test Old Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [SCRAMBLER, BEAR];
  it('CR 701.9b: each player draws, then discards one card of their own hand at random: no player is asked to choose', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Hand Scrambler', 'Test Old Bear'], library: ['Test Old Bear'] }, p2: { hand: ['Test Old Bear'], library: ['Test Old Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hand Scrambler', 'hand', 'p1') });
    s = resolveAll(s);
    for (const p of ['p1', 'p2']) {
      expect(s.zones.hand[p]!.length, p).toBe(1);
      expect(zoneNames(s, 'graveyard', p), p).toEqual(['Test Old Bear']);
    }
    expect((s.pending as unknown as { kind: string }).kind).toBe('priority');
  });
  it('CR 701.9b: the card just drawn is in the hand the discard picks from: with no other card in hand it is the one discarded', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Hand Scrambler'], library: ['Test Old Bear'] }, p2: { hand: [], library: ['Test Old Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hand Scrambler', 'hand', 'p1') });
    s = resolveAll(s);
    for (const p of ['p1', 'p2']) {
      expect(s.zones.hand[p], p).toEqual([]);
      expect(zoneNames(s, 'graveyard', p), p).toEqual(['Test Old Bear']);
    }
  });
});

describe('CR 701.20a, 119.3: "target player reveals a card at random from their hand, then loses life equal to that card\'s mana value"', () => {
  const OGRE = card('Test Mind Ogre', 'Creature — Ogre', "When this creature enters, target player reveals a card at random from their hand, then loses life equal to that card's mana value.", ['3', '3']);
  const HEAVY = card('Test Heavy Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}');
  const DEFS: CardDef[] = [OGRE, HEAVY];
  const cast = (theirHand: string[]): GameState => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mind Ogre'] }, p2: { hand: theirHand }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mind Ogre', 'hand', 'p1') });
    return resolveAll(s, { targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('CR 119.3: the card revealed (the only one) has mana value 3: that player loses 3 life; the card stays in their hand', () => {
    const start = life(scenario(['Plains'], { defs: DEFS }), 'p2');
    const s = cast(['Test Heavy Ogre']);
    expect(life(s, 'p2')).toBe(start - 3);
    expect(life(s, 'p1')).toBe(start);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Heavy Ogre']);
  });
  it('CR 608.2d: with an empty hand nothing is revealed and no life is lost', () => {
    const start = life(scenario(['Plains'], { defs: DEFS }), 'p2');
    expect(life(cast([]), 'p2')).toBe(start);
  });
});
