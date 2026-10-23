/**
 * std-freecast-4 (lane std-freecast): the round's reading played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.168a, 702.168d, 116.2b, 118.7  "Disguise {4}{R}. This cost is reduced by {1} for each instant and sorcery card in your graveyard.": the cost of turning
 *                                         it face up is {4}{R} less {1} for each such card in its controller's graveyard, counted when the action is taken; the
 *                                         colored part is never reduced; the face-down cast for {3} is unchanged
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { turnFaceUpProcedures } from '../../../src/core/special/turn-face-up';
import { castFaceDown, faceDownOf, resolveTop, scenario, synthetic, turnUpActions } from '../../m6/face-down/support';

const ROGUE = synthetic('Test Masked Rogue', 'Creature — Goblin Rogue', '{2}{R}', 'Disguise {4}{R}. This cost is reduced by {1} for each instant and sorcery card in your graveyard.', { power: '2', toughness: '2' });
const BOLT = synthetic('Test Spark', 'Instant', '{R}', 'Draw a card.');
const PLAN = synthetic('Test Plan', 'Sorcery', '{U}', 'Draw a card.');
const OGRE = synthetic('Test Ogre', 'Creature — Ogre', '{2}', '', { power: '2', toughness: '2' });

const board = (graveyard: string[], mountains: number): GameState => {
  let s = scenario(['Mountain'], { defs: [ROGUE, BOLT, PLAN, OGRE], p1: { hand: ['Test Masked Rogue'], battlefield: Array(3 + mountains).fill('Mountain'), graveyard } });
  s = resolveTop(castFaceDown(s, 'Test Masked Rogue', 'disguise')); // three Mountains pay the face-down cast
  return s;
};
const faceUpCost = (s: GameState): string => JSON.stringify(turnFaceUpProcedures(s, faceDownOf(s, 'p1')[0]!).map((p) => p.cost));

describe('std-freecast-4: the synthetic card is automated (its template experimental until reviewed)', () => {
  it('the disguise ability is fully understood', () => {
    expect(ROGUE.automation.faces![0]!.abilities.every((a) => a.level === 'full')).toBe(true);
  });
});

describe('CR 702.168a, 702.168d, 118.7: "Disguise {4}{R}. This cost is reduced by {1} for each instant and sorcery card in your graveyard."', () => {
  it('with an instant, a sorcery and a creature card in the graveyard, the face-up cost is {2}{R}, payable with three untapped Mountains', () => {
    const s = board(['Test Spark', 'Test Plan', 'Test Ogre'], 3);
    expect(faceUpCost(s)).toBe(JSON.stringify([{ mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'R' }] }]));
    expect(turnUpActions(s)).toHaveLength(1);
  });
  it('with an empty graveyard it is the full {4}{R}: not payable with three Mountains', () => {
    const s = board([], 3);
    expect(faceUpCost(s)).toBe(JSON.stringify([{ mana: [{ kind: 'generic', amount: 4 }, { kind: 'colored', color: 'R' }] }]));
    expect(turnUpActions(s)).toHaveLength(0);
  });
  it('CR 118.7: never below its colored part: with six instants it is {R}', () => {
    const s = board(Array(6).fill('Test Spark'), 1);
    expect(faceUpCost(s)).toBe(JSON.stringify([{ mana: [{ kind: 'colored', color: 'R' }] }]));
    expect(turnUpActions(s)).toHaveLength(1);
  });
});
