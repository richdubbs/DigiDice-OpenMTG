/**
 * M13-5: the watchdog and quarantine (design 2.3, D5, D15; review 3, M13-5 review MAJOR 1). A worker stuck on one table's message (a test-only slow
 * action) is terminated; that table is quarantined (void, its log kept, never placed again); the worker's other tables are recovered on a fresh worker
 * to the states they had and play on to the end, and their recoveries do not count (the suspect was known). A worker that dies between messages has no
 * suspect: every table of it is recovered and counted, and a table that needs its second counted recovery is quarantined. Tables on the other worker
 * never notice.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryMetrics, METRICS } from '../../src/obs';
import type { GameRuntime, TableInspection } from '../../src/runtime';
import { MemoryStore } from '../../src/store';
import { DECKS, Driver, T0, type AiTable } from './harness';

const until = async (what: string, ok: () => boolean, ms = 60_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('M13-5 watchdog: a stuck worker, quarantine, recovery of the others', () => {
  const store = new MemoryStore();
  const driver = new Driver();
  const metrics = new MemoryMetrics(2);
  let rt: GameRuntime;
  const t: Record<string, AiTable> = {};
  const hashes: Record<string, TableInspection> = {};

  beforeAll(async () => {
    rt = driver.make({ store, workers: 2, metrics, testHooks: true, tuning: { watchdogMs: 400 } });
    await rt.open();
    // Placement alternates by load: g1, g3, g5 on worker 0; g2, g4 on worker 1.
    for (const [i, g] of ['g1', 'g2', 'g3', 'g4', 'g5'].entries()) t[g] = await driver.start(store, g, DECKS[i % 3]!, DECKS[(i + 2) % 3]!);
    await Promise.all(Object.values(t).map((x) => x.play(16)));
    await rt.settleAll();
    for (const g of Object.keys(t)) hashes[g] = (await rt.inspect(g))!;
  }, 180_000);

  afterAll(async () => {
    await rt?.close();
  }, 60_000);

  it('places g1, g3, g5 on worker 0 and g2, g4 on worker 1', () => {
    expect(Object.fromEntries(Object.keys(t).map((g) => [g, rt.locate(g)]))).toEqual({ g1: 0, g2: 1, g3: 0, g4: 1, g5: 0 });
    for (const x of Object.values(t)) expect(x.over).toBe(false);
  });

  it('terminates the worker stuck on g1: g1 is quarantined; g3 and g5 are recovered to their states', async () => {
    expect(rt.debug('g1', { hang: 20_000 })).toBe(true);
    await until('g1 quarantined', () => driver.ended.get('g1')?.status === 'quarantined');
    await until('g3 and g5 recovered', () => driver.recovered.filter((r) => r.game === 'g3' || r.game === 'g5').length === 2);
    await rt.settleAll();

    // The culprit: void in the store with its log kept, out of memory, never placed again; its players were told.
    const g1 = await store.loadForRecovery('g1');
    expect(g1.status).toBe('quarantined');
    expect(g1.lastSeq).toBe(hashes['g1']!.seq);
    expect(rt.has('g1')).toBe(false);
    expect(rt.submit('g1', { t: 'chat', seat: 1, id: 99, text: 'hi' })).toBe(false);
    expect(t['g1']!.result).toMatchObject({ outcome: 'void', reason: 'quarantined', placements: [] });
    const again = await rt.start({ game: 'g1', format: 'casual', source: 'listed', seats: [], at: T0 });
    expect(again).toMatchObject({ ok: false, reason: 'exists' });
    const row = (await store.results(new Date(0), 10)).find((r) => r.game === 'g1')!;
    expect(row).toMatchObject({ outcome: 'void', reason: 'quarantined', placements: [] });

    // The others: recovered on the fresh worker 0, to exactly the states they had (the connected seats got full views).
    for (const g of ['g3', 'g5']) {
      expect(driver.recovered.find((r) => r.game === g)).toMatchObject({ cause: 'worker' });
      const now = (await rt.inspect(g))!;
      expect(now).toEqual({ ...hashes[g], worker: 0 });
      // Not counted: the suspect (g1) was known (review MAJOR 1).
      expect((await store.loadForRecovery(g)).recoveries).toBe(0);
    }
    // The other worker's tables never noticed.
    expect(driver.recovered.some((r) => r.game === 'g2' || r.game === 'g4')).toBe(false);
    expect(metrics.values.get(METRICS.watchdogTerminations)).toBe(1);
    expect(metrics.values.get(METRICS.quarantines)).toBe(1);
  }, 120_000);

  it('the recovered tables play on from their full views', async () => {
    await Promise.all([t['g3']!.play(24), t['g5']!.play(24)]);
    await rt.settleAll();
    for (const g of ['g3', 'g5']) {
      const now = (await rt.inspect(g))!;
      expect(now.seq).toBeGreaterThan(hashes[g]!.seq);
      expect(t[g]!.refusals).toEqual([]);
    }
  }, 120_000);

  it('g3 stalls the new worker 0: g3 is quarantined, g5 is recovered again without being counted and plays to the end', async () => {
    const before = (await rt.inspect('g5'))!;
    rt.debug('g3', { hang: 20_000 });
    await until('g3 quarantined', () => driver.ended.get('g3')?.status === 'quarantined');
    await until('g5 recovered again', () => driver.recovered.filter((r) => r.game === 'g5').length === 2);
    await rt.settleAll();
    expect(await rt.inspect('g5')).toMatchObject({ seq: before.seq, hash: before.hash });
    expect((await store.loadForRecovery('g5')).recoveries).toBe(0);
    expect(metrics.values.get(METRICS.quarantines)).toBe(2);
    await t['g5']!.play(null);
    await rt.settleAll();
    expect(driver.ended.get('g5')?.status).toBe('finished');
  }, 120_000);

  it('a worker that dies between messages (no suspect) recovers every table of it, counted; they play to the end', async () => {
    rt.debug('g2', { exit: 1 });
    await until('g2 and g4 recovered', () => driver.recovered.filter((r) => r.game === 'g2' || r.game === 'g4').length === 2);
    await rt.settleAll();
    for (const g of ['g2', 'g4']) {
      expect((await rt.inspect(g))).toEqual({ ...hashes[g], worker: 1 });
      expect((await store.loadForRecovery(g)).recoveries).toBe(1);
    }
    await Promise.all([t['g2']!.play(null), t['g4']!.play(null)]);
    await rt.settleAll();
    for (const g of ['g2', 'g4']) {
      expect(t[g]!.result?.outcome).toMatch(/win|draw/);
      expect(driver.ended.get(g)?.status).toBe('finished');
    }
    const rows = await store.results(new Date(0), 10);
    expect(rows.filter((r) => r.outcome !== 'void').map((r) => r.game).sort()).toEqual(['g2', 'g4', 'g5']);
    expect(rows.filter((r) => r.outcome === 'void').map((r) => r.game).sort()).toEqual(['g1', 'g3']);
  }, 180_000);

  it('a table that needs its second counted recovery is quarantined (D5)', async () => {
    const g6 = await driver.start(store, 'g6', DECKS[0]!, DECKS[1]!);
    await g6.play(6);
    await rt.settleAll();
    rt.debug('g6', { exit: 1 });
    await until('g6 recovered', () => driver.recovered.some((r) => r.game === 'g6'));
    await rt.settleAll();
    expect((await store.loadForRecovery('g6')).recoveries).toBe(1);
    rt.debug('g6', { exit: 1 });
    await until('g6 quarantined', () => driver.ended.get('g6')?.status === 'quarantined');
    expect((await store.loadForRecovery('g6')).status).toBe('quarantined');
    expect(rt.has('g6')).toBe(false);
  }, 120_000);
});
