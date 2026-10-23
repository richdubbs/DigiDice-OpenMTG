/**
 * M15-6 (slow suite): the population simulation is deterministic and drives the matcher as hosted would.
 *  - The same options give deeply equal results; another seed gives others.
 *  - Ticking only when a tick can form a match gives exactly the matches, times and games of a tick every second (hosted's timer wheel), in both
 *    ladders, with give-ups and missed ready checks in the mix.
 *  - No simulation file reads Math.random or Date.now: every draw comes from the seeded RNG and every time from the simulation's FakeClock.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { describeSlow } from '../../../engine/test/slow';
import type { SimLadder } from './params';
import { Population, type PopulationOptions } from './population';

const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/simulate.ts', import.meta.url));

function small(ladder: SimLadder, over: Partial<PopulationOptions> = {}): PopulationOptions {
  return {
    ladder, players: 120, seed: 'determinism', days: 5, arrivalDays: 1, activity: [5, 10, 30, 100], readyMiss: 0.05, patienceMs: 8 * 60_000,
    abuse: false, log: true, ...over,
  };
}

describeSlow('M15-6: the population simulation', () => {
  for (const ladder of ['1v1-standard', 'pod-commander'] as SimLadder[]) {
    it(`${ladder}: the same options give the same run, another seed another`, async () => {
      const a = await new Population(small(ladder)).run();
      const b = await new Population(small(ladder)).run();
      expect(a.games).toBeGreaterThan(ladder === '1v1-standard' ? 50 : 15);
      const view = (r: typeof a) => ({ log: r.log, waits: r.waits, seasons: r.seasons, rows: r.players.map((pl) => pl.row), errors: [...r.errors] });
      expect(view(b)).toEqual(view(a));
      const c = await new Population(small(ladder, { seed: 'another' })).run();
      expect(c.log!.games).not.toEqual(a.log!.games);
    });

    it(`${ladder}: ticking only when a tick can form a match equals a tick every second`, async () => {
      const o = small(ladder, { seed: 'ticks', players: ladder === '1v1-standard' ? 90 : 110, days: 4 });
      const sparse = await new Population(o).run();
      const every = await new Population({ ...o, tickEverySecond: true }).run();
      expect(sparse.giveUps + sparse.readyChecksFailed).toBeGreaterThan(0);
      expect(every.log).toEqual(sparse.log);
      expect(every.waits).toEqual(sparse.waits);
      expect(every.matches).toBe(sparse.matches);
    }, 120_000);
  }

  it('no simulation file draws from the global random source or reads the wall clock', () => {
    const files = [...readdirSync(SIM_DIR).filter((f) => f.endsWith('.ts')).map((f) => join(SIM_DIR, f)), SCRIPT];
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/Math\.random|Date\.now/);
    }
  });
});
