/**
 * M13-5: recovery on start (design 2.3, D5): a process that stops mid-game leaves its games 'running' in the store; the next one recovers each from its
 * newest snapshot and the records after it, to exactly the live state (hash), and plays on to the end. The snapshot start equals a full replay. Under
 * another engine build a game replays from the first record with every checkpoint hash compared (a mismatch voids it, "the server was updated") or is
 * voided at once; under the same build a mismatch is an engine bug (void 'recovery', counted as an engine error). A game recovered before needs no
 * third chance: its second recovery quarantines it.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameConfig } from '@openmtg/engine';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryMetrics, METRICS } from '../../src/obs';
import type { TableDirectory, TableInspection, TableMeta } from '../../src/runtime';
import { FileStore } from '../../src/store';
import { replayRecords } from '../../src/table';
import { checkpointOf } from '../../src/table/limits';
import { DECKS, Driver, startSeats, T0, type AiTable } from './harness';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'openmtg-m13-5-'));
  dirs.push(d);
  return d;
}

afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5 });
});

const LIMITS = { checkpointEvery: 10 };
const decksOf = (i: number) => [DECKS[i % 3]!, DECKS[(i + 1) % 3]!] as const;

/** The tables layer's directory after a restart (M13-6 reads it from the games and seats rows). */
function directory(games: string[]): TableDirectory {
  const metas = new Map<string, TableMeta>(games.map((g, i) => [g, {
    game: g, format: 'casual', source: 'listed', seats: 2, startedAt: T0, limits: LIMITS,
    ledgerSeats: startSeats(g, ...decksOf(i)).map((s) => ({ seat: s.seat, session: s.session, deckHash: s.deckHash })),
  }]));
  return { meta: async (g) => metas.get(g) ?? null };
}

/** Plays `games` partway in a fresh runtime on a file store at `dir`, then stops the process's runtime with the games running. */
async function playPartway(dir: string, games: string[], moves: number, workers: number): Promise<Record<string, TableInspection>> {
  const store = await FileStore.open(dir);
  const driver = new Driver();
  const rt = driver.make({ store, workers, tuning: {} });
  try {
    await rt.open();
    const tables: AiTable[] = [];
    for (const [i, g] of games.entries()) tables.push(await driver.start(store, g, ...decksOf(i), { limits: LIMITS }));
    await Promise.all(tables.map((t) => t.play(moves)));
    await rt.settleAll();
    const out: Record<string, TableInspection> = {};
    for (const g of games) out[g] = (await rt.inspect(g))!;
    return out;
  } finally {
    await rt.close();
    await store.close();
  }
}

