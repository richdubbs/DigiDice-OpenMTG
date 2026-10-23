/**
 * M15-1: `@openmtg/ladder/api` loads, whichever of its files a loader or a bundle reaches first. api.ts re-exports the parts in ./api/*, so a part
 * that read a value of ../api at its top level (`const { scale } = GLICKO2`) would find it undefined, or in its temporal dead zone, while that cycle
 * loads (milestone 14's review of M14-1, finding 1). So the values live in the leaf ./api/constants.ts:
 *  - Statically: no module that api.ts loads takes a value from api.ts (`import type` only); the leaf takes no value from any module; api.ts
 *    re-exports the leaf and the parts by name (no `export *`).
 *  - By loading, each in a fresh process: an esbuild bundle for the browser, and Node with tsx (the development loader), once per first file.
 * Both keep working after M15-2 fills the parts: they load the files and never call the parts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { API, apiParts, graph, LEAF, PKG, rel, SRC } from './graph';

/** api.ts first, then src/accounts.ts, then each file of ./api/* first. */
const FIRSTS = ['api.ts', 'accounts.ts', ...apiParts().map(rel)];
const PART_FUNCTIONS = [
  'isLadderId', 'validPlaces', 'initialState', 'glicko2Period', 'glicko2RdAt', 'glicko2Expected', 'rateOneVsOne', 'wenglinSigmaAt', 'ratePod',
  'plackettLuceTerms', 'displayRating', 'displayDeviation', 'isProvisional', 'provisionalFrom', 'standingOf', 'tierOf', 'tierAfter', 'badgeTier',
  'isSeasonId', 'seasonOf', 'seasonBounds', 'nextSeason', 'seasonReset', 'ratingNow', 'capShareThreshold', 'capVerdict', 'stakesOneVsOne', 'stakesPod',
];
const LEAF_VALUES = [
  'LADDER_IDS', 'LADDERS', 'ACCOUNT_ID_SHAPE', 'DELETED_PLAYER_NAME', 'LOSS_CODES', 'GLICKO2', 'WENGLIN', 'LEADERBOARD_K', 'TIER_IDS', 'TIER_NAMES',
  'DEFAULT_TIER_FLOORS', 'TIER_DEMOTION_BUFFER', 'SEASON_ID', 'SEASON_RESET', 'SEASON_BADGE_GAMES', 'BADGE_CAREER_GAMES', 'LADDER_LIMITS',
];

/** esbuild is a dependency of tsx and vitest, not of the project: the bundle test is skipped when it cannot be imported. */
const esbuild = await import('esbuild').catch(() => null);

const tmp = mkdtempSync(join(tmpdir(), 'openmtg-m15-1-load-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let runs = 0;
function runNode(args: string[], script: string): unknown {
  const file = join(tmp, `run-${++runs}.mjs`);
  writeFileSync(file, script, 'utf8');
  return JSON.parse(execFileSync(process.execPath, [...args, file], { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

/** What every load prints: the contract's exports as seen after `first` loaded first. */
const REPORT = `
const fns = ${JSON.stringify(PART_FUNCTIONS)};
const values = ${JSON.stringify(LEAF_VALUES)};
console.log(JSON.stringify({
  sameValues: values.filter((v) => api[v] === undefined || api[v] !== leaf[v]),
  numbers: [api.GLICKO2.scale, api.WENGLIN.cRef, api.LADDERS['pod-commander'].seats, api.DEFAULT_TIER_FLOORS[4], api.LADDER_LIMITS.leaderboardPage],
  parts: fns.map((f) => typeof api[f]),
}));
`;
const WANT = { sameValues: [], numbers: [173.7178, 9, [4, 3], 1800, 50], parts: PART_FUNCTIONS.map(() => 'function') };

describe('M15-1: the contract has no load-order hazard', () => {
  it('no module api.ts loads takes a value from api.ts; the leaf takes no value from any module', () => {
    const g = graph([API, ...apiParts()]);
    for (const [file, edges] of g) {
      if (file === API) continue;
      for (const e of edges.filter((x) => x.to === API)) {
        expect(e.typeOnly, `${rel(file)}: "${e.text}" takes a value from ../api (a cycle: take values from ./constants, types with import type)`).toBe(true);
      }
    }
    for (const e of g.get(LEAF)!) expect(e.typeOnly, `api/constants.ts: "${e.text}" takes a value`).toBe(true);
  });

  it('api.ts declares no value of its own and re-exports the leaf and the parts by name', () => {
    const text = readFileSync(API, 'utf8');
    expect(text).not.toMatch(/^export \*/m);
    expect(text).not.toMatch(/^export (const|let|var|function|class|enum)\b/m);
    const reexported = [...text.matchAll(/^export \{ ([^}]+) \} from '\.\/api\/([a-z0-9]+)';$/gm)].flatMap((m) => m[1]!.split(',').map((s) => s.trim()));
    expect([...reexported].sort()).toEqual([...LEAF_VALUES, ...PART_FUNCTIONS].sort());
  });

  it.skipIf(esbuild === null)('an esbuild bundle for the browser loads, whichever file comes first', async () => {
    for (const first of FIRSTS) {
      const out = await esbuild!.build({
        stdin: {
          contents: `import * as first from './${first}'; import * as api from './api.ts'; import * as leaf from './api/constants.ts';\nvoid first;\n${REPORT}`,
          resolveDir: SRC, sourcefile: 'load-entry.ts', loader: 'ts',
        },
        bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
      });
      const file = join(tmp, `bundle-${first.replace(/\W/g, '_')}.mjs`);
      writeFileSync(file, out.outputFiles[0]!.text, 'utf8');
      expect(JSON.parse(execFileSync(process.execPath, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })), first).toEqual(WANT);
    }
  }, 120_000);

  it('Node with tsx loads it, whichever file comes first', () => {
    for (const first of FIRSTS) {
      const url = (f: string) => JSON.stringify(pathToFileURL(join(SRC, f)).href);
      const script = `await import(${url(first)}); const api = await import(${url('api.ts')}); const leaf = await import(${url('api/constants.ts')});\n${REPORT}`;
      expect(runNode(['--import', 'tsx'], script), first).toEqual(WANT);
    }
  }, 120_000);
});
