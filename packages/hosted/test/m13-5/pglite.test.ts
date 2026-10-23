/**
 * M13-5 on the PostgreSQL store (PGlite in process, design D14): AI tables commit through the Postgres adapter's group commit, a restart recovers
 * them to their live states, and their ledger rows are written at the end. A worker crash every 10 moves (a simulated out-of-memory exit) recovers the
 * table each time, and the game ends in exactly the state the same table reaches in process.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryLogger } from '../../src/obs';
import type { GameRuntime, TableDirectory, TableInspection, TableMeta } from '../../src/runtime';
import { migrate, pgliteClient, PostgresStore, type SqlClient } from '../../src/store';
import { DECKS, Driver, playLocal, startSeats, T0 } from './harness';

let sql: SqlClient;
// The store must not close the shared client.
const view = (): SqlClient => ({ ...sql, close: async () => {} });

beforeAll(async () => {
  sql = pgliteClient(await PGlite.create());
  await migrate(sql);
}, 120_000);

afterAll(async () => {
  await sql?.close();
});

const GAMES = ['p1', 'p2'];
const decksOf = (i: number) => [DECKS[i % 3]!, DECKS[(i + 1) % 3]!] as const;
const directory: TableDirectory = {
  async meta(g) {
    const i = GAMES.indexOf(g);
    if (i < 0) return null;
    const meta: TableMeta = {
      game: g, format: 'casual', source: 'listed', seats: 2, startedAt: T0, limits: { checkpointEvery: 10 },
      ledgerSeats: startSeats(g, ...decksOf(i)).map((s) => ({ seat: s.seat, session: s.session, deckHash: s.deckHash })),
    };
    return meta;
  },
};

describe('M13-5 on PostgreSQL (PGlite)', () => {
  it('plays, restarts, recovers to the live states and finishes, with ledger rows', async () => {
    let live: Record<string, TableInspection> = {};
    {
      const store = await PostgresStore.open(view());
      const driver = new Driver();
      const rt = driver.make({ store, workers: 1 });
      try {
        await rt.open();
        for (const [i, g] of GAMES.entries()) await driver.start(store, g, ...decksOf(i), { limits: { checkpointEvery: 10 } });
        await Promise.all(GAMES.map((g) => driver.tables.get(g)!.play(22)));
        await rt.settleAll();
        for (const g of GAMES) live[g] = (await rt.inspect(g))!;
      } finally {
        await rt.close();
      }
    }
    const store = await PostgresStore.open(view());
    const driver = new Driver();
    const logger = new MemoryLogger();
    const rt = driver.make({ store, workers: 1, directory, logger });
    try {
      const rep = await rt.open();
      expect(logger.lines.filter((l) => l.includes('"error"'))).toEqual([]);
      expect(rep).toEqual({ recovered: GAMES, voided: [] });
      for (const g of GAMES) expect(await rt.inspect(g)).toMatchObject({ seq: live[g]!.seq, hash: live[g]!.hash });
      expect(driver.recovered.every((r) => r.fromSnapshot !== null)).toBe(true);
      for (const g of GAMES) driver.table(g, Date.now()).connectAll();
      await Promise.all(GAMES.map((g) => driver.tables.get(g)!.play(null)));
      await rt.settleAll();
      const rows = await store.results(new Date(0), 10);
      expect(rows.map((r) => r.game).sort()).toEqual(GAMES);
      for (const r of rows) expect(['win', 'draw']).toContain(r.outcome);
    } finally {
      await rt.close();
    }
    live = {};
  }, 300_000);
});

describe('M13-5: a worker crash every 10 moves (the first 80)', () => {
  let rt: GameRuntime;
  const driver = new Driver();

  afterAll(async () => {
    await rt?.close();
  }, 60_000);

  it('recovers the table after each crash; the game ends in the state the same table reaches in process', async () => {
    const store = await PostgresStore.open(view());
    rt = driver.make({ store, workers: 1, testHooks: true, tuning: { maxRecoveries: 1_000 } });
    await rt.open();
    const t = await driver.start(store, 'c1', DECKS[0]!, DECKS[2]!, { limits: { checkpointEvery: 10 } });
    let crashes = 0;
    // A crash every 10 moves for the first 80 (each worker start costs about a second or two), then to the end.
    for (let moves = 10; !t.over; moves += 10) {
      await t.play(moves > 80 ? null : moves);
      await rt.settleAll();
      if (t.over) break;
      const before = (await rt.inspect('c1'))!;
      const n = driver.recovered.length;
      rt.debug('c1', { exit: 1 });
      crashes++;
      const until = Date.now() + 60_000;
      while (driver.recovered.length === n && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
      await rt.settleAll();
      expect(await rt.inspect('c1')).toMatchObject({ seq: before.seq, hash: before.hash });
    }
    expect(crashes).toBeGreaterThan(2);
    expect(t.refusals).toEqual([]);
    const local = await playLocal('c1', DECKS[0]!, DECKS[2]!);
    expect(t.result).toEqual(local.result);
    const [row] = (await store.results(new Date(0), 10)).filter((r) => r.game === 'c1');
    expect(row?.outcome).toBe(local.result!.outcome);
    expect((await store.loadForRecovery('c1')).recoveries).toBe(crashes);
  }, 300_000);
});
