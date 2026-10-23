/**
 * M15-3: the `openmtg-ladder` command (design 11.2, 11.3, 13.3, 17.10): `reports` lists the stored reports, `reset` resets a rating with its audit
 * row; both open the file store in --dir or <DATA_DIR>/ladder (a relative one from INIT_CWD, else the working directory), never make one, and are
 * refused while the server holds its lock. Usage errors exit 2, refusals 1.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { main, USAGE, type CliIo } from '../../src/cli';
import { initialState } from '../../src/api';
import { LADDER_STORE_IN_USE, openFileLadderStore } from '../../src/service/create';
import type { AbuseReport } from '../../src/abuse/types';
import { acc, gid } from './fixtures';
import { placesInDir } from './support';

const root = mkdtempSync(join(tmpdir(), 'openmtg-m15-3-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(root, `d${++n}`);
const A = acc(1);
const NOW = Date.parse('2026-10-20T12:00:00.000Z');

function io(env: Record<string, string> = {}): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => void out.push(t), stderr: (t) => void err.push(t), env, now: () => NOW };
}

const report = (i: number, createdAt: string): AbuseReport => ({
  id: gid(500 + i), kind: 'dodging', ladder: '1v1-standard', accounts: [A], evidence: { games: [], stats: { misses: 6 } }, createdAt,
  dedupeKey: `k${i}`.padEnd(43, 'A'), status: 'pending',
});

describe('M15-3: openmtg-ladder', () => {
  it('reports: one JSON object a line, oldest first, from --since, at most --limit', async () => {
    const dir = fresh();
    const s = await openFileLadderStore({ dir });
    await s.putReport(report(1, '2026-10-01T00:00:00.000Z'));
    await s.putReport(report(2, '2026-10-10T00:00:00.000Z'));
    await s.putReport(report(3, '2026-10-12T00:00:00.000Z'));
    await s.close();
    let x = io();
    expect(await main(['reports', '--dir', dir], x)).toBe(0);
    expect(x.out.map((l) => (JSON.parse(l) as AbuseReport).id)).toEqual([gid(501), gid(502), gid(503)]);
    x = io();
    expect(await main(['reports', '--dir', dir, '--since', '2026-10-05T00:00:00.000Z', '--limit', '1'], x)).toBe(0);
    expect(x.out.map((l) => (JSON.parse(l) as AbuseReport).id)).toEqual([gid(502)]);
    // the store is <DATA_DIR>/ladder unless --dir names it
    const data = fresh();
    mkdirSync(data);
    const s2 = await openFileLadderStore({ dir: join(data, 'ladder') });
    await s2.putReport(report(4, '2026-10-01T00:00:00.000Z'));
    await s2.close();
    x = io({ DATA_DIR: data });
    expect(await main(['reports'], x)).toBe(0);
    expect(x.out).toHaveLength(1);
  });

  it('reset: the rating back to the initial state with placement again, the audit row printed; nothing else changes', async () => {
    const dir = fresh();
    const s = await openFileLadderStore({ dir });
    const row = { account: A, ladder: '1v1-standard' as const, state: { model: 'glicko2' as const, r: 1900, rd: 60, vol: 0.06 }, season: '2026-10', lastRatedAt: '2026-10-19T12:00:00.000Z', games: 40, tier: 'prism' as const, version: 3 };
    await s.seedRating(row);
    await s.close();
    const x = io();
    expect(await main(['reset', A, '1v1-standard', '--by', 'moderator-7', '--reason', 'second account', '--dir', dir], x)).toBe(0);
    const audit = JSON.parse(x.out.join('')) as { account: string; by: string; reason: string; before: { games: number }; after: { games: number; version: number }; at: string };
    expect([audit.account, audit.by, audit.reason, audit.before.games, audit.after.games, audit.after.version, audit.at]).toEqual([A, 'moderator-7', 'second account', 40, 0, 4, '2026-10-20T12:00:00.000Z']);
    const again = await openFileLadderStore({ dir });
    expect((await again.ratings('1v1-standard', [A])).get(A)).toMatchObject({ state: initialState('glicko2'), games: 0, tier: null, lastRatedAt: null, season: '2026-10' });
    await again.close();
  });

  it('reset of an account with no rating in the ladder (a mistyped id, or one erased since) is refused, and writes nothing (review of M15-3)', async () => {
    const dir = fresh();
    await (await openFileLadderStore({ dir })).close();
    const x = io();
    expect(await main(['reset', A, '1v1-standard', '--by', 'mod', '--reason', 'test', '--dir', dir], x)).toBe(2);
    expect(x.err.join('')).toContain('no rating in 1v1-standard');
    expect(x.out).toEqual([]);
    expect(placesInDir(dir, A)).toEqual([]);
  });

  it('both commands are refused while the server holds the store\'s lock, and write nothing', async () => {
    const dir = fresh();
    const server = await openFileLadderStore({ dir });
    for (const argv of [['reports', '--dir', dir], ['reset', A, '1v1-standard', '--by', 'm', '--reason', 'r', '--dir', dir]]) {
      const x = io();
      expect(await main(argv, x)).toBe(1);
      expect(x.err.join('')).toContain(LADDER_STORE_IN_USE);
      expect(x.out).toEqual([]);
    }
    expect(await server.ratings('1v1-standard', [A])).toEqual(new Map());
    await server.close();
  });

  it('a directory that holds no ladder store is refused (exit 1) with its absolute path, and nothing is made there (review of M15-3)', async () => {
    const dir = fresh();
    for (const argv of [['reports', '--dir', dir], ['reset', A, '1v1-standard', '--by', 'mod', '--reason', 'test', '--dir', dir]]) {
      const x = io();
      expect(await main(argv, x), argv.join(' ')).toBe(1);
      expect(x.err.join(''), argv.join(' ')).toContain(`no ladder store in ${dir}`);
      expect(x.out).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    }
    // an empty directory is no store either
    mkdirSync(dir);
    expect(await main(['reports', '--dir', dir], io())).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a relative --dir or DATA_DIR is taken from INIT_CWD (where npm was run), else the working directory; the absolute directory is printed (review of M15-3)', async () => {
    const base = fresh();
    const s = await openFileLadderStore({ dir: join(base, 'data', 'ladder') });
    await s.putReport(report(1, '2026-10-01T00:00:00.000Z'));
    await s.close();
    const elsewhere = fresh();
    mkdirSync(elsewhere);
    // npm runs the script in packages/ladder; INIT_CWD is where the owner typed the command
    let x = { ...io({ INIT_CWD: base }), cwd: () => elsewhere };
    expect(await main(['reports'], x)).toBe(0);
    expect(x.out).toHaveLength(1);
    expect(x.err.join('')).toContain(`on the ladder store in ${join(base, 'data', 'ladder')}`);
    x = { ...io({ INIT_CWD: base }), cwd: () => elsewhere };
    expect(await main(['reports', '--dir', join('data', 'ladder')], x)).toBe(0);
    expect(x.out).toHaveLength(1);
    x = { ...io({ DATA_DIR: 'data' }), cwd: () => base };
    expect(await main(['reports'], x)).toBe(0);
    expect(x.out).toHaveLength(1);
    // without INIT_CWD, from the working directory: here, no store, and none is made
    x = { ...io(), cwd: () => elsewhere };
    expect(await main(['reports'], x)).toBe(1);
    expect(x.err.join('')).toContain(`no ladder store in ${join(elsewhere, 'data', 'ladder')}`);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('usage errors exit 2 with the usage; help exits 0', async () => {
    const dir = fresh();
    for (const argv of [
      [], ['nonsense'], ['reports', 'extra'], ['reports', '--since', 'yesterday'], ['reports', '--limit', '0'], ['reports', '--color', 'red'],
      ['reports', '--dir'], ['reports', '--dir', dir, '--dir', dir], ['reset', A], ['reset', A, 'chess', '--by', 'm', '--reason', 'r'],
      ['reset', A, '1v1-standard', '--reason', 'r'], ['reset', 'not-an-account', '1v1-standard', '--by', 'm', '--reason', 'r', '--dir', dir],
      ['reset', A, '1v1-standard', '--by', '\u0007', '--reason', 'r', '--dir', dir],
    ]) {
      const x = io();
      expect(await main(argv, x), argv.join(' ')).toBe(2);
      expect(x.err.join(''), argv.join(' ')).toContain(USAGE);
    }
    const x = io();
    expect(await main(['help'], x)).toBe(0);
    expect(x.out.join('')).toContain('openmtg-ladder reports');
  });

  it('runs as the package\'s bin entry', () => {
    const cli = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
    // tsx's own entry under this node: Windows cannot run node_modules/.bin/tsx, a shell script, directly
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    const out = execFileSync(process.execPath, [tsx, cli, 'help'], { encoding: 'utf8' });
    expect(out).toContain('openmtg-ladder reset');
  }, 60_000);
});
