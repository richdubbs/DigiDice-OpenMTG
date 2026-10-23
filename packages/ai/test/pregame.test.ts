/**
 * FAST4 MX1: the bot's answer to the opening-hand action of CR 103.6a ("If this card is in your opening hand, you may begin the game with it on the
 * battlefield", core/pregame.ts): a `chooseObjects` decision over its own hand cards with min 0; the bot puts every such card onto the battlefield.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, viewFor } from '@openmtg/engine';
import { chooseAction } from '../src/index';
import { gameConfig } from './decks';

describe('CR 103.6a: the bot begins the game with its Leylines on the battlefield', () => {
  it('chooses every offered card', () => {
    const cfg = gameConfig('mx1-ai-pregame', [['Leyline of the Void', 40]], [['Plains', 40]], { mulligans: false });
    let s = createGame({ ...cfg, options: { ...cfg.options, startingPlayer: 'p1' } });
    const d = s.pending!;
    expect(d).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0, rules: ['CR 103.6', 'CR 103.6a'] });
    const action = chooseAction(viewFor(s, 'p1'), d, 'seed');
    const r = applyAction(s, action);
    expect(r.error).toBeUndefined();
    s = r.state;
    expect(s.zones.battlefield).toHaveLength(7);
    expect(s.stage).toBe('playing');
  });
});
