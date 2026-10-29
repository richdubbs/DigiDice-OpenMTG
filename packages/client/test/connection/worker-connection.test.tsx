/**
 * Review 2026-10-26 F1: a local game whose engine and AI run in the game worker (src/connection/WorkerConnection.ts on the page, gameHost.ts in the
 * worker, here run in the test's thread with message-like delivery, ./in-thread-worker.ts). The page gets exactly what a LocalConnection gives a screen:
 * the shown player's `viewFor`, legal actions and redacted events (CR 400.2), never a state; hot-seat hand-offs, undo above and below the floor
 * (CR 733.1), save and restore, the computer's pace (F8) and the replay recorder work through it as they do on the page.
 */
import { act as reactAct, render, screen } from '@testing-library/react';
import { chooseAction } from '@openmtg/ai';
import { GameSession, HIDDEN_DEF, checkReplay, gameDigest, replay, type Action, type Decision, type GameConfig, type GameView } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeGame } from '../../src/connection/closeGame';
import type { GameConnection } from '../../src/connection/GameConnection';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { WorkerConnection, bootstrapFrom } from '../../src/connection/WorkerConnection';
import { attachComputerPacer, fallback, withComputerStops, type Chooser, type ComputerPacer } from '../../src/game/computer';
import { sealConnection } from '../../src/game/sealed';
import { recordLocalGame } from '../../src/replays/record';
import { hotSeatConfig, renderGameApp } from '../game-fixtures';
import { smallConfig } from '../helpers';
import { duel, testEnv } from '../replays/helpers';
import { InThreadWorker, deliver } from './in-thread-worker';

afterEach(() => {
  vi.useRealTimers();
});

type Make = (worker: () => InThreadWorker) => WorkerConnection;

/** A game in an in-thread worker, once the worker has sent its first change. */
async function open(make: Make, chooser?: Chooser): Promise<{ conn: WorkerConnection; worker: InThreadWorker }> {
  const worker = new InThreadWorker(chooser ? { choose: chooser } : {});
  const conn = make(() => worker);
  await deliver();
  expect(await conn.ready).toBe(true);
  return { conn, worker };
}

/** Everything a screen reads of a connection, as text. */
function snap(c: GameConnection): string {
  return JSON.stringify({ view: c.view(), legal: c.legalActions(), handoff: c.handoff(), canUndo: c.canUndo(), events: c.events?.(), seated: c.seated?.(), status: c.status?.() ?? null });
}

function hiddenHand(view: GameView, player: string): boolean {
  return (view.zones.hand[player] ?? []).every((id) => view.objects[id]!.defId === HIDDEN_DEF);
}

/** Whether anything in `x` is a raw game state (the RNG, every zone and object) or a session. */
function holdsState(x: unknown, seen = new Set<unknown>()): boolean {
  if (x === null || typeof x !== 'object' || seen.has(x)) return false;
  seen.add(x);
  const o = x as Record<string, unknown>;
  if ('rng' in o || 'session' in o) return true;
  return Object.values(o).some((v) => holdsState(v, seen));
}

async function acceptHandoff(conn: WorkerConnection): Promise<void> {
  conn.acceptHandoff();
  await deliver();
}

/** Accept the pending hand-off, then answer start-of-game decisions (play first, keep) until someone has priority (as local-connection.test.tsx). */
async function startGame(conn: WorkerConnection): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (conn.handoff()) await acceptHandoff(conn);
    const d = conn.view().pending!;
    if (d.kind === 'priority') return;
    let a: Action;
    if (d.kind === 'playFirst') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'playFirst', player: d.player } };
    else if (d.kind === 'mulligan') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'mulligan', keep: true } };
    else throw new Error(`unexpected decision ${d.kind}`);
    const r = await conn.act(a);
    if (!r.ok) throw new Error(r.error.message);
  }
  throw new Error('game did not start');
}

