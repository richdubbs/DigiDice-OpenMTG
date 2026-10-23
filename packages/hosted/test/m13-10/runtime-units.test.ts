/**
 * M13-10 review finding 1: the real runtime counts units with the configured weights (`RuntimeOptions.units`), so running, reserved and freed units are one
 * system with admission's: the review's case was UNITS_1V1=2, UNITS_POD3=8, UNITS_POD4=10 on a runtime that counted every 1v1 game as 1. Real game
 * workers, AI-seeded tables, a memory store (and a file store for the restart); no network.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CapacityAdmission, startRequestFor, type UnitWeights } from '../../src/admission';
import { MemoryMetrics, METRICS } from '../../src/obs';
import type { TableDirectory, TableMeta } from '../../src/runtime';
import { FileStore, MemoryStore } from '../../src/store';
import { DECKS, Driver, startSeats, T0, type AiTable } from '../m13-5/harness';

/** UNITS_1V1=2, UNITS_POD3=8, UNITS_POD4=10 (the review's figures). */
const W: UnitWeights = { two: 2, three: 8, four: 10 };
const decksOf = (i: number) => [DECKS[i % 3]!, DECKS[(i + 1) % 3]!] as const;

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5 });
});

describe('M13-10 review 1: the runtime and admission count in one unit system', () => {
  it('a 1v1 game is 2 units to the runtime: running units, TableEnded.units and the signal admission reads agree with the configured weights', async () => {
    const store = new MemoryStore();
    const driver = new Driver();
    const metrics = new MemoryMetrics(2);
    const rt = driver.make({ store, workers: 2, units: W, metrics });
    try {
      await rt.open();
      // Admission on the real runtime: a capacity of 5 units holds two 1v1 games (2 + 2) and not a third (6)
      const adm = new CapacityAdmission({ signals: rt, limits: { capacityUnits: 5, units: W }, metrics });
      const ask = (game: string) =>
        adm.request(startRequestFor({ table: game, source: 'listed', seats: 2, sessions: [`s-${game}-1`, `s-${game}-2`], addressKeys: [`k-${game}`], since: T0 }, W), T0);

      const tables: AiTable[] = [];
      for (const [i, game] of ['g1', 'g2'].entries()) {
        expect(ask(game)).toEqual({ kind: 'admitted' });
        expect(adm.size().reserved).toBe(2);
        tables.push(await driver.start(store, game, ...decksOf(i), { seed: `seed-${game}` }));
        // `start` returned: the runtime counts the game, then admission ends its reservation (the order the gateway uses)
        adm.begun(game, T0);
        expect(adm.size().reserved).toBe(0);
        expect(rt.runningUnits()).toBe(2 * (i + 1));
        expect(rt.read(T0).runningUnits).toBe(2 * (i + 1));
        expect(metrics.values.get(METRICS.capacityUnits)).toBe(2 * (i + 1));
      }
      expect(ask('g3')).toMatchObject({ kind: 'waiting', position: 1 });

      // g1 ends (a seat concedes): the event carries the game's units in the same weights, and admission's freed call lets g3 in
      rt.submit('g1', { t: 'leave', seat: 1, id: 1 });
      await rt.settleAll();
      const ended = driver.ended.get('g1');
      expect(ended?.units).toBe(2);
      expect(rt.read(T0).runningUnits).toBe(2);
      expect(adm.freed(ended!.units, T0)).toEqual([{ kind: 'admitted', table: 'g3' }]);
      expect(adm.size()).toEqual({ starts: 0, units: 0, reserved: 2 });
      void tables;
    } finally {
      await rt.close();
    }
  }, 180_000);

  it('the default weights are the design\'s (1, 4, 5) when none are given', async () => {
    const store = new MemoryStore();
    const driver = new Driver();
    const rt = driver.make({ store, workers: 1 });
    try {
      await rt.open();
      await driver.start(store, 'd1', ...decksOf(0), { seed: 'seed-d1' });
      expect(rt.runningUnits()).toBe(1);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it('a restart recovers the games with the configured weights too: running units after recovery are 2 per game', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openmtg-m13-10-'));
    dirs.push(dir);
    const games = ['r1', 'r2'];
    const LIMITS = { checkpointEvery: 10 };

    const first = await FileStore.open(dir);
    const d1 = new Driver();
    const rt1 = d1.make({ store: first, workers: 1, units: W });
    try {
      await rt1.open();
      const tables: AiTable[] = [];
      for (const [i, g] of games.entries()) tables.push(await d1.start(first, g, ...decksOf(i), { limits: LIMITS }));
      await Promise.all(tables.map((t) => t.play(15)));
      await rt1.settleAll();
      expect(rt1.read(T0).runningUnits).toBe(4);
    } finally {
      await rt1.close();
      await first.close();
    }

    const metas = new Map<string, TableMeta>(games.map((g, i) => [g, {
      game: g, format: 'casual', source: 'listed', seats: 2, startedAt: T0, limits: LIMITS,
      ledgerSeats: startSeats(g, ...decksOf(i)).map((s) => ({ seat: s.seat, session: s.session, deckHash: s.deckHash })),
    }]));
    const directory: TableDirectory = { meta: async (g) => metas.get(g) ?? null };
    const second = await FileStore.open(dir);
    const d2 = new Driver();
    const rt2 = d2.make({ store: second, workers: 1, units: W, directory });
    try {
      const report = await rt2.open();
      expect(report.recovered).toEqual(games);
      expect(rt2.runningUnits()).toBe(4);
      expect(rt2.read(T0).runningUnits).toBe(4);
      // admission on the recovered runtime: 4 units are running, a capacity of 5 has no room for a third 1v1 game (2)
      const adm = new CapacityAdmission({ signals: rt2, limits: { capacityUnits: 5, units: W } });
      expect(adm.request(startRequestFor({ table: 'r3', source: 'listed', seats: 2, sessions: ['a', 'b'], addressKeys: ['k'], since: T0 }, W), T0).kind).toBe('waiting');
    } finally {
      await rt2.close();
      await second.close();
    }
  }, 240_000);
});
