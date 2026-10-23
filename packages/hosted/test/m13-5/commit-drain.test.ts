/**
 * M13-5: a commit failure voids only its table (design 2.3, D4; review 2); the timer wheel wakes a table at its clock's deadline (a time-out concession,
 * design 5.1); drain (design 2.3) refuses new starts, lets running games finish, and voids what is left at its limit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameRuntime } from '../../src/runtime';
import { MemoryStore } from '../../src/store';
import { DECKS, Driver, spyStore, startSeats, T0, type AiTable } from './harness';

describe('M13-5: commit failures, ticks and drain', () => {
  const mem = new MemoryStore();
  // The store refuses the records of game "bad" from seq 9 on (as PostgreSQL refuses a value in one game's savepoint).
  const spy = spyStore(mem, { fail: (r) => r.game === 'bad' && r.seq >= 9 });
  const driver = new Driver();
  let rt: GameRuntime;

  beforeAll(async () => {
    rt = driver.make({ store: spy.store, workers: 2 });
    await rt.open();
  }, 180_000);

  afterAll(async () => {
    await rt?.close();
  }, 60_000);

  it('a commit failure voids only that table: nothing of the failed step is sent; the others play to the end', async () => {
    const bad = await driver.start(spy.store, 'bad', DECKS[0]!, DECKS[1]!);
    const ok1 = await driver.start(spy.store, 'ok1', DECKS[1]!, DECKS[2]!);
    const ok2 = await driver.start(spy.store, 'ok2', DECKS[2]!, DECKS[0]!);
    await Promise.all([bad, ok1, ok2].map((t) => t.play(null)));
    await rt.settleAll();

    const stored = await mem.loadForRecovery('bad');
    expect(stored.status).toBe('void');
    // The step that held record 9 failed (it may have held record 8 too); nothing after the last committed record exists anywhere.
    const last = stored.lastSeq;
    expect([7, 8]).toContain(last);
    expect(driver.ended.get('bad')).toMatchObject({ status: 'void', end: { outcome: 'void', reason: 'commit', seq: last } });
    expect(bad.result).toMatchObject({ outcome: 'void', reason: 'commit', placements: [] });
    // No seat ever saw a state past the last committed record.
    for (const b of bad.seats.values()) expect(b.seq).toBeLessThanOrEqual(last);
    const rows = await mem.results(new Date(0), 10);
    expect(rows.find((r) => r.game === 'bad')).toMatchObject({ outcome: 'void', reason: 'commit', placements: [] });
    for (const t of [ok1, ok2]) {
      expect(t.result?.outcome).toMatch(/win|draw/);
      expect(driver.ended.get(t.game)?.status).toBe('finished');
    }
  }, 300_000);

  it('the timer wheel ticks a table at its deadline: a player who never answers times out (a concession)', async () => {
    const start = Date.now();
    const slow = await driver.start(spy.store, 'slow', DECKS[0]!, DECKS[1]!, { at: start, clock: { bankMs: 600, delayMs: 200, dropMs: 60_000 } });
    // Nobody plays: the first decision's owner runs out of time.
    const until = Date.now() + 30_000;
    while (!slow.over && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    await rt.settleAll();
    expect(slow.result?.outcome).toBe('win');
    const row = (await mem.results(new Date(0), 20)).find((r) => r.game === 'slow')!;
    expect(row.placements.map((p) => p.loss).sort()).toEqual(['timeout', null].sort());
    expect(row.placements.find((p) => p.loss === 'timeout')!.timeouts).toBe(1);
  }, 60_000);

  it('drain: no new starts; running games finish; the drain ends when they have', async () => {
    const d1 = await driver.start(spy.store, 'd1', DECKS[0]!, DECKS[2]!);
    const d2 = await driver.start(spy.store, 'd2', DECKS[1]!, DECKS[0]!);
    const drained = rt.drain();
    expect(rt.draining).toBe(true);
    await mem.createGame((await import('./harness')).lobbyRow('d3'));
    expect(await rt.start({ game: 'd3', format: 'casual', source: 'listed', seats: startSeats('d3', DECKS[0]!, DECKS[1]!), at: T0 })).toMatchObject({ ok: false, reason: 'draining' });
    await Promise.all([d1.play(null), d2.play(null)]);
    expect(await drained).toEqual({ finished: 2, voided: [] });
    for (const t of [d1, d2] as AiTable[]) expect(driver.ended.get(t.game)?.status).toBe('finished');
  }, 300_000);
});

describe('M13-5: drain at its limit', () => {
  it('voids the games still running at DRAIN_MAX_MINUTES ("updated")', async () => {
    const store = new MemoryStore();
    const driver = new Driver();
    const rt = driver.make({ store, workers: 1, tuning: { drainMaxMinutes: 0.005 } });
    try {
      await rt.open();
      const idle = await driver.start(store, 'idle', DECKS[0]!, DECKS[1]!);
      expect(await rt.drain()).toEqual({ finished: 0, voided: ['idle'] });
      expect(idle.result).toMatchObject({ outcome: 'void', reason: 'updated' });
      expect((await store.loadForRecovery('idle')).status).toBe('void');
    } finally {
      await rt.close();
    }
  }, 120_000);
});
