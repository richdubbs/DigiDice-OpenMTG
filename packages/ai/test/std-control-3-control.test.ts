/**
 * std-control-3 (CR 723.5, from memory, unverified): a bot that controls another player ("you control target opponent during their next turn") makes that
 * player's decisions from its own view (which shows what that player can see, CR 723.4), and the engine accepts them; every action names the controlled player.
 * The bot plays the controlled player's turn with its ordinary heuristics (it does not yet play it against that player's interest).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, createGame, decidingPlayer, viewFor, type CardDef, type GameState, type OracleCard } from '@openmtg/engine';
import { chooseAction } from '../src/index';

const MIND: CardDef = compileCard({ name: 'Test Mindwhip', mana_cost: '{0}', type_line: 'Sorcery', oracle_text: 'You control target opponent during their next turn.', colors: [] } as unknown as OracleCard);
const BEAR: CardDef = compileCard({ name: 'Test Bear', mana_cost: '{1}', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2', colors: [] } as unknown as OracleCard);
const PLAINS: CardDef = compileCard({ name: 'Plains', mana_cost: '', type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)', colors: [] } as unknown as OracleCard);

describe('CR 723.5: the bot that controls a player answers that player\'s decisions', () => {
  it('Alice (the bot) casts the control spell on turn 1; in Bob\'s turn 2 the bot answers every decision of Bob, each accepted by the engine', () => {
    const deckA = ['Test Mindwhip', ...Array(39).fill('Plains')];
    const deckB = [...Array(20).fill('Test Bear'), ...Array(20).fill('Plains')];
    let s: GameState = createGame({ seed: 'std-control-3-ai', players: [{ name: 'Alice', deck: deckA }, { name: 'Bob', deck: deckB }], defs: [MIND, BEAR, PLAINS], options: { startingPlayer: 'p1', skipMulligans: true } });
    // Alice's hand holds the Mindwhip only if it was drawn: put it there
    s = structuredClone(s);
    const lib = s.zones.library.p1!;
    const mind = lib.find((id) => s.objects[id]!.defId === 'Test Mindwhip');
    if (mind !== undefined) {
      s.zones.library.p1 = lib.filter((id) => id !== mind);
      s.zones.hand.p1!.push(mind);
      s.objects[mind]!.zone = 'hand';
    }
    let controlled = 0;
    for (let i = 0; i < 400 && s.turn.number < 3 && !s.result; i++) {
      const d = s.pending!;
      const by = decidingPlayer(d);
      if (s.turn.number === 2 && d.player === 'p2') {
        expect(by).toBe('p1');
        controlled++;
      }
      const action = chooseAction(viewFor(s, by), d, `seed-${i}`);
      expect((action as { player: string }).player).toBe(d.player);
      const r = applyAction(s, action);
      expect(r.error, JSON.stringify(action)).toBeUndefined();
      s = r.state;
    }
    expect(controlled).toBeGreaterThan(0);
    expect(s.turn.number).toBe(3);
  });
});
