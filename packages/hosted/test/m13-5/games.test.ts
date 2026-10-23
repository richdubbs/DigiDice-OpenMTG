/**
 * M13-5: a pool of three game workers runs seeded AI-against-AI tables through the real table actor and a store (design 2.1-2.3, D3, D4): placement
 * by load, the group commit (several tables per batch), write-ahead (no payload before its record committed; the result after the ledger row), the
 * ledger rows at the end, the capacity signals, the deck pool, and determinism (a table's messages through the workers are byte for byte those of the
 * same table played in process).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeatNumber } from '../../src/api';
import { MemoryMetrics, METRICS } from '../../src/obs';
import type { GameRuntime } from '../../src/runtime';
import { MemoryStore } from '../../src/store';
import { DECKS, Driver, FIXTURE_CARDS, playLocal, spyStore, T0, type AiTable } from './harness';

const GAMES = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
const deckOf = (i: number) => [DECKS[i % 3]!, DECKS[(i + 1) % 3]!] as const;

describe('M13-5 runtime: three game workers, AI tables, a memory store', () => {
  const mem = new MemoryStore();
  const spy = spyStore(mem, { delayMs: 2 });
  const driver = new Driver();
  const metrics = new MemoryMetrics(3);
  let rt: GameRuntime;
  const violations: string[] = [];
  const tables: AiTable[] = [];

  beforeAll(async () => {
    rt = driver.make({ store: spy.store, workers: 3, deckWorkers: 1, cards: { module: FIXTURE_CARDS }, metrics });
    const report = await rt.open();
    expect(report).toEqual({ recovered: [], voided: [] });
    // Write-ahead (design D4): every view or patch of seq s is delivered only after record s committed; a result only after its game's ledger row.
    driver.onDeliver = (game, sends) => {
      for (const s of sends) {
        const m = JSON.parse(s.json) as { t: string; seq?: number; outcome?: string };
        if ((m.t === 'view' || m.t === 'patch') && m.seq! > 0 && !spy.committed.has(`${game}:${m.seq}`)) violations.push(`${game}: ${m.t} ${m.seq} before its commit`);
        if (m.t === 'result' && m.outcome !== 'void' && !spy.finished.has(game)) violations.push(`${game}: result before the ledger row`);
      }
    };
  }, 180_000);

  afterAll(async () => {
    await rt?.close();
  }, 60_000);

  it('places tables on the least-loaded worker and plays them all to the end, write-ahead, with ledger rows', async () => {
    for (const [i, g] of GAMES.entries()) tables.push(await driver.start(spy.store, g, ...deckOf(i), { limits: { checkpointEvery: 25 } }));
    // Least-loaded in units, ties to the lowest index: 0, 1, 2, 0, 1, 2.
    expect(GAMES.map((g) => rt.locate(g))).toEqual([0, 1, 2, 0, 1, 2]);
    expect(rt.read(T0).runningUnits).toBe(6);
    await Promise.all(tables.map((t) => t.play(null)));
    await rt.settleAll();

    expect(violations).toEqual([]);
    for (const t of tables) {
      expect(t.result, t.game).not.toBeNull();
      expect(t.refusals, t.game).toEqual([]);
      expect(driver.ended.get(t.game)?.status).toBe('finished');
    }
    const rows = await mem.results(new Date(0), 100);
    expect(rows.map((r) => r.game).sort()).toEqual(GAMES);
    for (const r of rows) {
      expect(['win', 'draw']).toContain(r.outcome);
      expect(r.placements).toHaveLength(2);
      expect(r.engineBuild).toBe('build-test');
      const end = driver.ended.get(r.game)!;
      expect(end.record).toEqual(r);
    }
    // Group commit: fewer store calls than records (several tables and steps share a batch).
    expect(spy.counts.appends).toBeLessThan(spy.counts.records);
    // Signals: nothing runs now; the p95 action time and CPU were measured.
    const sig = rt.read(T0);
    expect(sig.runningUnits).toBe(0);
    expect(sig.p95ActionMs).not.toBeNull();
    expect(sig.p95ActionMs!).toBeGreaterThan(0);
    expect(sig.cpu).toBeGreaterThan(0);
    expect(sig.cpu).toBeLessThanOrEqual(1);
    expect(sig.workerHeap).toBeGreaterThan(0);
    expect(sig.workerHeap).toBeLessThan(1);
    expect(metrics.values.get(METRICS.actions)).toBeGreaterThan(50);
  }, 300_000);

  it('is deterministic: a table through the workers sends exactly what the same table sends in process', async () => {
    for (const [i, t] of tables.slice(0, 2).entries()) {
      const local = await playLocal(t.game, ...deckOf(i));
      expect(local.result).not.toBeNull();
      expect(local.transcript.length).toBe(t.transcript.length);
      expect(local.transcript).toEqual(t.transcript);
    }
  }, 120_000);

  it('keeps an ended table for chat, then refuses nothing but answers as over', async () => {
    const t = tables[0]!;
    const before = t.transcript.length;
    expect(rt.has(t.game)).toBe(true);
    expect(rt.submit(t.game, { t: 'chat', seat: 1 as SeatNumber, id: 900, text: 'good game' })).toBe(true);
    await rt.settleAll();
    const after = t.transcript.slice(before).map((x) => JSON.parse(x.slice(2)) as { t: string; text?: string });
    expect(after.filter((m) => m.t === 'chat').map((m) => m.text)).toEqual(['good game', 'good game']);
    // Every seat leaves: the table is unloaded.
    rt.submit(t.game, { t: 'leave', seat: 1, id: 901 });
    rt.submit(t.game, { t: 'leave', seat: 2, id: 1 });
    await rt.settleAll();
    await new Promise((r) => setTimeout(r, 50));
    expect(rt.has(t.game)).toBe(false);
    expect(driver.unloaded).toContain(t.game);
    expect(rt.submit(t.game, { t: 'chat', seat: 1, id: 902, text: 'x' })).toBe(false);
  }, 60_000);

  it('prepares decks in the deck pool (resolve, validate, compile), with problems for the player', async () => {
    const ok = await rt.prepare({ main: DECKS[0]!.map(([name, count]) => ({ name, count })), sideboard: [] }, 'casual');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.deck.main).toHaveLength(60);
      expect(ok.deck.defs.map((d) => d.id).sort()).toEqual([...new Set(DECKS[0]!.map(([n]) => n))].sort());
    }
    const unknown = await rt.prepare({ main: [{ name: 'Not A Real Card Name', count: 60 }], sideboard: [] }, 'casual');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.join(' ')).toContain('Unknown card');
    const malformed = await rt.prepare({ main: [{ name: '', count: 1 }], sideboard: [] } as never, 'casual');
    expect(malformed.ok).toBe(false);
  }, 60_000);
});
