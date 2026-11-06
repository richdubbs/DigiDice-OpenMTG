/**
 * Top-rank second pass 8, edh-next-98 (code edhn98): the round's readings at the parser level (guard G9, design 6.8): each wording is fully automated with its card shape and its
 * near misses are not. Synthetic wordings (design 6.10). CR cites from memory (unverified). The behavior is in edh-next-98-scenarios.test.ts.
 *
 *   zz-cloud/edh-next-98.json  eff.edhn98.forEach.eachOpponentLoses1.youGain1 ("For each <thing> exiled this way, each opponent loses 1 life and you gain 1 life.")
 *   parser/lower/conditions.ts  "Pay {E}{E}. If you can't, ..." after the bare ch.pay ("you may pay" stays out); render/steps-flow.ts says it back
 *   parser/holes/cond.ts        "a creature card left your graveyard this turn"; "three or more cards were put into your graveyard from anywhere other than the battlefield this turn"
 *   parser/holes/qty.ts         "the number of opponents being attacked" (q:opponentsAttacked of the combat)
 */
import { describe, expect, it } from 'vitest';
import { card, full } from '../r4-cost/support';

const creature = (text: string): boolean => full(card('Example Relic', 'Legendary Artifact Creature — Golem', text, '{2}', ['2', '2']));
const spell = (text: string): boolean => full(card('Example Plan', 'Sorcery', text, '{1}'));

describe('edh-next-98 readings (CR 608.2c, 118.3, 400.3, 506.3)', () => {
  it('eff.edhn98.forEach.eachOpponentLoses1.youGain1: each creature card exiled this way drains 1', () => {
    expect(creature('When this creature enters, exile up to two target cards from graveyards. For each creature card exiled this way, each opponent loses 1 life and you gain 1 life.')).toBe(true);
    expect(spell('Exile up to three target cards from graveyards. For each land card exiled this way, each opponent loses 1 life and you gain 1 life.')).toBe(true);
  });
  it('near misses of the drain are not full (other amounts, other players)', () => {
    expect(spell('Exile up to two target cards from graveyards. For each creature card exiled this way, each opponent loses 2 life and you gain 1 life.')).toBe(false);
    expect(spell('Exile up to two target cards from graveyards. For each creature card exiled this way, target opponent loses 1 life and you gain 1 life.')).toBe(false);
    expect(spell('Exile up to two target cards from graveyards. For each creature card exiled this way, each opponent loses 1 life and each other player gains 1 life.')).toBe(false);
  });
  it('"Pay {E}{E}. If you can\'t, ..." is full; "you may pay" and "if you don\'t" wordings are other readings', () => {
    expect(creature('When this creature enters, pay {E}{E}. If you can\'t, return this creature to its owner\'s hand and you get {E}.')).toBe(true);
    expect(creature('When this creature enters, you may pay {E}{E}. If you can\'t, return this creature to its owner\'s hand.')).toBe(false);
    expect(creature('When this creature enters, target opponent pays {E}{E}. If you can\'t, return this creature to its owner\'s hand.')).toBe(false);
  });
  it('a creature card left your graveyard this turn', () => {
    expect(creature('At the beginning of each end step, if a creature card left your graveyard this turn, you gain 1 life.')).toBe(true);
    expect(creature('At the beginning of each end step, if a creature card left an opponent\'s graveyard this turn, you gain 1 life.')).toBe(false);
  });
  it('three or more cards put into your graveyard from anywhere other than the battlefield this turn', () => {
    expect(creature('At the beginning of each end step, if three or more cards were put into your graveyard from anywhere other than the battlefield this turn, draw a card.')).toBe(true);
    expect(creature('At the beginning of each end step, if three or more cards were put into an opponent\'s graveyard from anywhere other than the battlefield this turn, draw a card.')).toBe(false);
  });
  it('the number of opponents being attacked', () => {
    expect(creature('Whenever you attack, scry X, where X is the number of opponents being attacked.')).toBe(true);
    expect(creature('Whenever you attack, scry X, where X is the number of planeswalkers being attacked.')).toBe(false);
  });
});
