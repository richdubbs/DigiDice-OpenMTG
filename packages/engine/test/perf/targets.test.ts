/**
 * Package P1 targets for interactive play, measured on this machine. Timing depends on the machine and on what else runs, so these run only when asked:
 *   OPENMTG_PERF=1 npx vitest run packages/engine/test/perf/targets.test.ts
 * (alone, not inside the parallel suite). `bench.ts` prints the same numbers without asserting.
 *  - applyAction on the M3 soak decks (every action of the 20 games, the soak's re-applications of listed actions included): p95 under 50 ms, max under 250 ms.
 *  - The same on the M4 real games.
 *  - A 60-card deck (24 distinct fixture cards) compiles in under 2 s cold: a fresh process loading the engine as a built (bundled) program does, from the
 *    start of the process; under the tsx development loader the compile itself (module loading excluded) does.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureReal, measureSoak } from './harness';

const enabled = process.env['OPENMTG_PERF'] === '1';

describe.skipIf(!enabled)('P1 performance targets (OPENMTG_PERF=1)', () => {
  it('applyAction on the soak decks: p95 < 50 ms, max < 250 ms', () => {
    const m = measureSoak();
    console.log('soak applyAction', JSON.stringify(m.all), 'bot actions', JSON.stringify(m.play), 'legalActions', JSON.stringify(m.legal));
    expect(m.all.p95Ms).toBeLessThan(50);
    expect(m.all.maxMs).toBeLessThan(250);
    expect(m.legal.p95Ms).toBeLessThan(50);
  }, 600_000);

  it('applyAction on the M4 real games: p95 < 50 ms, max < 250 ms', () => {
    const m = measureReal();
    console.log('real applyAction', JSON.stringify(m.play));
    expect(m.play.p95Ms).toBeLessThan(50);
    expect(m.play.maxMs).toBeLessThan(250);
  }, 120_000);

  it('a 60-card deck compiles in under 2 s cold', () => {
    const bench = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bench.ts');
    const root = path.resolve(path.dirname(bench), '..', '..', '..', '..');
    const text = execFileSync(process.execPath, ['--import', 'tsx', bench, 'compile'], { encoding: 'utf8', cwd: root });
    console.log(text.trim());
    const tsx = JSON.parse(/compile \(tsx\) (\{.*\})/.exec(text)![1]!) as { coldCompileMs: number; same: boolean };
    expect(tsx.same).toBe(true);
    expect(tsx.coldCompileMs).toBeLessThan(2000);
    const bundled = /compile \(bundled\) (\{.*\})/.exec(text);
    if (bundled) expect((JSON.parse(bundled[1]!) as { sinceProcessStartMs: number }).sinceProcessStartMs).toBeLessThan(2000);
  }, 120_000);
});
