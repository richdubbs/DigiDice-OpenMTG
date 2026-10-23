/**
 * M13-5 pieces without worker threads: the group commit (batching, per-game isolation, one retry), the capacity signals, the snapshot bytes (with the
 * card definitions a game adds: tokens), and `TableActor.recover` from a snapshot (M13-5's additive `from` and `onRecord`).
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { createGame, type GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMISSION_LIMITS, softSignal } from '../../src/admission/api';
import { LedgerError } from '../../src/ledger/record';
import { decodeSnapshot, encodeSnapshot, GroupCommitter, isSettled, isTransient, percentile, RuntimeSignals } from '../../src/runtime';
import { StoreError } from '../../src/store';
import type { AppendResult, LogRecord } from '../../src/store/api';
import { TableActor } from '../../src/table';
import { checkpointOf } from '../../src/table/limits';
import { configOf, DECKS, Harness, playAi } from '../m13-2/harness';

const rec = (game: string, seq: number): LogRecord => ({ game, seq, seat: 1, action: { type: 'pass', player: 'p1' }, clocks: [], elapsedMs: 0, at: new Date(0).toISOString() });

function fakeStore(o: { failGames?: Set<string>; throwTimes?: number; failOnce?: Set<string> } = {}) {
  const calls: LogRecord[][] = [];
  let throws = o.throwTimes ?? 0;
  return {
    calls,
    async appendRecords(batch: LogRecord[]): Promise<AppendResult> {
      calls.push(batch);
      if (throws > 0) {
        throws--;
        throw new Error('connection lost');
      }
      const games = [...new Set(batch.map((r) => r.game))];
      const failed = games.filter((g) => o.failGames?.has(g) || o.failOnce?.delete(g));
      return { committed: games.filter((g) => !failed.includes(g)), failed: failed.map((game) => ({ game, error: 'StoreError: value' })) };
    },
  };
}

describe('M13-5 group commit', () => {
  it('batches the records of many tables: one store call per batch, at most maxRecords or after everyMs', async () => {
    const store = fakeStore();
    const c = new GroupCommitter(store, { everyMs: 10, maxRecords: 4 });
    const outs = await Promise.all([c.add('a', [rec('a', 1)]), c.add('b', [rec('b', 1), rec('b', 2)]), c.add('c', [rec('c', 1)]), c.add('d', [rec('d', 1)])]);
    expect(outs.every((o) => o.ok)).toBe(true);
    // The first four records fill a batch at once; the fifth waits for the timer.
    expect(store.calls.map((b) => b.map((r) => `${r.game}${r.seq}`))).toEqual([['a1', 'b1', 'b2', 'c1'], ['d1']]);
    expect(c.batches).toBe(2);
    expect(await c.add('e', [])).toEqual({ ok: true });
  });

  it('isolates games: a game the store refuses fails alone (after one retry of its own); the others commit', async () => {
    const store = fakeStore({ failGames: new Set(['bad']) });
    const c = new GroupCommitter(store, { everyMs: 1, maxRecords: 64 });
    const [ok, bad] = await Promise.all([c.add('ok', [rec('ok', 1)]), c.add('bad', [rec('bad', 1)])]);
    expect(ok).toEqual({ ok: true });
    expect(bad).toEqual({ ok: false, error: 'StoreError: value', outage: false });
    expect(store.calls.map((b) => b.map((r) => r.game))).toEqual([['ok', 'bad'], ['bad']]);
  });

  it('a game refused once and accepted on its retry commits', async () => {
    const once = fakeStore({ failOnce: new Set(['flaky']) });
    expect(await new GroupCommitter(once, { everyMs: 1, maxRecords: 64 }).add('flaky', [rec('flaky', 1)])).toEqual({ ok: true });
  });

  it('a store outage pauses the batch: retried with a backoff until the store answers (the tables wait); past the bound every game fails', async () => {
    const outage = { maxMs: 400, firstMs: 10, capMs: 80, noticeMs: 100 };
    const events: string[] = [];
    const hooks = { onTransient: () => events.push('down'), onHealthy: () => events.push('up') };
    // Down for five calls, then back: the batch commits, nothing fails (owner: pause, never void, within the bound).
    const down = fakeStore({ throwTimes: 5 });
    const c = new GroupCommitter(down, { everyMs: 1, maxRecords: 64, outage, ...hooks });
    const t0 = Date.now();
    expect(await Promise.all([c.add('x', [rec('x', 1)]), c.add('y', [rec('y', 1)])])).toEqual([{ ok: true }, { ok: true }]);
    expect(down.calls).toHaveLength(6);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10 + 20 + 40 + 80 + 80 - 5);
    expect(events).toEqual(['down', 'down', 'down', 'down', 'down', 'up']);
    // Down for good: past the bound the batch's games fail as an outage (their tables are voided, reason 'commit').
    const gone = fakeStore({ throwTimes: 1_000 });
    const g = new GroupCommitter(gone, { everyMs: 1, maxRecords: 64, outage });
    const s0 = Date.now();
    expect(await g.add('z', [rec('z', 1)])).toEqual({ ok: false, error: 'Error', outage: true });
    expect(Date.now() - s0).toBeGreaterThanOrEqual(380);
  });
});

describe('M13-5 outage classification (re-review)', () => {
  it('only errors that may pass by themselves are an outage', () => {
    const coded = (code: string) => Object.assign(new Error('x'), { code });
    // transient: the store unreachable, a connection dropped, a server shutting down, a closed pool
    for (const e of [coded('ECONNREFUSED'), coded('ECONNRESET'), coded('08006'), coded('57P01'), new Error('Connection terminated'), new StoreError('closed', 'closed')]) {
      expect(isTransient(e), String((e as { code?: string }).code ?? e.message)).toBe(true);
    }
    // permanent: programming errors, data / integrity / syntax errors (SQLSTATE 22, 23, 42), refusals of the game's data, ledger checks
    for (const e of [new TypeError('x'), new RangeError('x'), new ReferenceError('x'), coded('22P02'), coded('23505'), coded('23514'), coded('42P01'), coded('42703'), new StoreError('value', 'v'), new StoreError('status', 's'), new LedgerError('l')]) {
      expect(isTransient(e), `${e.name} ${String((e as { code?: string }).code ?? '')}`).toBe(false);
    }
    expect(isSettled(new StoreError('status', 's'))).toBe(true);
    expect(isSettled(new StoreError('value', 'v'))).toBe(false);
    expect(isSettled(coded('23514'))).toBe(false);
  });
});

describe('M13-5 capacity signals', () => {
  it('percentile by nearest rank', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });

  it('reports units, worker CPU over 30 s, p95 over a minute (after enough samples), the fullest heap and the outbound budget', () => {
    let now = 1_000_000;
    let units = 7;
    const s = new RuntimeSignals({ runningUnits: () => units, workers: () => 2, outbound: () => 0.5 }, 3, () => now);
    expect(s.read(0)).toEqual({ runningUnits: 7, cpu: 0, p95ActionMs: null, workerHeap: 0, outbound: 0.5 });
    s.workerBusy(15_000);
    s.workerBusy(15_000);
    s.actionTime(10);
    s.actionTime(20);
    expect(s.read(0).p95ActionMs).toBeNull();
    s.actionTime(50);
    s.heap(0, { used: 100, limit: 1000 });
    s.heap(1, { used: 850, limit: 1000 });
    const r = s.read(0);
    expect(r.cpu).toBeCloseTo(0.5);
    expect(r.p95ActionMs).toBe(50);
    expect(r.workerHeap).toBeCloseTo(0.85);
    // Admission reads it: the heap above 80% sets the soft limit.
    expect(softSignal(r, DEFAULT_ADMISSION_LIMITS)).toBe('heap');
    // The windows move: after 31 s the CPU samples are gone, after 61 s the action times.
    now += 31_000;
    expect(s.read(0).cpu).toBe(0);
    expect(s.read(0).p95ActionMs).toBe(50);
    now += 30_000;
    expect(s.read(0).p95ActionMs).toBeNull();
    // Worker 0's reading is a minute old by now and no longer counts (M13-10 review: a quiet worker kept admission closed); its next reply brings it back.
    expect(s.read(0).workerHeap).toBe(0);
    s.heap(0, { used: 100, limit: 1000 });
    s.heap(1, null);
    units = 0;
    expect(s.read(0)).toMatchObject({ runningUnits: 0, workerHeap: 0.1 });
  });
});

describe('M13-5 snapshots and the actor\'s snapshot start', () => {
  /** An AI game (white-black: Raise the Alarm makes Soldier tokens) played until a token's definition was added and a checkpoint came after it. */
  function tokenGame(): { h: Harness; at: { seq: number; stateJson: string; hash: string; state: GameState } } {
    const config = configOf('m13-5-token-game', DECKS[1]!, DECKS[1]!);
    const h = new Harness({ config, game: 'tok', limits: { checkpointEvery: 5 }, scan: false });
    const base = new Set(Object.keys(createGame(config).defs));
    for (let i = 0; i < 400 && !h.actor.ended; i++) {
      playAi(h, 'm13-5-token', 1);
      const cp = h.steps[h.steps.length - 1]!.checkpoint;
      if (cp && cp.seq === h.actor.seq && Object.keys(h.state.defs).some((id) => !base.has(id))) {
        return { h, at: { seq: cp.seq, stateJson: cp.stateJson, hash: cp.hash, state: h.state } };
      }
    }
    throw new Error('no token in this game');
  }

  it('carries the definitions a game added (tokens): without them the snapshot does not replay; with them it equals the live state', () => {
    const { h, at } = tokenGame();
    playAi(h, 'm13-5-token', 12);
    const live = checkpointOf(h.state).hash;
    const config = h.actor.config;
    const added = Object.values(at.state.defs).filter((d) => !Object.keys(createGame(config).defs).includes(d.id));
    expect(added.some((d) => d.id.startsWith('token:'))).toBe(true);

    const bytes = encodeSnapshot(at.stateJson, added);
    const back = decodeSnapshot(bytes);
    expect(back.stateJson).toBe(at.stateJson);
    expect(back.defs).toEqual(JSON.parse(JSON.stringify(added)));

    const rest = JSON.parse(back.stateJson) as Omit<GameState, 'defs'>;
    const configDefs = createGame(config).defs;
    const recover = (defs: GameState['defs']) => TableActor.recover({
      game: 'tok', config, seating: [1, 2], at: 0, records: h.records, from: { state: { ...rest, defs } as GameState, seq: at.seq },
    });
    // The finding: the configuration's definitions alone lose the token's.
    expect(() => {
      const r = recover(configDefs);
      checkpointOf(r.actor.state);
      // a later record that touches the token fails, or the views do
      r.actor.handle({ t: 'sync', seat: 1, at: 1 });
      if (r.actor.engineErrors > 0) throw new Error('engine error');
    }).toThrow();
    const defs = { ...configDefs };
    for (const d of back.defs) defs[d.id] = d;
    const replayed: number[] = [];
    const r = TableActor.recover({
      game: 'tok', config, seating: [1, 2], at: 0, records: h.records, from: { state: { ...rest, defs } as GameState, seq: at.seq },
      onRecord: (x) => replayed.push(x.seq),
    });
    expect(checkpointOf(r.actor.state).hash).toBe(live);
    expect(r.actor.seq).toBe(h.actor.seq);
    // Only the records after the snapshot were applied.
    expect(replayed).toEqual(h.records.filter((x) => x.seq > at.seq).map((x) => x.seq));
    // A full replay gives the same state.
    expect(checkpointOf(TableActor.recover({ game: 'tok', config, seating: [1, 2], at: 0, records: h.records }).actor.state).hash).toBe(live);
  }, 120_000);

  it('checks the header\'s definitions against their hash (review minor 5)', () => {
    const bytes = encodeSnapshot('{"a":1}', [{ id: 'token:X', name: 'X' } as never]);
    expect(decodeSnapshot(bytes).defs).toEqual([{ id: 'token:X', name: 'X' }]);
    const text = gunzipSync(bytes).toString('utf8').replace('"name":"X"', '"name":"Y"');
    expect(() => decodeSnapshot(new Uint8Array(gzipSync(Buffer.from(text))))).toThrow(/hash/);
  });

  it('reads a snapshot without the header line as the state alone (M13-4\'s plain format)', async () => {
    const { gzipSync } = await import('node:zlib');
    const plain = new Uint8Array(gzipSync(Buffer.from('{"a":1}')));
    expect(decodeSnapshot(plain)).toEqual({ stateJson: '{"a":1}', defs: [] });
    const bad = new Uint8Array(gzipSync(Buffer.from('{"v":9}\n{}')));
    expect(() => decodeSnapshot(bad)).toThrow(/format/);
  });
});