describe('WorkerConnection (hot-seat, F1)', () => {
  it('starts with a hand-off to the first player and a spectator view (CR 400.2); a refused action carries the reason', async () => {
    const { conn } = await open((w) => WorkerConnection.hotSeat(smallConfig('w-start'), { worker: w }));
    const first = conn.handoff();
    expect(first).not.toBeNull();
    const v = conn.view();
    expect(v.viewer).toBeNull();
    expect(hiddenHand(v, 'p1') && hiddenHand(v, 'p2')).toBe(true);
    const r = await conn.act({ type: 'pass', player: first! });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/Pass the screen to/);
    expect(conn.view()).toBe(v); // nothing changed: the same object
    await acceptHandoff(conn);
    expect(conn.handoff()).toBeNull();
    expect(conn.view().viewer).toBe(first);
  });

  it("after the hand-off shows the acting player their own hand and hides the opponent's", async () => {
    const { conn } = await open((w) => WorkerConnection.hotSeat(smallConfig('w-accept', { options: { skipMulligans: true, startingPlayer: 'p1' } }), { worker: w }));
    expect(conn.handoff()).toBe('p1');
    await acceptHandoff(conn);
    const v = conn.view();
    expect(v.viewer).toBe('p1');
    expect(v.zones.hand.p1!.length).toBe(7);
    expect(hiddenHand(v, 'p1')).toBe(false);
    expect(hiddenHand(v, 'p2')).toBe(true);
  });

  it('gives the screen exactly what a LocalConnection gives it, change after change, as patches of the last view; never a state', async () => {
    const cfg = hotSeatConfig('w-mirror', 6);
    const local = new LocalConnection(cfg);
    const { conn, worker } = await open((w) => WorkerConnection.hotSeat(cfg, { worker: w }));
    const notified = vi.fn();
    const off = conn.subscribe(notified);
    expect(snap(conn)).toBe(snap(local));
    let steps = 0;
    let kept = 0;
    for (; steps < 120 && !local.view().result; steps++) {
      if (local.handoff()) {
        local.acceptHandoff();
        await acceptHandoff(conn);
        expect(snap(conn)).toBe(snap(local));
      }
      const d = local.view().pending!;
      let action: Action = chooseAction(local.view(), d, `w:${d.id}`);
      if (!(await local.act(action)).ok) {
        action = fallback(d)!;
        expect((await local.act(action)).ok).toBe(true);
      }
      const defs = conn.view().defs;
      const calls = notified.mock.calls.length;
      expect((await conn.act(action)).ok).toBe(true);
      expect(notified.mock.calls.length).toBeGreaterThan(calls);
      expect(snap(conn)).toBe(snap(local));
      expect(conn.view()).toBe(conn.view());
      // A patch keeps what did not change (here: the card definitions) as the same object, so the board's memos hold.
      if (JSON.stringify(conn.view().defs) === JSON.stringify(defs) && conn.view().defs === defs) kept++;
    }
    off();
    expect(steps).toBeGreaterThan(30);
    expect(kept).toBeGreaterThan(steps / 2);
    const changes = worker.fromWorker.filter((m) => m.t === 'change');
    expect(changes.filter((m) => m.t === 'change' && m.patch).length).toBeGreaterThan(changes.length / 2);
    // CR 400.2: nothing the worker posted is a state, a session or anything that holds one.
    expect(worker.fromWorker.some((m) => holdsState(m))).toBe(false);
  }, 60_000);

  it("undoes the shown player's own last action; never below the floor (a draw, CR 733.1); never the other player's action", async () => {
    const cfg = smallConfig('w-undo', { options: { skipMulligans: true, startingPlayer: 'p1' } });
    // Bob keeps the default stops, so the engine passes for him and Alice keeps priority until her main phase.
    const conf: GameConfig = { ...cfg, players: [cfg.players[0]!, { name: 'Bob', deck: cfg.players[1]!.deck }] };
    const { conn } = await open((w) => WorkerConnection.hotSeat(conf, { worker: w }));
    await acceptHandoff(conn);
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
    while (conn.view().turn.step !== 'main1') expect((await conn.act({ type: 'pass', player: 'p1' })).ok).toBe(true);
    const before = JSON.stringify(conn.view());
    const forest = () => conn.view().zones.hand.p1!.find((id) => conn.view().objects[id]!.defId === 'Forest')!;
    const land = forest();
    expect((await conn.act({ type: 'playLand', player: 'p1', card: land })).ok).toBe(true);
    expect(conn.canUndo()).toBe(true);
    expect(await conn.undoNow()).toBe(true);
    await deliver();
    expect(JSON.stringify(conn.view())).toBe(before);
    expect(conn.view().zones.hand.p1).toContain(land);

    // On to Alice's next main phase: cards were drawn on the way (library changes, never taken back).
    while (conn.view().turn.number < 3 || conn.view().turn.step !== 'main1') {
      if (conn.handoff()) await acceptHandoff(conn);
      const r = await conn.act(fallback(conn.view().pending!)!);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
    }
    if (conn.handoff()) await acceptHandoff(conn);
    const library = conn.view().zones.library.p1!.length;
    const atMain = JSON.stringify(conn.view());
    expect((await conn.act({ type: 'playLand', player: 'p1', card: forest() })).ok).toBe(true);
    expect(conn.undo()).toBe(true); // sent; the worker's change follows
    await deliver();
    expect(JSON.stringify(conn.view())).toBe(atMain);
    let undone = 0;
    while (await conn.undoNow()) {
      await deliver();
      undone++;
      expect(undone).toBeLessThan(10);
    }
    await deliver();
    expect(conn.canUndo()).toBe(false);
    expect(conn.view().zones.library.p1!.length).toBe(library); // the draw stayed

    // After a hand-off the other player's action is never theirs to take back.
    const other = await open((w) => WorkerConnection.hotSeat(smallConfig('w-undo-other', { options: { skipMulligans: true, startingPlayer: 'p1' } }), { worker: w }));
    await acceptHandoff(other.conn);
    expect((await other.conn.act({ type: 'pass', player: 'p1' })).ok).toBe(true);
    expect(other.conn.handoff()).toBe('p2');
    expect(other.conn.canUndo()).toBe(false);
    await acceptHandoff(other.conn);
    expect(other.conn.canUndo()).toBe(false);
    expect(other.conn.undo()).toBe(false);
  });

  it('saves as config + action log and restores the same game in a new worker', async () => {
    const { conn } = await open((w) => WorkerConnection.hotSeat(smallConfig('w-save'), { worker: w }));
    await startGame(conn);
    expect((await conn.act({ type: 'pass', player: conn.view().viewer! })).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(await conn.save())) as { config: GameConfig; actions: Action[] };
    expect(saved.actions.length).toBeGreaterThan(2);
    const ref = new LocalConnection(GameSession.fromJSON(saved));
    const restored = await open((w) => WorkerConnection.restore(saved, { kind: 'hotseat' }, { worker: w }));
    expect(snap(restored.conn)).toBe(snap(ref));
    ref.acceptHandoff();
    await acceptHandoff(restored.conn);
    expect(snap(restored.conn)).toBe(snap(ref));
    expect(restored.conn.recordSource().actions()).toEqual(saved.actions);
  });

  it('a rematch reads its connection at once: the first snapshot is worked out on the page, then the worker takes over', async () => {
    const cfg = smallConfig('w-bootstrap');
    const worker = new InThreadWorker();
    const conn = WorkerConnection.hotSeat(cfg, { worker: () => worker, bootstrap: bootstrapFrom(() => new LocalConnection(cfg)) });
    const ref = new LocalConnection(cfg);
    expect(snap(conn)).toBe(snap(ref));
    const early = conn.view();
    await deliver();
    expect(await conn.ready).toBe(true);
    expect(conn.view()).not.toBe(early);
    expect(snap(conn)).toBe(snap(ref));
    // Without a bootstrap, reading before the worker answered is a mistake of the caller.
    expect(() => WorkerConnection.hotSeat(cfg, { worker: () => new InThreadWorker() }).view()).toThrow(/await `ready`/);
  });

  it('a worker that fails: before its first change `ready` is false; later the screen says why and actions are refused', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const early = new InThreadWorker();
    const notStarted = WorkerConnection.hotSeat(smallConfig('w-fail-early'), { worker: () => early });
    early.crash('out of memory');
    expect(await notStarted.ready).toBe(false);

    const { conn, worker } = await open((w) => WorkerConnection.hotSeat(smallConfig('w-fail'), { worker: w }));
    const listener = vi.fn();
    conn.subscribe(listener);
    worker.crash('out of memory');
    expect(listener).toHaveBeenCalled();
    expect(conn.status()).toMatch(/The game stopped: out of memory/);
    const r = await conn.act({ type: 'concede', player: 'p1' });
    expect(r.ok).toBe(false);
    expect(conn.legalActions()).toEqual([]);
    errors.mockRestore();
  });

  it('the worker is closed when the game leaves the screen for good (by its sealed connection, as the navigation holds it)', async () => {
    const { conn, worker } = await open((w) => WorkerConnection.hotSeat(smallConfig('w-close'), { worker: w }));
    closeGame(sealConnection(conn));
    expect(worker.terminated).toBe(true);
    expect((await conn.act({ type: 'concede', player: 'p1' })).ok).toBe(false);
  });
});

