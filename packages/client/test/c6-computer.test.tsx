/**
 * C6: playing against the computer (packages/ai in the client). The computer is player 2, away from the screen: it acts through its own seat of the
 * LocalConnection, reads only its own player's view (CR 400.2) and answers with `chooseAction`; the screen shows the human's view the whole game and never
 * a pass cover.
 */
import { act as reactAct, render, screen, within, fireEvent } from '@testing-library/react';
import { AI_STOPS, chooseAction } from '@openmtg/ai';
import { HIDDEN_DEF, type Action, type Decision, type GameConfig, type GameView } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalConnection } from '../src/connection/LocalConnection';
import type { GameConnection } from '../src/connection/GameConnection';
import { ComputerGame, attachComputerPacer, computerDelayMs, fallback, fallbacks, runComputer, type Chooser, type ComputerPacer } from '../src/game/computer';
import { sealConnection } from '../src/game/sealed';
import { hotSeatConfig, renderGameApp } from './game-fixtures';

afterEach(() => {
  vi.useRealTimers();
});

function config(seed: string, extra: Partial<GameConfig['options']> = {}): GameConfig {
  const c = hotSeatConfig(seed, 8);
  return { ...c, options: { ...c.options, ...extra } };
}

/** Lets the computer's timers and the connection's promises run (delay 0). */
async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/** The computer's chooser, checking that every view it gets is its own player's view with the human's hand and library hidden (CR 400.2). */
function checkedAi(seen: { views: number }): Chooser {
  return (view: GameView, d: Decision, seed: string) => {
    seen.views++;
    expect(view.viewer).toBe('p2');
    expect(d.player).toBe('p2');
    for (const id of [...(view.zones.hand.p1 ?? []), ...(view.zones.library.p1 ?? []), ...(view.zones.library.p2 ?? [])]) {
      expect(view.objects[id]!.defId).toBe(HIDDEN_DEF);
    }
    return chooseAction(view, d, seed);
  };
}

/** The human's simple script: play a land and cast whatever it can in its main phases, attack with everything, never block; the AI answers the rest. */
function human(conn: LocalConnection | ComputerGame): Action {
  const v = conn.view();
  const d = v.pending!;
  if (d.kind === 'priority') {
    const legal = conn.legalActions();
    const main = v.turn.activePlayer === 'p1' && (v.turn.step === 'main1' || v.turn.step === 'main2') && v.zones.stack.length === 0;
    const play = main ? (legal.find((l) => l.kind === 'playLand') ?? legal.find((l) => l.kind === 'cast')) : undefined;
    return play ? play.action : { type: 'pass', player: 'p1' };
  }
  return chooseAction(v, d, `human:${d.id}`);
}

describe('LocalConnection with one seat (C6)', () => {
  it('shows the seated player from the start and never hands off; the other player acts only through its own seat', async () => {
    const conn = new LocalConnection(config('c6-seats', { startingPlayer: 'p2' }), { seats: ['p1'] });
    expect(conn.view().viewer).toBe('p1');
    expect(conn.handoff()).toBeNull();
    expect(conn.seated()).toEqual(['p1']);
    const bot = conn.seat('p2');
    expect(() => conn.seat('p1')).toThrow();
    // The engine waits for p2 (its mulligan, CR 103.5): the screen keeps p1's view, says nothing to hand off, and refuses p2's actions here.
    const d = bot.view().pending!;
    expect(d.player).toBe('p2');
    expect(conn.handoff()).toBeNull();
    expect(conn.view().viewer).toBe('p1');
    const answer = chooseAction(bot.view(), d, 's');
    expect((await conn.act(answer)).ok).toBe(false);
    expect((await bot.act({ type: 'concede', player: 'p1' })).ok).toBe(false);
    expect((await conn.act({ type: 'concede', player: 'p2' })).ok).toBe(false); // CR 104.3a: only a player at this screen concedes here
    expect((await bot.act(answer)).ok).toBe(true);
    expect(bot.canUndo()).toBe(false);
  });
});

