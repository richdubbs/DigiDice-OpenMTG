/** trek-11 (CR 400.11, 305.1, 601.3): the computer and a card it could play from outside the game (The Holodeck's `playOutside` special action). It never takes it (the
 * action scores nothing, as every special action but the companion's), never throws on it, and plays on with what it does know. */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, createGame, legalActions, viewFor, type CardDef, type GameState, type OracleCard } from '@openmtg/engine';
import { clone } from '../../engine/src/util/clone';
import { compiledDefs } from '../../engine/test/fixtures';
import { act, put } from '../../engine/test/m3/scenario';
import { chooseAction, explainPriority } from '../src/index';

const card = (name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const HOLODECK = card('Test Holo Deck', 'Legendary Artifact', 'Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard.', '{7}');
const BEAR = card('Test Outside Bear', 'Creature — Bear', '', '{1}', ['2', '2']);

function atMain(): GameState {
  const deck = Array(40).fill('Plains') as string[];
  let s = clone(createGame({
    seed: 'trek11-ai',
    players: [{ name: 'Bot', deck, sideboard: ['Test Outside Bear'], stops: { fullControl: true } }, { name: 'Ann', deck, stops: { fullControl: true } }],
    defs: [...compiledDefs(['Plains']), HOLODECK, BEAR],
    options: { startingPlayer: 'p1', skipMulligans: true },
  }));
  put(s, 'p1', 'battlefield', 'Test Holo Deck');
  put(s, 'p1', 'battlefield', 'Plains');
  put(s, 'p1', 'battlefield', 'Plains');
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

describe('trek-11: the computer and the Holodeck', () => {
  it('the card outside the game is a legal action for the computer, and it does not take it: it plays its land from the hand, then passes (no crash)', () => {
    const s = atMain();
    const legal = legalActions(s, 'p1');
    expect(legal.some((a) => a.action.type === 'special' && a.action.kind === 'playOutside')).toBe(true); // a real option, so the test is not vacuous
    const view = viewFor(s, 'p1');
    expect(view.outside?.['p1']).toEqual(['Test Outside Bear']); // the viewer's own sideboard only
    expect(view.outside?.['p2']).toBeUndefined();
    const ranked = explainPriority(view, 'x');
    expect(ranked.some((r) => /outside the game/.test(r.label))).toBe(false); // scored nothing: not among the plays
    let t = s;
    for (let i = 0; i < 6 && t.pending?.kind === 'priority' && t.pending.player === 'p1'; i++) {
      const v = viewFor(t, 'p1');
      const a = chooseAction(v, v.pending!, 'x');
      expect(a.type === 'special').toBe(false);
      if (a.type === 'pass') break;
      t = applyAction(t, a).state;
    }
    expect(t.outside?.['p1']).toEqual(['Test Outside Bear']); // still outside the game
  });
  it('the opponent\'s view of the game shows no sideboard of the bot\'s, and its legal actions have no outside action', () => {
    const s = atMain();
    const theirs = viewFor(s, 'p2');
    expect(theirs.outside?.['p1']).toBeUndefined();
    expect(legalActions(s, 'p2').some((a) => a.action.type === 'special')).toBe(false);
  });
});
