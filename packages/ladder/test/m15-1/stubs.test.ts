/**
 * M15-1: every function of design 13 has a file at its owner's final path (13 intro, 16, 17.1), exporting it under its fixed name. While a file is
 * still M15-1's stub (its header says "STUB (M15-1)"), every function in it throws "not built yet (M15-n): <name>" naming its owner. The test
 * survives the owners filling the files: once a header is gone, only the export is checked (the owner's own tests take over).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rel, SRC, tsFiles } from './graph';

interface StubFile { file: string; owner: 'M15-2' | 'M15-3' | 'M15-4' | 'M15-5' | 'M15-7'; functions: Record<string, unknown[]> }

const R = { model: 'glicko2', r: 1500, rd: 350, vol: 0.06 };
const P = { model: 'wenglin', mu: 25, sigma: 25 / 3 };
const DEF = { id: '1v1-standard', format: 'standard', seats: [2], bestOf: 1, model: 'glicko2', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 };

/** The stubs of 13.1-13.5 and 13.7 with arguments of the right shape (the stubs never look at them). */
const STUBS: StubFile[] = [
  { file: 'api/ladders.ts', owner: 'M15-2', functions: { isLadderId: ['1v1-standard'] } },
  { file: 'api/places.ts', owner: 'M15-2', functions: { validPlaces: [[1, 2]] } },
  {
    file: 'api/display.ts', owner: 'M15-2', functions: {
      initialState: ['glicko2'], displayRating: [R], displayDeviation: [R], isProvisional: [DEF, 130, 12],
      provisionalFrom: [DEF, R, '2026-10-15T12:00:00.000Z'], standingOf: [1600, 80],
    },
  },
  {
    file: 'api/glicko2.ts', owner: 'M15-2', functions: {
      glicko2Period: [R, [{ r: 1400, rd: 30, score: 1 }]], glicko2RdAt: [60, 10], glicko2Expected: [R, R], rateOneVsOne: [R, R, 1, 0, 0],
    },
  },
  { file: 'api/wenglin.ts', owner: 'M15-2', functions: { wenglinSigmaAt: [3, 10], ratePod: [[P, P, P], [1, 2, 3], [0, 0, 0]], plackettLuceTerms: [[P, P], [1, 2]] } },
  { file: 'api/tiers.ts', owner: 'M15-2', functions: { tierOf: [1500], tierAfter: [null, 1500], badgeTier: [[1500, 1510, 1520, 1530, 1540], 30] } },
  {
    file: 'api/season.ts', owner: 'M15-2', functions: {
      isSeasonId: ['2026-10'], seasonOf: ['2026-10-15T12:00:00.000Z'], seasonBounds: ['2026-10'], nextSeason: ['2026-12'], seasonReset: [R],
      ratingNow: [{ state: R, season: '2026-09', lastRatedAt: null }, '2026-10-15T12:00:00.000Z'],
    },
  },
  { file: 'api/cap.ts', owner: 'M15-2', functions: { capShareThreshold: [2], capVerdict: ['actions', [{ seat: 1, initiated: 10, chargedMs: 0 }]] } },
  { file: 'api/stakes.ts', owner: 'M15-2', functions: { stakesOneVsOne: [R, R, 0, 0], stakesPod: [[P, P, P, P], 0, [0, 0, 0, 0]] } },
  { file: 'intake/adapter.ts', owner: 'M15-3', functions: { toRatedGame: [{}, null, () => true] } },
  { file: 'service/create.ts', owner: 'M15-3', functions: { createLadderService: [{}] } },
  { file: 'cli.ts', owner: 'M15-3', functions: { main: [['reports']] } },
  { file: 'match/index.ts', owner: 'M15-4', functions: { createRatedMatcher: [{}], rankedWindow: [0, false] } },
  { file: 'abuse/index.ts', owner: 'M15-5', functions: { createAbuseChecker: [] } },
  { file: 'store/postgres.ts', owner: 'M15-7', functions: { openPostgresLadderStore: [{}] } },
];

/** The error a call ends in (thrown, or a rejected promise), or null when it returned. */
async function failure(f: (...a: unknown[]) => unknown, args: unknown[]): Promise<unknown> {
  try {
    await f(...args);
    return null;
  } catch (e) {
    return e;
  }
}

describe('M15-1: the stubs', () => {
  it('every stub file exists at its final path', () => {
    for (const s of STUBS) expect(existsSync(join(SRC, s.file)), s.file).toBe(true);
  });

  it('no other source file is an M15-1 stub', () => {
    const stubs = tsFiles(SRC).filter((f) => readFileSync(f, 'utf8').includes('STUB (M15-1)')).map(rel).sort();
    for (const f of stubs) expect(STUBS.map((s) => s.file), f).toContain(f);
  });

  for (const s of STUBS) {
    it(`${s.file} (${s.owner}): exports ${Object.keys(s.functions).join(', ')}; while a stub, each throws "not built yet (${s.owner})"`, async () => {
      const mod = (await import(pathToFileURL(join(SRC, s.file)).href)) as Record<string, unknown>;
      const stub = readFileSync(join(SRC, s.file), 'utf8').includes('STUB (M15-1)');
      for (const [name, args] of Object.entries(s.functions)) {
        const f = mod[name];
        expect(typeof f, `${s.file} exports ${name}`).toBe('function');
        if (!stub) continue;
        const e = await failure(f as (...a: unknown[]) => unknown, args);
        expect(e, `${name} throws`).toBeInstanceOf(Error);
        expect((e as Error).message).toBe(name === 'main' ? `not built yet (${s.owner}): openmtg-ladder` : `not built yet (${s.owner}): ${name}`);
      }
    });
  }
});
