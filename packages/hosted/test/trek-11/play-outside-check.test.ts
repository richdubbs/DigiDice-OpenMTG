/** trek-11 (CR 400.11b): the hosted table checks a `playOutside` special action against the legal actions of the player in the real state, for the card it names. */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '@openmtg/engine';
import { scenario } from '../../../engine/test/m3/scenario';
import { actionLegalityProblem } from '../../src/table/check';

const card = (name: string, type: string, text: string, cost: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const HOLODECK = card('Test Holo Deck', 'Legendary Artifact', 'Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard.', '{7}');
const BEAR = card('Test Outside Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const OTTER = card('Test Outside Otter', 'Creature — Otter', '', '{1}', ['1', '1']);

describe('trek-11: the hosted table and the playOutside action', () => {
  const s = scenario([], { defs: [HOLODECK, BEAR, OTTER], p1: { battlefield: ['Test Holo Deck', 'Plains', 'Plains'] } });
  s.outside = { p1: ['Test Outside Bear'], p2: ['Test Outside Otter'] };
  it('the card the state offers is accepted; a card the player does not have outside the game, or the opponent\'s, is refused', () => {
    expect(actionLegalityProblem(s, 'p1', { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Bear' })).toBeNull();
    expect(actionLegalityProblem(s, 'p1', { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Otter' })).toMatchObject({ code: 'illegalAction' });
    expect(actionLegalityProblem(s, 'p1', { type: 'special', player: 'p1', kind: 'playOutside', outside: 'Test Outside Wolf' })).toMatchObject({ code: 'illegalAction' });
    expect(actionLegalityProblem(s, 'p1', { type: 'special', player: 'p1', kind: 'playOutside' })).toMatchObject({ code: 'illegalAction' });
  });
});