/** The computer's chooser, checking that every view it gets is its own player's view with the human's hand and the libraries hidden (CR 400.2). */
function checkedAi(seen: { views: number }): Chooser {
  return (view: GameView, d: Decision, seed: string) => {
    seen.views++;
    expect(view.viewer).toBe('p2');
    for (const id of [...(view.zones.hand.p1 ?? []), ...(view.zones.library.p1 ?? []), ...(view.zones.library.p2 ?? [])]) expect(view.objects[id]!.defId).toBe(HIDDEN_DEF);
    return chooseAction(view, d, seed);
  };
}

function computerConfig(seed: string, extra: Partial<NonNullable<GameConfig['options']>> = {}, life = 8): GameConfig {
  const c = hotSeatConfig(seed, life);
  return { ...c, options: { ...c.options, ...extra } };
}

/** The human's simple script (as c6-computer.test.tsx): a land and whatever it can cast in its main phases, attack with everything; the AI answers the rest. */
function human(conn: GameConnection): Action {
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

describe('WorkerConnection against the computer (F1, F8)', () => {
  it('the computer plays in the worker only while a screen watches, waits for the board to show each change, then pauses like a person', async () => {
    vi.useFakeTimers();
    const seen = { views: 0 };
    const worker = new InThreadWorker({ choose: checkedAi(seen), microtasks: true });
    const conn = WorkerConnection.computer(computerConfig('w-pacer', { startingPlayer: 'p2' }), 'p1', 'p2', { delayMs: 500, seed: 's' }, { worker: () => worker });
    await vi.advanceTimersByTimeAsync(0);
    expect(await conn.ready).toBe(true);
    expect(conn.seated()).toEqual(['p1']);
    expect(conn.view().viewer).toBe('p1');
    expect(conn.handoff()).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.views).toBe(0); // nobody watches yet
    const off = conn.subscribe(() => {});
    const board = fakePacer();
    const detach = attachComputerPacer(sealConnection(conn), board.pacer);
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.views).toBe(0); // the board is still showing the last change
    board.idle();
    await vi.advanceTimersByTimeAsync(499);
    expect(seen.views).toBe(0); // then the person-like pause
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.views).toBe(1);
    expect(worker.toWorker.some((m) => m.t === 'shown')).toBe(true);
    // Its move is a new change the board has not shown: the computer's next decision waits for it again (at most 8 s).
    board.busy();
    const n = seen.views;
    for (let i = 0; i < 20 && conn.view().pending?.player === 'p1'; i++) {
      await reactAct(async () => {
        const done = conn.act(human(conn));
        await vi.advanceTimersByTimeAsync(0);
        await done;
      });
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen.views).toBe(n);
    detach();
    expect(board.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(seen.views).toBeGreaterThan(n); // no board: the delay alone
    off();
    closeGame(conn);
    expect(worker.terminated).toBe(true);
  });

  it('CR 103-104, 400.2: a whole game, the human scripted against the AI in the worker, ends with a winner; the computer never sees a hidden card', async () => {
    const seen = { views: 0 };
    const { conn, worker } = await open((w) => WorkerConnection.computer(computerConfig('w-full', {}, 4), 'p1', 'p2', { delayMs: 0, seed: 'full' }, { worker: w }), checkedAi(seen));
    const off = conn.subscribe(() => {});
    for (let i = 0; i < 3000 && !conn.view().result; i++) {
      const d = conn.view().pending;
      if (d && d.player === 'p1') expect((await conn.act(human(conn))).ok).toBe(true);
      else await deliver(2);
      expect(conn.handoff()).toBeNull();
      expect(conn.view().viewer).toBe('p1');
    }
    off();
    const v = conn.view();
    expect(v.result).not.toBeNull();
    expect(seen.views).toBeGreaterThan(5);
    expect(hiddenHand(v, 'p2')).toBe(true);
    const saved = await conn.save();
    expect(saved.actions.some((a) => a.type === 'cast' && a.player === 'p2')).toBe(true);
    expect(worker.fromWorker.some((m) => holdsState(m))).toBe(false);
  }, 120_000);

  it('the game screen draws a worker game and gives the computer its pace (pacer on, then each change shown)', async () => {
    const worker = new InThreadWorker();
    const base = computerConfig('w-screen', { startingPlayer: 'p2' });
    const cfg = { ...base, players: base.players.map((p, i) => (i === 1 ? { ...p, name: 'Computer' } : p)) };
    const conn = WorkerConnection.computer(cfg, 'p1', 'p2', { delayMs: 50, seed: 's' }, { worker: () => worker });
    await deliver();
    expect(await conn.ready).toBe(true);
    const { container } = render(renderGameApp(sealConnection(conn)));
    await reactAct(async () => {
      await deliver(20);
    });
    expect(screen.queryByRole('dialog', { name: /^Pass to / })).toBeNull();
    expect(container.querySelectorAll('.hand-own .board-card').length).toBe(7);
    expect(worker.toWorker.some((m) => m.t === 'watch' && m.on)).toBe(true);
    expect(worker.toWorker.some((m) => m.t === 'pacer' && m.on)).toBe(true);
    expect(worker.toWorker.some((m) => m.t === 'shown')).toBe(true);
  });
});

