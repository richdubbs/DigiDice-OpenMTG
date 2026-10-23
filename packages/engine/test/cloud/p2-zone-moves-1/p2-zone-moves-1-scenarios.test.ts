/**
 * p2-zone-moves-1 (Phase 2 lane p2-zone-moves: wheels): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 *
 *   CR 701.9a, 121.2, 608.2e  "Each player discards their hand, then draws that many cards": each player draws the number of cards THEY discarded (the fix: before it,
 *                             every player drew the total of all discards)
 *   CR 107.1b                 "... then draws that many cards minus one": a player who discarded no card draws none (not a negative number)
 *   CR 701.9a, 608.2c         "... draws cards equal to the greatest number of cards a player discarded this way": every player draws the same, the largest discard
 *   CR 608.2c                 "that player discards all the cards in their hand, then draws that many cards" after a damage trigger: the cards discarded, not the damage
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { card, cast, full, resolveAll, scenario } from '../r5-cost/support';
import { attackWith } from '../r4-cost/support';
import { find } from '../../m3/scenario';

const WHEEL = card('Test Wheel', 'Sorcery', 'Each player discards their hand, then draws that many cards.');
const DEAL = card('Test Deal', 'Sorcery', 'Each player discards all the cards in their hand, then draws that many cards minus one.');
const GALE = card('Test Gale', 'Sorcery', 'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.');
const ZAPPER = card('Test Zapper', 'Creature — Human', 'Whenever this creature deals damage to a player, that player discards all the cards in their hand, then draws that many cards.', '{0}', ['3', '1']);
const TIDE = card('Test Tide', 'Sorcery', 'Each player discards any number of cards, then draws that many cards.');
const DEFS = [WHEEL, DEAL, GALE, ZAPPER, TIDE];

const hands = (s: GameState): [number, number] => [s.zones.hand.p1!.length, s.zones.hand.p2!.length];
const start = (spell: string, p1 = 2, p2 = 4): GameState => scenario([], { defs: DEFS, p1: { hand: [spell, ...Array(p1).fill('Plains')] }, p2: { hand: Array(p2).fill('Plains') } });

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('CR 701.9a, 121.2, 608.2e: "Each player discards their hand, then draws that many cards"', () => {
  it('each player draws as many as they discarded (2 and 4), not the total (6)', () => {
    expect(hands(resolveAll(cast(start('Test Wheel'), 'Test Wheel')))).toEqual([2, 4]);
  });
  it('a player with an empty hand draws none', () => {
    expect(hands(resolveAll(cast(start('Test Wheel', 3, 0), 'Test Wheel')))).toEqual([3, 0]);
  });
});

describe('CR 107.1b: "... then draws that many cards minus one"', () => {
  it('2 -> 1 and 4 -> 3; a player who discarded none draws none', () => {
    expect(hands(resolveAll(cast(start('Test Deal'), 'Test Deal')))).toEqual([1, 3]);
    expect(hands(resolveAll(cast(start('Test Deal', 0, 1), 'Test Deal')))).toEqual([0, 0]);
  });
});

describe('CR 701.9a, 608.2c: "... draws cards equal to the greatest number of cards a player discarded this way"', () => {
  it('both players draw four (the greater discard), whoever discarded it', () => {
    expect(hands(resolveAll(cast(start('Test Gale'), 'Test Gale')))).toEqual([4, 4]);
    expect(hands(resolveAll(cast(start('Test Gale', 5, 1), 'Test Gale')))).toEqual([5, 5]);
  });
});

describe('CR 608.2c: "that player discards all the cards in their hand, then draws that many cards" after a damage trigger', () => {
  it('the player draws the cards they discarded (2), not the damage dealt (3)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Zapper'] }, p2: { hand: ['Plains', 'Plains'] } });
    const s = attackWith(s0, [find(s0, 'Test Zapper', 'battlefield', 'p1')]);
    expect(s.zones.hand.p2).toHaveLength(2);
    expect(s.zones.graveyard.p2).toHaveLength(2);
  });
});

describe('CR 701.9a, 608.2e: "Each player discards any number of cards, then draws that many cards" (Flux\'s wording; a decided-by-default G10 correction)', () => {
  it('each player draws the number THEY chose to discard: p1 one, p2 three', () => {
    let s = start('Test Tide', 2, 4);
    s = cast(s, 'Test Tide');
    s = resolveAll(s, { objects: [[s.zones.hand.p1![0]!], s.zones.hand.p2!.slice(0, 3)] });
    expect(hands(s)).toEqual([2, 4]);
    expect([s.zones.graveyard.p1!.length, s.zones.graveyard.p2!.length]).toEqual([2, 3]); // p1: the Tide and one card
  });
});
