import { describe, expect, it } from 'vitest';
import { applyAction, createGame, type GameState } from '../../src/index';
import { act, answer, simpleConfig, startedGame } from '../helpers';

const handOf = (s: GameState, p: string) => s.zones.hand[p]!;
const libOf = (s: GameState, p: string) => s.zones.library[p]!;

describe('starting the game (CR 103)', () => {
  it('CR 103.1: a randomly chosen player chooses who plays first', () => {
    const s = createGame(simpleConfig('seed-1'));
    expect(s.pending?.kind).toBe('playFirst');
    const chooser = s.pending!.player;
    const other = chooser === 'p1' ? 'p2' : 'p1';
    const s2 = answer(s, { kind: 'playFirst', player: other });
    expect(s2.turn.startingPlayer).toBe(other);
    expect(s2.players[0]!.id).toBe(other); // turn order starts with the starting player
  });

  it('CR 103.4/103.5: players start at 20 life with seven cards and decide mulligans in turn order', () => {
    const s = createGame({ ...simpleConfig(), options: { startingPlayer: 'p2' } });
    expect(s.players.map((p) => p.life)).toEqual([20, 20]);
    expect(handOf(s, 'p1')).toHaveLength(7);
    expect(handOf(s, 'p2')).toHaveLength(7);
    expect(libOf(s, 'p1')).toHaveLength(33);
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p2' });
  });

  it('CR 103.5: a mulligan redraws seven, then puts cards equal to the mulligan count on the bottom', () => {
    let s = createGame({ ...simpleConfig(), options: { startingPlayer: 'p1' } });
    s = answer(s, { kind: 'mulligan', keep: false }); // p1 mulligans
    s = answer(s, { kind: 'mulligan', keep: true }); // p2 keeps
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
    expect(handOf(s, 'p1')).toHaveLength(7);
    const bottom = handOf(s, 'p1')[0]!;
    const cardId = s.objects[bottom]!.cardId;
    s = answer(s, { kind: 'chooseObjects', ids: [bottom] });
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p1' }); // asked again with 6 cards
    expect(handOf(s, 'p1')).toHaveLength(6);
    const lib = libOf(s, 'p1');
    expect(s.objects[lib[lib.length - 1]!]!.cardId).toBe(cardId);
    s = answer(s, { kind: 'mulligan', keep: true });
    expect(s.stage).toBe('playing');
    expect(handOf(s, 'p1')).toHaveLength(6);
    expect(s.players.find((p) => p.id === 'p1')!.mulligans).toBe(1);
  });

  it('CR 103.8a: the starting player skips their first draw step', () => {
    const s = startedGame();
    expect(s.turn.number).toBe(1);
    expect(s.turn.activePlayer).toBe('p1');
    // fullControl: priority in upkeep first.
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.turn.step).toBe('upkeep');
    let t = act(s, { type: 'pass', player: 'p1' });
    t = act(t, { type: 'pass', player: 'p2' });
    expect(t.turn.step).toBe('main1'); // draw step skipped
    expect(handOf(t, 'p1')).toHaveLength(7);
  });
});

describe('priority and turn structure skeleton (CR 117, 500)', () => {
  it('CR 117.4: when all players pass with an empty stack, the step ends', () => {
    let s = startedGame();
    const steps: string[] = [s.turn.step];
    for (let i = 0; i < 40 && s.turn.number === 1; i++) {
      s = act(s, { type: 'pass', player: s.pending!.player });
      if (s.turn.number === 1) steps.push(s.turn.step);
    }
    // No attackers declared, so declare blockers and combat damage are skipped (CR 508.8).
    expect([...new Set(steps)]).toEqual(['upkeep', 'main1', 'beginCombat', 'declareAttackers', 'endCombat', 'main2', 'end']);
    expect(s.turn.number).toBe(2);
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.turn.step).toBe('upkeep');
  });

  it('CR 504.1: turn 2 draw step draws a card', () => {
    let s = startedGame();
    while (s.turn.number < 2 || s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
    expect(handOf(s, 'p2')).toHaveLength(8);
  });

  it('CR 733.1: illegal actions are rejected with an explanation and no state change', () => {
    const s = startedGame();
    const r = applyAction(s, { type: 'pass', player: 'p2' });
    expect(r.error?.message).toMatch(/has priority/);
    expect(r.error?.rules).toContain('CR 117.1');
    expect(r.state).toBe(s);
    const r2 = applyAction(s, { type: 'answer', player: 'p1', decisionId: 'nope', answer: { kind: 'yesNo', yes: true } });
    expect(r2.error).toBeDefined();
  });

  it('rejects an invalid answer and keeps the decision pending', () => {
    let s = createGame({ ...simpleConfig(), options: { startingPlayer: 'p1' } });
    s = answer(s, { kind: 'mulligan', keep: false });
    s = answer(s, { kind: 'mulligan', keep: true });
    const d = s.pending!;
    const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseObjects', ids: [] } });
    expect(r.error?.message).toMatch(/exactly 1/);
    expect(r.state.pending).toEqual(d);
  });

  it('CR 704.5b: drawing from an empty library loses the game', () => {
    const cfg = simpleConfig();
    cfg.players[1]!.deck = Array(7).fill('Forest'); // Bob has only his opening hand
    let s = startedGame(cfg);
    while (!s.result) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.result).toMatchObject({ winner: 'p1' });
    expect(s.log.some((l) => l.rules?.includes('CR 704.5b'))).toBe(true);
  });

  it('CR 104.3a: a player can concede at any time', () => {
    const s = startedGame();
    const r = applyAction(s, { type: 'concede', player: 'p2' });
    expect(r.state.result).toMatchObject({ winner: 'p1' });
    expect(r.state.pending).toBeNull();
  });
});
