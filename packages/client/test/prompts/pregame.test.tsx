/**
 * FAST4 MX1: the opening-hand action of CR 103.6a ("If this card is in your opening hand, you may begin the game with it on the battlefield", engine
 * core/pregame.ts) as the client shows it: the generic choose-objects prompt over the player's own hand cards, any number of them (none keeps them).
 */
import { screen } from '@testing-library/react';
import { compileCard, createGame, type GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { smallConfig } from '../helpers';
import { click, renderPrompt } from './harness';

const LEYLINE = compileCard({
  name: 'Test Leyline', layout: 'normal', mana_cost: '{2}{B}{B}', type_line: 'Enchantment',
  oracle_text: 'If this card is in your opening hand, you may begin the game with it on the battlefield.',
});

function start(seed: string): GameState {
  const base = smallConfig(seed);
  const deck = Array<string>(40).fill('Test Leyline');
  return createGame({
    ...base,
    players: base.players.map((p) => ({ ...p, deck })),
    defs: [LEYLINE],
    options: { startingPlayer: 'p1', skipMulligans: true },
  });
}

describe('CR 103.6a: begin the game with cards on the battlefield', () => {
  it('the prompt lists the hand cards that may begin on the battlefield; the chosen one is put there', async () => {
    const s = start('mx1-pregame-1');
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0 });
    const { conn } = renderPrompt(s);
    expect(screen.getByText(/Begin the game with any of these cards on the battlefield\?/)).toBeTruthy();
    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(false); // none is a valid answer: the cards stay in the hand
    const first = screen.getByRole('group', { name: 'Choices' }).querySelector('button')!;
    expect(first.textContent).toMatch(/Test Leyline/);
    await click(first.textContent!);
    await click('OK');
    const chosen = first.getAttribute('data-id')!;
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseObjects', ids: [chosen] });
    expect(conn.errors).toEqual([]);
    expect(conn.state.zones.battlefield).toHaveLength(1);
    expect(conn.state.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' }); // then the next player in turn order (CR 103.6)
  });
});
