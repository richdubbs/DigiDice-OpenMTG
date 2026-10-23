/**
 * M12-6: the mulligan prompt of a multiplayer game. The first mulligan is free in every multiplayer game (CR 103.5c, 800.6; the
 * engine's core/start.ts#mulligans): taking it puts no card on the bottom, so the hint must not say "you will put 1 card from it on the bottom", and after
 * it no card is on the bottom. Real 4-player states and the engine's own mulligan decisions.
 */
import { cleanup, render } from '@testing-library/react';
import { applyAction, createGame, viewFor, type GameConfig, type GameState, type MulliganDecision } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameBoard } from '../../src/board';
import { MulliganPrompt } from '../../src/prompts/SimplePrompts';
import { FIXTURE_DEFS } from '../game-fixtures';

afterEach(cleanup);

const id = (name: string) => FIXTURE_DEFS.find((d) => d.name === name)!.id;
const DECK = [...Array<string>(17).fill(id('Forest')), ...Array<string>(23).fill(id('Test Bear'))];

function config(players: number): GameConfig {
  return {
    seed: 'm12-6-mulligan',
    players: ['Alice', 'Bob', 'Carol', 'Dan'].slice(0, players).map((name, i) => ({ id: `p${i + 1}`, name, deck: DECK })),
    defs: FIXTURE_DEFS,
    options: { startingPlayer: 'p1', ...(players > 2 ? { multiplayer: { variant: 'freeForAll', attack: 'multiple' } } : {}) },
  };
}

/** The game at Alice's mulligan decision after she has taken `taken` mulligans (everyone else keeps). */
function atMulligan(players: number, taken: number): GameState {
  let s = createGame(config(players));
  let done = 0;
  for (let i = 0; i < 200; i++) {
    const d = s.pending!;
    if (d.kind === 'mulligan' && d.player === 'p1' && d.mulligans === taken) return s;
    let r;
    if (d.kind === 'mulligan') r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'mulligan', keep: d.player !== 'p1' } });
    else if (d.kind === 'chooseObjects') r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseObjects', ids: d.options.slice(0, d.min) } });
    else throw new Error(`unexpected ${d.kind}`);
    if (r.error) throw new Error(r.error.message);
    s = r.state;
    if (d.kind === 'mulligan' && d.player === 'p1') done++;
  }
  throw new Error(`no mulligan decision after ${done} mulligans`);
}

function show(s: GameState): void {
  const v = viewFor(s, 'p1');
  const d = v.pending as MulliganDecision;
  render(<GameBoard view={v} prompt={<MulliganPrompt d={d} view={v} legal={[]} answer={vi.fn()} act={vi.fn()} busy={false} />} />);
}

const hint = (): string => document.querySelector('.prompt-mulligan-hint')!.textContent!;
const detail = (): string => document.querySelector('.prompt-detail')!.textContent!;

describe('M12-6: the free first mulligan of a multiplayer game (CR 103.5c, 800.6)', () => {
  it('before the first mulligan: it is free and puts nothing on the bottom', () => {
    const s = atMulligan(4, 0);
    expect(s.pending!.prompt).toContain('(Your first mulligan is free.)');
    show(s);
    expect(hint()).toBe('Your first mulligan is free: it draws a new hand and puts nothing on the bottom of your library (CR 103.5c, 800.6).');
    expect(hint()).not.toMatch(/put 1 card/);
  });

  it('after the free mulligan: no card is on the bottom, seven cards in hand; the next mulligan puts one card there', () => {
    const s = atMulligan(3, 1);
    expect(s.zones.hand['p1']!.length).toBe(7); // the engine put nothing on the bottom
    show(s);
    expect(detail()).toContain('You took 1 mulligan; 0 cards are already on the bottom of your library.');
    expect(detail()).not.toMatch(/1 card is already on the bottom/);
    expect(hint()).toBe('A mulligan draws a new hand: you will put 1 card from it on the bottom of your library.');
  });

  it('after two mulligans: one card is on the bottom (the free one not counted)', () => {
    const s = atMulligan(4, 2);
    expect(s.zones.hand['p1']!.length).toBe(6);
    show(s);
    expect(detail()).toContain('You took 2 mulligans; 1 card is already on the bottom of your library.');
    expect(hint()).toMatch(/put 2 cards from it on the bottom/);
  });

  it('two players: no free mulligan, as before', () => {
    const s = atMulligan(2, 0);
    show(s);
    expect(hint()).toBe('A mulligan draws a new hand: you will put 1 card from it on the bottom of your library.');
  });
});