describe('M13-5 recovery: restart from a file store', () => {
  it('recovers every running game to its live state (from a snapshot), and they play to the end', async () => {
    const dir = await tempDir();
    const games = ['r1', 'r2', 'r3'];
    const live = await playPartway(dir, games, 30, 2);
    for (const g of games) expect(live[g]!.seq).toBeGreaterThan(LIMITS.checkpointEvery);

    const store = await FileStore.open(dir);
    const driver = new Driver();
    const rt = driver.make({ store, workers: 2, directory: directory(games) });
    try {
      const report = await rt.open();
      expect(report).toEqual({ recovered: games, voided: [] });
      for (const g of games) {
        const now = (await rt.inspect(g))!;
        expect({ seq: now.seq, hash: now.hash, ended: now.ended }).toEqual({ seq: live[g]!.seq, hash: live[g]!.hash, ended: false });
        const r = driver.recovered.find((x) => x.game === g)!;
        expect(r.cause).toBe('restart');
        // The replay started at the newest snapshot (a checkpoint every 10 records).
        expect(r.fromSnapshot).toBe(Math.floor(live[g]!.seq / LIMITS.checkpointEvery) * LIMITS.checkpointEvery);
      }
      // The snapshot start equals the full replay of the stored log (design 2.3).
      const full = await store.loadForRecovery('r1', { ignoreSnapshots: true });
      const replay = replayRecords({ ...(full.config as Omit<GameConfig, 'seed'>), seed: full.seed } as GameConfig, full.records);
      expect(replay.mismatches).toEqual([]);
      expect(checkpointOf(replay.state).hash).toBe(live['r1']!.hash);

      // The players come back (a full view each) and the games play to the end; the ledger has their rows.
      for (const g of games) {
        const t = driver.table(g, Date.now());
        t.connectAll();
      }
      await Promise.all(games.map((g) => driver.tables.get(g)!.play(null)));
      await rt.settleAll();
      for (const g of games) {
        expect(driver.tables.get(g)!.result?.outcome).toMatch(/win|draw/);
        expect(driver.tables.get(g)!.refusals).toEqual([]);
      }
      const rows = await store.results(new Date(0), 10);
      expect(rows.map((r) => r.game).sort()).toEqual(games);
      for (const r of rows) expect(r.placements.map((p) => p.session).sort()).toEqual([`s-${r.game}-1`, `s-${r.game}-2`]);
    } finally {
      await rt.close();
      await store.close();
    }
  }, 300_000);

  describe('engine builds', () => {
    let base: string;
    let live: Record<string, TableInspection>;
    const games = ['b1', 'b2', 'b3'];

    /**
     * A copy of the played store; `tamper`: b1's last checkpoint hash changed (as a build that plays the game differently would see it; it is also the
     * newest snapshot's seq, so the snapshot no longer checks out and the replay starts from the first record).
     */
    async function copy(o: { tamper?: boolean; countB3?: boolean } = {}): Promise<string> {
      const dir = await tempDir();
      await cp(base, dir, { recursive: true });
      const s = await FileStore.open(dir);
      try {
        if (o.tamper) {
          const path = s.logPath('b1');
          const text = await readFile(path, 'utf8');
          const at = text.lastIndexOf('"check":"');
          expect(at).toBeGreaterThan(0);
          const changed = `${text.slice(0, at)}"check":"${'f'.repeat(64)}"${text.slice(at + 9 + 64 + 1)}`;
          expect(changed).not.toBe(text);
          await writeFile(path, changed);
        }
        if (o.countB3) await s.countRecovery('b3');
      } finally {
        await s.close();
      }
      return dir;
    }

    async function reopen(dir: string, engineBuild: string, otherBuild: 'verify' | 'void' = 'verify') {
      const store = await FileStore.open(dir);
      const driver = new Driver();
      const metrics = new MemoryMetrics(1);
      const rt = driver.make({ store, workers: 1, engineBuild, directory: directory(games), metrics, tuning: { otherBuild } });
      const report = await rt.open();
      const states: Record<string, TableInspection | null> = {};
      for (const g of games) states[g] = await rt.inspect(g);
      await rt.close();
      const status: Record<string, string> = {};
      for (const g of games) status[g] = (await store.loadForRecovery(g)).status;
      const engineErrors = (await store.loadForRecovery('b1')).engineErrors;
      const results = await store.results(new Date(0), 10);
      await store.close();
      return { report, states, status, engineErrors, results, metrics };
    }

    it('plays the games partway under build-test', async () => {
      base = await tempDir();
      live = await playPartway(base, games, 25, 1);
    }, 180_000);

    it('another build: replays from the first record comparing checkpoint hashes; a mismatch voids the game ("updated")', async () => {
      const r = await reopen(await copy({ tamper: true }), 'build-next');
      expect(r.report).toEqual({ recovered: ['b2', 'b3'], voided: [{ game: 'b1', reason: 'updated' }] });
      for (const g of ['b2', 'b3']) expect(r.states[g]).toMatchObject({ seq: live[g]!.seq, hash: live[g]!.hash });
      // The voided table stays loaded for its players' chat; its game is over.
      expect(r.states['b1']?.ended).toBe(true);
      expect(r.status).toEqual({ b1: 'void', b2: 'running', b3: 'running' });
      expect(r.results.map((x) => [x.game, x.outcome, x.reason])).toEqual([['b1', 'void', 'updated']]);
      expect(r.engineErrors).toBe(0);
    }, 120_000);

    it('another build with otherBuild "void": every game is voided at once', async () => {
      const r = await reopen(await copy(), 'build-next', 'void');
      expect(r.report.recovered).toEqual([]);
      expect(r.report.voided.map((v) => v.reason)).toEqual(['updated', 'updated', 'updated']);
      expect(r.status).toEqual({ b1: 'void', b2: 'void', b3: 'void' });
    }, 120_000);

    it('the same build: a mismatch is an engine bug (void "recovery", an engine error); a second recovery quarantines', async () => {
      const r = await reopen(await copy({ tamper: true, countB3: true }), 'build-test');
      expect(r.report).toEqual({ recovered: ['b2'], voided: [{ game: 'b1', reason: 'recovery' }, { game: 'b3', reason: 'quarantined' }] });
      expect(r.states['b2']).toMatchObject({ seq: live['b2']!.seq, hash: live['b2']!.hash });
      expect(r.status).toEqual({ b1: 'void', b2: 'running', b3: 'quarantined' });
      expect(r.engineErrors).toBe(1);
      expect(r.metrics.values.get(METRICS.engineErrors)).toBe(1);
      expect(r.metrics.values.get(METRICS.quarantines)).toBe(1);
    }, 120_000);
  });
});
