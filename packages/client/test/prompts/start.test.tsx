/** Start of game (CR 103): who plays first, keep or mulligan, and the cards put on the bottom after a mulligan (a chooseObjects decision). */
import { screen } from '@testing-library/react';
import { createGame, type GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { smallConfig } from '../helpers';
import { click, drive, pendingKind, press, renderPrompt, setState } from './harness';

function toMulligan(seed: string): GameState {
  const s = createGame(smallConfig(seed));
  expect(s.pending?.kind).toBe('playFirst');
  return s;
}

describe('start of game prompts (CR 103)', () => {
  it('CR 103.1: the chosen player decides who plays first; "I play first" answers with themselves', async () => {
    const s = toMulligan('prompt-playfirst');
    const chooser = s.pending!.player;
    const { conn } = renderPrompt(s);
    expect(screen.getByRole('button', { name: 'I play first' })).toBeTruthy();
    const other = s.players.find((p) => p.id !== chooser)!;
    expect(screen.getByRole('button', { name: `${other.name} plays first` })).toBeTruthy();
    await click('I play first');
    expect(conn.lastAnswer()).toEqual({ kind: 'playFirst', player: chooser });
    expect(conn.errors).toEqual([]);
    expect(pendingKind(conn)).toBe('mulligan');
  });

  it('CR 103.1: choosing the other player to go first', async () => {
    const s = toMulligan('prompt-playfirst-2');
    const other = s.players.find((p) => p.id !== s.pending!.player)!;
    const { conn } = renderPrompt(s);
    await click(`${other.name} plays first`);
    expect(conn.lastAnswer()).toEqual({ kind: 'playFirst', player: other.id });
    expect(conn.state.turn.activePlayer).toBe(other.id);
  });

  it('CR 103.5: Keep (also Space) keeps the hand and shows the cards in it', async () => {
    let s = toMulligan('prompt-keep');
    s = drive(s, [{ kind: 'playFirst', player: s.pending!.player }]);
    const { conn } = renderPrompt(s);
    expect(screen.getByText(/Your hand: /).textContent).toMatch(/Forest|Test Bear/);
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'mulligan', keep: true });
    expect(conn.errors).toEqual([]);
  });

  it('CR 103.5: taking a mulligan puts one card of the new hand on the bottom right away (chooseObjects, exactly one)', async () => {
    let s = toMulligan('prompt-mull');
    s = drive(s, [{ kind: 'playFirst', player: s.pending!.player }]);
    const mulliganer = s.pending!.player;
    const { conn } = renderPrompt(s);
    await click(/^Mulligan/);
    expect(conn.lastAnswer()).toEqual({ kind: 'mulligan', keep: false });
    // The other player declares in turn order too (outside the UI, CR 103.5). Then the mulligan is taken: the new hand is drawn and the engine asks at once
    // which card of it goes on the bottom, before any further keep-or-mulligan question.
    let t = conn.state;
    for (let i = 0; i < 4 && t.pending?.kind === 'mulligan' && t.pending.player !== mulliganer; i++) t = drive(t, [{ kind: 'mulligan', keep: true }]);
    await setState(conn, t);
    expect(conn.state.pending).toMatchObject({ kind: 'chooseObjects', player: mulliganer, min: 1, max: 1 });
    const ok = screen.getByRole('button', { name: 'Put on the bottom' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true); // nothing chosen yet: exactly one is needed
    const first = screen.getByRole('group', { name: 'Choices' }).querySelector('button')!;
    await click(first.textContent!);
    expect(ok.disabled).toBe(false);
    const chosen = first.getAttribute('data-id')!;
    const card = conn.state.objects[chosen]!.cardId;
    await click('Put on the bottom');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseObjects', ids: [chosen] });
    expect(conn.errors).toEqual([]);
    const bottom = conn.state.zones.library[mulliganer]!.at(-1)!;
    expect(conn.state.objects[bottom]!.cardId).toBe(card); // CR 103.5: that card is now the bottom card of the library
    expect(conn.state.zones.hand[mulliganer]).toHaveLength(6);
  });

  it('CR 103.5: the keep-or-mulligan question after a mulligan says the card is already on the bottom; keeping costs nothing more', async () => {
    let s = toMulligan('prompt-mull-2');
    s = drive(s, [{ kind: 'playFirst', player: s.pending!.player }]);
    const mulliganer = s.pending!.player;
    s = drive(s, [{ kind: 'mulligan', keep: false }]);
    for (let i = 0; i < 4 && s.pending?.kind === 'mulligan' && s.pending.player !== mulliganer; i++) s = drive(s, [{ kind: 'mulligan', keep: true }]);
    // Taking the mulligan includes putting one card on the bottom (CR 103.5); only then is the mulliganer asked again, with the 6-card hand.
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: mulliganer });
    s = drive(s, [{ kind: 'chooseObjects', ids: [(s.pending as { options: string[] }).options[0]!] }]);
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: mulliganer, mulligans: 1, handSize: 5 });
    expect(s.zones.hand[mulliganer]).toHaveLength(6);
    const { conn } = renderPrompt(s);
    const detail = screen.getByText(/Your hand: /).textContent!;
    expect(detail).not.toMatch(/If you keep, you put/);
    expect(detail).toMatch(/You took 1 mulligan; 1 card is already on the bottom of your library\./);
    expect(screen.getByRole('button', { name: 'Keep 6' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mulligan (keep 5 after)' })).toBeTruthy();
    await click('Keep 6');
    expect(conn.errors).toEqual([]);
    expect(conn.state.zones.hand[mulliganer]).toHaveLength(6); // keeping puts nothing more on the bottom
  });
});
