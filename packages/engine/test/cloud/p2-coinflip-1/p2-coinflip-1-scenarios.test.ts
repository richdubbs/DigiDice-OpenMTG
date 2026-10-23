/**
 * Phase 2 lane p2-coinflip, round p2-coinflip-1: the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified.
 *
 *   CR 608.2d, 404.1      "return a creature card at random from your graveyard to your hand": no player chooses; only a card of the description can come back
 *   CR 701.20a, 608.2d    "Target player reveals a card at random from their hand. ~ deals damage to that player equal to that card's mana value."
 *   CR 705.1-705.2        "flip a coin until you lose a flip": calls one coin at a time until a flip is lost; each win is a won flip; under "the first time you
 *                         flip one or more coins each turn, those coins come up heads and you win those flips" the flips would never end: handed to the player
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m5/helpers';
import { card, resolveAll } from '../cmd3/helpers';

const zoneNames = (s: GameState, zone: 'hand' | 'graveyard', p = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();

describe('CR 608.2d, 404.1: "return a creature card at random from your graveyard to your hand"', () => {
  const DIGGER = card('Test Grave Digger', 'Creature — Zombie', 'When this creature enters, return a creature card at random from your graveyard to your hand.', ['2', '2']);
  const BEAR = card('Test Old Bear', 'Creature — Bear', '', ['2', '2']);
  const BOLT = card('Test Spent Bolt', 'Instant', 'Test Spent Bolt deals 1 damage to any target.');
  const DEFS: CardDef[] = [DIGGER, BEAR, BOLT];
  it('CR 608.2d: the one creature card comes back, no player is asked; the instant stays', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Grave Digger'], graveyard: ['Test Old Bear', 'Test Spent Bolt'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Digger', 'hand', 'p1') });
    s = resolveAll(s);
    expect(zoneNames(s, 'hand')).toContain('Test Old Bear');
    expect(zoneNames(s, 'graveyard')).toEqual(['Test Spent Bolt']);
  });
  it('CR 608.2d: with no creature card in the graveyard nothing comes back', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Grave Digger'], graveyard: ['Test Spent Bolt'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Digger', 'hand', 'p1') });
    s = resolveAll(s);
    expect(zoneNames(s, 'graveyard')).toEqual(['Test Spent Bolt']);
    expect(zoneNames(s, 'hand')).not.toContain('Test Spent Bolt');
  });
});

describe('CR 701.20a, 608.2d: "Target player reveals a card at random from their hand. ~ deals damage to that player equal to that card\'s mana value."', () => {
  const PROBE = card('Test Mind Probe', 'Sorcery', 'Target player reveals a card at random from their hand. Test Mind Probe deals damage to that player equal to that card\'s mana value.');
  const OGRE = card('Test Heavy Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}');
  const DEFS: CardDef[] = [PROBE, OGRE];
  const cast = (theirHand: string[]): GameState => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mind Probe'] }, p2: { hand: theirHand }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mind Probe', 'hand', 'p1') });
    return resolveAll(s, { targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('CR 701.20a: the card revealed at random (the only one) has mana value 3: that player is dealt 3 damage; the card stays in their hand', () => {
    const start = life(scenario(['Plains'], { defs: DEFS }), 'p2');
    const s = cast(['Test Heavy Ogre']);
    expect(life(s, 'p2')).toBe(start - 3);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Heavy Ogre']);
  });
  it('CR 608.2d: with an empty hand nothing is revealed and no damage is dealt', () => {
    const start = life(scenario(['Plains'], { defs: DEFS }), 'p2');
    expect(life(cast([]), 'p2')).toBe(start);
  });
});

describe('CR 705.1-705.2: "flip a coin until you lose a flip"', () => {
  const GAMBLER = card('Test Coin Gambler', 'Creature — Human Rogue', '{0}: Flip a coin until you lose a flip.\nWhenever you win a coin flip, you gain 1 life.', ['1', '1']);
  const CHARM = card('Test Lucky Charm', 'Enchantment', 'The first time you flip one or more coins each turn, those coins come up heads and you win those flips.');
  const DEFS: CardDef[] = [GAMBLER, CHARM];
  /** Activate the flips, call heads each time, then resolve everything; return the state and the number of calls asked. */
  const flips = (battlefield: string[], seed: string): { s: GameState; calls: number } => {
    let s = scenario(['Plains'], { p1: { battlefield }, defs: DEFS, seed });
    const g = find(s, 'Test Coin Gambler', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: g, ability: 'p:0:0' });
    let calls = 0;
    for (let guard = 0; guard < 300; guard++) {
      const d = s.pending as unknown as { kind: string; prompt?: string } | undefined;
      if (d?.kind === 'chooseOption' && (d.prompt ?? '').startsWith('Call the coin flip')) {
        calls++;
        s = answer(s, { kind: 'chooseOption', ids: ['heads'] });
      } else if (d?.kind === 'priority' && s.zones.stack.length === 0) break;
      else if (d?.kind === 'priority') s = pass(s);
      else break; // another decision (the hand-over of a step the engine does not resolve)
    }
    return { s, calls };
  };
  it('CR 705.2: each flip is called; the flips stop at the first lost one, and each won flip triggers "whenever you win a coin flip" (one life each)', () => {
    for (const seed of ['flip-a', 'flip-b', 'flip-c', 'flip-d']) {
      const start = life(scenario(['Plains'], { defs: DEFS, seed }), 'p1');
      const { s, calls } = flips(['Test Coin Gambler'], seed);
      expect(calls, seed).toBeGreaterThanOrEqual(1);
      expect(life(s, 'p1'), seed).toBe(start + calls - 1); // every call but the last was a win
    }
  });
  it('CR 705.2, 104.4b: under "those coins come up heads and you win those flips" the flips would never end: the step is handed to the player (fail closed), no endless loop', () => {
    const { s, calls } = flips(['Test Coin Gambler', 'Test Lucky Charm'], 'flip-rigged');
    expect(calls).toBe(0);
    expect((s.pending as unknown as { prompt?: string } | undefined)?.prompt ?? '').toMatch(/by hand: flip a coin until you lose a flip/);
  });
});