describe('WorkerConnection and the replay recorder (RPL-1, F1)', () => {
  it('records a worker game as a game on the page records it: the log, the checkpoints and the last state, from facts the worker sends', async () => {
    const env = testEnv();
    const cfg = duel('w-record', 4);
    const { conn } = await open((w) => WorkerConnection.hotSeat(cfg, { worker: w }));
    recordLocalGame(conn, { format: 'standard' }, env);
    for (let i = 0; i < 2000 && !conn.view().result; i++) {
      if (conn.handoff()) await acceptHandoff(conn);
      const d = conn.view().pending!;
      let r = await conn.act(chooseAction(conn.view(), d, `rec:${d.id}`));
      if (!r.ok) r = await conn.act(fallback(d)!);
      expect(r.ok).toBe(true);
    }
    expect(conn.view().result).not.toBeNull();
    await deliver(40);
    const entries = await env.library.list();
    expect(entries).toHaveLength(1);
    const read = await env.library.read(entries[0]!.key);
    if (!read.ok) throw new Error(read.error.message);
    const file = read.value;
    const saved = await conn.save();
    expect(file.play!.actions).toEqual(saved.actions);
    expect(file.play!.config).toEqual(cfg);
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const again = replay(file.play!.config, file.play!.actions);
    const last = file.play!.checkpoints[file.play!.checkpoints.length - 1]!;
    expect(last).toEqual({ action: saved.actions.length - 1, turn: again.state.turn.number, digest: gameDigest(again.state) });
    expect(file.game).toMatchObject({ mode: 'hotseat', ended: 'finished', actions: saved.actions.length, turns: again.state.turn.number });
  }, 60_000);

  it('a game against the computer records the config with the AI stops it is played with', async () => {
    const env = testEnv();
    const cfg = duel('w-record-vs');
    const worker = new InThreadWorker();
    const conn = WorkerConnection.computer(cfg, 'p1', 'p2', { delayMs: 0, seed: 'c' }, { worker: () => worker });
    await deliver();
    expect(await conn.ready).toBe(true);
    recordLocalGame(conn, { format: 'casual' }, env);
    expect(conn.config).toEqual(withComputerStops(cfg, ['p2']));
    const saved = await conn.save();
    expect(saved.config).toEqual(conn.config);
  });
});