describe('runComputer (C6)', () => {
  it('answers only its own decisions, after the delay, from its own view', async () => {
    vi.useFakeTimers();
    const conn = new LocalConnection(config('c6-run', { startingPlayer: 'p2' }), { seats: ['p1'] });
    const seen = { views: 0 };
    const stop = runComputer(conn.seat('p2'), { delayMs: 500, seed: 't', choose: checkedAi(seen) });
    expect(conn.seat('p2').view().pending?.player).toBe('p2');
    await vi.advanceTimersByTimeAsync(499);
    expect(seen.views).toBe(0); // the move waits for the delay, so the human sees one move at a time
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.views).toBe(1);
    // Now the human decides: the computer waits however long it takes.
    await vi.advanceTimersByTimeAsync(5000);
    expect(conn.view().pending!.player).toBe('p1');
    const before = seen.views;
    stop();
    await reactAct(async () => {
      await conn.act(human(conn));
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.views).toBe(before); // stopped
  });

  /** A stand-in for the game screen's PacedConnection: busy until `idle()`. */
  function fakePacer(busy = true) {
    const listeners = new Set<() => void>();
    const state = { busy };
    const pacer: ComputerPacer = {
      busy: () => state.busy,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const set = (b: boolean) => {
      state.busy = b;
      for (const l of [...listeners]) l();
    };
    return { pacer, listeners, idle: () => set(false), busy: () => set(true) };
  }

  it('F8: does not act while the board is busy; after it goes idle, acts after the usual pause (not shortened by the stack)', async () => {
    vi.useFakeTimers();
    const conn = new LocalConnection(config('c6-pacer', { startingPlayer: 'p2' }), { seats: ['p1'] });
    const seen = { views: 0 };
    const board = fakePacer();
    const stop = runComputer(conn.seat('p2'), { delayMs: 500, seed: 't', choose: checkedAi(seen), pacer: board.pacer });
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.views).toBe(0); // the board is still showing the last change
    board.idle();
    await vi.advanceTimersByTimeAsync(499);
    expect(seen.views).toBe(0); // then the person-like pause
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.views).toBe(1);
    stop();
    expect(board.listeners.size).toBe(0);
  });

  it('F8: a board that gets busy during the pause is waited for again; one busy for too long is not waited for forever', async () => {
    vi.useFakeTimers();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const conn = new LocalConnection(config('c6-pacer-stuck', { startingPlayer: 'p2' }), { seats: ['p1'] });
    const seen = { views: 0 };
    const board = fakePacer(false);
    const stop = runComputer(conn.seat('p2'), { delayMs: 500, seed: 't', choose: checkedAi(seen), pacer: board.pacer, maxBoardWaitMs: 8000 });
    await vi.advanceTimersByTimeAsync(300);
    board.busy(); // a change started animating during the pause
    await vi.advanceTimersByTimeAsync(7000);
    expect(seen.views).toBe(0);
    await vi.advanceTimersByTimeAsync(1200); // 8 s of waiting (from the end of the pause) then the pause again
    expect(seen.views).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen.views).toBe(1); // acted although the board never went idle
    expect(debug).toHaveBeenCalled();
    stop();
    debug.mockRestore();
  });

  it('F8: the game screen attaches its pace by the sealed connection; the computers wait for it, and stop waiting once it is detached', async () => {
    vi.useFakeTimers();
    const seen = { views: 0 };
    const game = new ComputerGame(config('c6-attach', { startingPlayer: 'p2' }), 'p1', 'p2', { delayMs: 500, seed: 's', choose: checkedAi(seen) });
    const off = game.subscribe(() => {});
    const board = fakePacer();
    const detach = attachComputerPacer(sealConnection(game), board.pacer);
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.views).toBe(0);
    board.idle();
    await vi.advanceTimersByTimeAsync(500);
    expect(seen.views).toBe(1);
    board.busy();
    const n = seen.views;
    // The human answers until the computer has a decision again.
    for (let i = 0; i < 20 && game.local.session.state.pending?.player === 'p1'; i++) {
      await reactAct(async () => {
        await game.act(human(game));
      });
    }
    expect(game.local.session.state.pending?.player).toBe('p2');
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.views).toBe(n); // its next decision waits for the board too
    detach();
    expect(board.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen.views).toBeGreaterThan(n); // no board: the delay alone
    off();
    expect(attachComputerPacer({}, board.pacer)).toBeTypeOf('function'); // not a game against the computer: nothing to attach
  });

  it('passes priority instead when the AI throws, and never acts for the human', async () => {
    vi.useFakeTimers();
    const conn = new LocalConnection(config('c6-throw', { startingPlayer: 'p2', skipMulligans: true }), { seats: ['p1'] });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = runComputer(conn.seat('p2'), {
      delayMs: 0,
      seed: 't',
      choose: () => {
        throw new Error('broken AI');
      },
    });
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(errors).toHaveBeenCalled();
    expect(conn.session.actions.some((a) => a.type === 'pass' && a.player === 'p2')).toBe(true);
    expect(conn.session.actions.every((a) => a.type === 'startGame' || a.player === 'p2')).toBe(true);
    errors.mockRestore();
  });

  it('CR 103.5: on a decision it cannot pass or cancel (its mulligan), a failing AI falls back to a legal answer (keep) instead of stopping the game', async () => {
    vi.useFakeTimers();
    const conn = new LocalConnection(config('c6-fallback', { startingPlayer: 'p2' }), { seats: ['p1'] });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(conn.seat('p2').view().pending!.kind).toBe('mulligan');
    const stuck: (string | null)[] = [];
    const stop = runComputer(conn.seat('p2'), {
      delayMs: 100,
      seed: 't',
      choose: () => {
        throw new Error('broken AI');
      },
      onStuck: (m) => stuck.push(m),
    });
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    expect(stuck).toEqual([]);
    expect(conn.session.actions.some((a) => a.type === 'answer' && a.player === 'p2')).toBe(true);
    errors.mockRestore();
  });

  it('CR 103.5: when no answer at all is accepted, the computer retries once, then stops and reports it', async () => {
    vi.useFakeTimers();
    const conn = new LocalConnection(config('c6-stuck', { startingPlayer: 'p2' }), { seats: ['p1'] });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const stuck: (string | null)[] = [];
    const stop = runComputer(rejecting(conn.seat('p2')), {
      delayMs: 100,
      seed: 't',
      choose: () => {
        calls++;
        throw new Error('broken AI');
      },
      onStuck: (m) => stuck.push(m),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    stop();
    expect(calls).toBe(2); // one retry, then no loop
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatch(/could not decide/i);
    expect(conn.session.actions.every((a) => a.type === 'startGame')).toBe(true);
    errors.mockRestore();
  });

  it('owner 2026-10-21: a target choice with "up to one" falls back to no target, and a manual text resolves with no adjustments', () => {
    const t = { id: 'd2', player: 'p2', prompt: 'Choose 0 to 1 target(s).', kind: 'chooseTargets' as const, targetText: 'up to one target creature', objects: ['o1'], players: [], min: 0, max: 1 };
    expect(fallbacks(t as Decision)[0]).toEqual({ type: 'answer', player: 'p2', decisionId: 'd2', answer: { kind: 'chooseTargets', targets: [] } });
    const m = { id: 'd3', player: 'p2', prompt: 'Resolve by hand.', kind: 'manualResolve' as const, sourceName: 'X', text: 'Do a thing.' };
    expect(fallbacks(m as Decision)).toEqual([{ type: 'answer', player: 'p2', decisionId: 'd3', answer: { kind: 'manualResolve', ops: [] } }]);
  });
});

/** A seat whose every action is rejected (the computer's "no answer works" case). */
function rejecting(seat: GameConnection): GameConnection {
  return Object.assign(Object.create(seat) as GameConnection, { act: async () => ({ ok: false as const, error: { message: 'rejected', rules: [] } }) });
}

describe('ComputerGame (New game "The computer")', () => {
  it('CR 509.1, 509.1c: when the AI blockers are rejected (the declaration is not cancellable), it falls back to the engine example or no blocks', () => {
    const base = { id: 'd1', player: 'p2', prompt: 'Declare blockers.', kind: 'declareBlockers' as const, candidates: [], needsMultiple: [] };
    expect(fallback(base as Decision)).toEqual({ type: 'answer', player: 'p2', decisionId: 'd1', answer: { kind: 'declareBlockers', blocks: [] } });
    const obeying = [{ blocker: 'o2', attacker: 'o1' }];
    expect(fallback({ ...base, mustObey: 1, obeying } as Decision)).toEqual({ type: 'answer', player: 'p2', decisionId: 'd1', answer: { kind: 'declareBlockers', blocks: obeying } });
    expect(fallback({ ...base, obeying } as Decision)).toEqual({ type: 'answer', player: 'p2', decisionId: 'd1', answer: { kind: 'declareBlockers', blocks: [] } }); // a hint only
  });
  it('gives the computer the AI stops and plays only while the screen is subscribed', async () => {
    const seen = { views: 0 };
    const game = new ComputerGame(config('c6-sub', { startingPlayer: 'p2' }), 'p1', 'p2', { delayMs: 0, seed: 's', choose: checkedAi(seen) });
    expect(game.local.session.state.players.find((p) => p.id === 'p2')!.stops).toEqual(AI_STOPS);
    expect(game.seated()).toEqual(['p1']);
    await settle();
    expect(seen.views).toBe(0); // nobody is watching: the computer does not play
    const off = game.subscribe(() => {});
    await settle();
    expect(seen.views).toBeGreaterThan(0);
    off();
    const n = seen.views;
    const d = game.view().pending!;
    if (d.player === 'p1') await game.act(human(game));
    await settle();
    expect(seen.views).toBe(n);
  });

  it('CR 103-104, 704.5a, 400.2: a whole game, the human scripted against the AI, ends with a winner on life; the computer never sees a hidden card', async () => {
    const seen = { views: 0 };
    const game = new ComputerGame(config('c6-full', { startingLife: 20 }), 'p1', 'p2', { delayMs: 0, seed: 'full', choose: checkedAi(seen) });
    const off = game.subscribe(() => {});
    for (let i = 0; i < 3000 && !game.view().result; i++) {
      const d = game.view().pending;
      if (d && d.player === 'p1') {
        const r = await game.act(human(game));
        expect(r.ok).toBe(true);
      } else await settle(1);
      expect(game.handoff()).toBeNull();
      expect(game.view().viewer).toBe('p1');
    }
    off();
    const v = game.view();
    expect(v.result).not.toBeNull();
    expect(v.result!.winner).not.toBeNull(); // not a draw (CR 104.4a)
    const loser = v.players.find((p) => p.id !== v.result!.winner)!;
    expect(loser.lostReason).toBe('has 0 or less life'); // CR 704.5a
    expect(seen.views).toBeGreaterThan(5);
    // The computer played: lands and spells of its own (CR 305.1, 601.2).
    expect(game.local.session.actions.some((a) => a.type === 'playLand' && a.player === 'p2')).toBe(true);
    expect(game.local.session.actions.some((a) => a.type === 'cast' && a.player === 'p2')).toBe(true);
  }, 120_000);

  it('the game screen shows the human the whole game: no pass cover, "Waiting for Computer" while it decides, and only the human can concede', async () => {
    vi.useFakeTimers();
    const game = new ComputerGame({ ...config('c6-screen', { startingPlayer: 'p2' }), players: config('c6-screen').players.map((p, i) => (i === 1 ? { ...p, name: 'Computer' } : p)) }, 'p1', 'p2', {
      delayMs: 400,
      seed: 's',
    });
    const { container } = render(renderGameApp(game));
    expect(screen.queryByRole('dialog', { name: /^Pass to / })).toBeNull();
    expect(container.querySelector('.game-board')).not.toBeNull();
    expect(container.querySelector('.prompt-bar')!.textContent).toContain('Waiting for Computer.');
    // Alice's hand is face up from the start; the computer's is card backs.
    expect(container.querySelectorAll('.hand-own .board-card').length).toBe(7);
    expect(container.querySelectorAll('.hand-hidden .board-card-back').length).toBe(7);
    await reactAct(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
    const dialog = screen.getByRole('dialog', { name: 'Concede' });
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Alice concedes']));
    expect(within(dialog).queryByRole('button', { name: 'Computer concedes' })).toBeNull();
  });

  it('CR 103.5: when the computer is stuck on a decision, the game screen says so instead of waiting forever', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = config('c6-stuck-screen', { startingPlayer: 'p2' });
    const game = new ComputerGame({ ...base, players: base.players.map((p, i) => (i === 1 ? { ...p, name: 'Computer' } : p)) }, 'p1', 'p2', {
      delayMs: 100,
      seed: 's',
      choose: () => {
        throw new Error('broken AI');
      },
    });
    const seat = game.local.seat.bind(game.local);
    game.local.seat = (p) => rejecting(seat(p));
    render(renderGameApp(game));
    await reactAct(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(game.status()).toMatch(/Computer could not decide/);
    expect(screen.getByRole('alert').textContent).toMatch(/Computer could not decide/);
    errors.mockRestore();
  });

  it('the delay follows the animation speed and is never zero', () => {
    expect(computerDelayMs('off')).toBeGreaterThan(0);
    expect(computerDelayMs('slow')).toBeGreaterThan(computerDelayMs('normal'));
    expect(computerDelayMs('normal')).toBeGreaterThan(computerDelayMs('fast'));
  });
});
