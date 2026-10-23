/**
 * M13-14: the operator's commands (ops/main.ts: check, migrate, purge, hide), the daily purge, and the container's health probe (obs/probe.mjs), in
 * process: the database is PGlite, the probe's HTTP client is a fake (no sockets: the owner's rule allows one loopback game, nothing else).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hideFileOf } from '../../src/moderation/hidden';
import { CARD_INDEX_FILES, main, preflight, USAGE } from '../../src/ops/main';
import { grantStatements, migrateAll, RIGHTS_TABLES, SERVICE_RIGHTS } from '../../src/ops/migrate';
import { DAY_MS, startPurgeSchedule, type PurgeTimers } from '../../src/ops/purge';
import { parseConfig } from '../../src/config';
import { MemoryLogger } from '../../src/obs';
import { pgliteClient, type SqlClient } from '../../src/store';
// @ts-expect-error: plain JavaScript without types (it runs in the image without the TypeScript loader)
import { main as probeMain, targetOf } from '../../src/obs/probe.mjs';

const SECRET = '0123456789abcdef'.repeat(4);
const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'm13-14-'));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function io(env: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  return { env, out: (t: string) => out.push(t), err: (t: string) => err.push(t), lines: { out, err } };
}

describe('M13-14 ops check: the environment as the server reads it, and the files it names', () => {
  it('prints the configuration with the secrets hidden, and says what is missing', async () => {
    const cards = await tmp();
    const x = io({ STORE: 'memory', CARD_DATA_DIR: cards, LEDGER_SECRET: SECRET, METRICS_PORT: '9464', METRICS_TOKEN: 'cd'.repeat(32) });
    expect(await main(['check'], x)).toBe(1);
    const printed = x.lines.out.join('\n');
    expect(JSON.parse(printed)).toMatchObject({ store: 'memory', ledgerSecret: '(set)', metricsToken: '(set)' });
    expect(printed).not.toContain(SECRET);
    expect(x.lines.err.join('\n')).toMatch(/CARD_DATA_DIR has no cards\.jsonl/);
    for (const f of CARD_INDEX_FILES) await writeFile(join(cards, f), '', 'utf8');
    const y = io({ STORE: 'memory', CARD_DATA_DIR: cards });
    expect(await main(['check'], y)).toBe(0);
  });

  it('a configuration error is exit 2 with the variable named and never a secret\'s value', async () => {
    const x = io({ STORE: 'postgres', DATABASE_URL: 'mysql://user:topsecretpw@db/x', LEDGER_SECRET: 'nothex' });
    expect(await main(['check'], x)).toBe(2);
    const text = x.lines.err.join('\n');
    expect(text).toMatch(/DATABASE_URL: must start with postgres/);
    expect(text).toMatch(/LEDGER_SECRET/);
    expect(text).not.toMatch(/topsecretpw|nothex/);
  });

  it('a missing card index or word list is named; the usage and unknown commands are exit 2', async () => {
    const parsed = parseConfig({ CARD_DATA_DIR: join(await tmp(), 'nope'), MODERATION_WORDS_FILE: join(await tmp(), 'words.txt') }, { cpus: 2 });
    if (!parsed.ok) throw new Error('config');
    const problems = await preflight(parsed.config);
    expect(problems.join('\n')).toMatch(/is not a directory/);
    expect(problems.join('\n')).toMatch(/MODERATION_WORDS_FILE .* is not a file/);
    const x = io({});
    expect(await main([], x)).toBe(2);
    expect(x.lines.err.join('\n')).toContain(USAGE);
    expect(await main(['launch-missiles'], io({}))).toBe(2);
  });
});

describe('M13-14 ops hide and unhide', () => {
  it('append one record to the hide file in DATA_DIR; a table id that is not one is refused', async () => {
    const data = await tmp();
    const x = io({ DATA_DIR: data });
    expect(await main(['hide', '01JABCDEFGHJKMNPQRSTVWXYZ0'], x)).toBe(0);
    expect(await main(['unhide', '01JABCDEFGHJKMNPQRSTVWXYZ0'], x)).toBe(0);
    const lines = (await readFile(hideFileOf(data), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { op: string });
    expect(lines.map((l) => l.op)).toEqual(['hide', 'unhide']);
    expect(await main(['hide', '../../etc/passwd'], io({ DATA_DIR: data }))).toBe(2);
    expect(await main(['hide'], io({ DATA_DIR: data }))).toBe(2);
  });
});

describe('M13-14 ops purge', () => {
  it('refuses the memory store (nothing to purge between processes) and purges a file store', async () => {
    expect(await main(['purge'], io({ STORE: 'memory' }))).toBe(2);
    const data = await tmp();
    await mkdir(data, { recursive: true });
    const x = io({ STORE: 'file', DATA_DIR: data });
    expect(await main(['purge'], x)).toBe(0);
    expect(x.lines.out.join('\n')).toMatch(/^purged: 0 sessions, 0 games, 0 action records, 0 snapshots, 0 bug reports$/);
    expect(x.lines.err.join('\n')).toMatch(/stop the server before purging/);
  });

  it('the server\'s own schedule: first after 10 minutes, then daily; a failure is logged and the next run still comes', async () => {
    const armed: { fn: () => void; ms: number }[] = [];
    const timers: PurgeTimers = { set: (fn, ms) => armed.push({ fn, ms }), clear: () => undefined };
    let fail = true;
    let runs = 0;
    const logger = new MemoryLogger();
    const s = startPurgeSchedule({
      store: { purge: async () => (runs++, fail ? Promise.reject(new Error('db down')) : { sessions: 0, games: 0, records: 0, snapshots: 0, reports: 0 }) },
      retention: { logsDays: 90, lobbyDays: 7, voidDays: 90, sessionDays: 30, serverLogDays: 14 },
      logger,
      timers,
    } as never);
    expect(armed.map((a) => a.ms)).toEqual([10 * 60_000]);
    armed[0]!.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(logger.entries().find((e) => e['event'] === 'purgeFailed')).toBeTruthy();
    expect(armed.map((a) => a.ms)).toEqual([10 * 60_000, DAY_MS]);
    fail = false;
    expect(await s.runNow()).toMatchObject({ games: 0 });
    expect(runs).toBe(2);
    s.stop();
  });
});

describe('M13-14 ops migrate on PostgreSQL (PGlite)', () => {
  let db: PGlite;
  let sql: SqlClient;
  beforeAll(async () => {
    db = await PGlite.create();
    sql = pgliteClient(db);
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  it('applies accounts then hosted once, says "already current" the second time, and gives the service role exactly its rights', async () => {
    const x = io({});
    expect(await main(['migrate'], { ...x, sql })).toBe(0);
    expect(x.lines.out[0]).toMatch(/^accounts: applied /);
    expect(x.lines.out[1]).toMatch(/^hosted: applied 001/);
    const again = io({});
    expect(await main(['migrate'], { ...again, sql })).toBe(0);
    expect(again.lines.out).toEqual([expect.stringMatching(/^accounts: already current/), expect.stringMatching(/^hosted: already current/)]);

    // a role that does not exist is refused with what to do
    const missing = io({});
    expect(await main(['migrate', '--grant', 'openmtg_service'], { ...missing, sql })).toBe(1);
    expect(missing.lines.err.join('\n')).toMatch(/does not exist: create it first/);

    await db.exec('CREATE ROLE openmtg_service NOLOGIN');
    const granted = io({});
    expect(await main(['migrate', '--grant', 'openmtg_service'], { ...granted, sql })).toBe(0);
    expect(granted.lines.out.at(-1)).toBe('rights granted to openmtg_service');
    const rights = await db.query<{ table_name: string; privilege_type: string }>(
      "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'openmtg_service' AND table_schema = current_schema() ORDER BY 1, 2",
    );
    const of = (t: string) => rights.rows.filter((r) => r.table_name === t).map((r) => r.privilege_type).sort();
    for (const t of SERVICE_RIGHTS.readWrite) expect(of(t), t).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    for (const t of SERVICE_RIGHTS.appendOnly) expect(of(t), t).toEqual(['INSERT', 'SELECT']);
    for (const t of SERVICE_RIGHTS.readOnly) expect(of(t), t).toEqual(['SELECT']);
    // every table of hosted's schema is named by exactly one rule
    const tables = await db.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'");
    expect(tables.rows.map((r) => r.t).sort()).toEqual([...RIGHTS_TABLES].sort());
  }, 120_000);

  it('a name that is not one is refused before any SQL; DATABASE_URL must be a postgres URL', async () => {
    expect(() => grantStatements('x"; DROP TABLE games; --', 'public')).toThrow(/is not a name/);
    await expect(migrateAll(sql, { grantTo: 'Robert\'); --' })).rejects.toThrow(/is not a name/);
    expect(await main(['migrate'], io({}))).toBe(2);
    expect(await main(['migrate'], io({ DATABASE_URL: 'mysql://x' }))).toBe(2);
  });
});

describe('M13-14 the health probe', () => {
  /** `http.get` as the probe calls it, answering `status` and `body` (no socket). */
  function fakeGet(status: number, body: string, seen: unknown[] = []) {
    return (opts: unknown, onRes: (res: EventEmitter & { statusCode: number }) => void) => {
      seen.push(opts);
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => undefined;
      queueMicrotask(() => {
        const res = Object.assign(new EventEmitter(), { statusCode: status, destroy: () => undefined });
        onRes(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
      });
      return req;
    };
  }

  it('names its target from the server\'s own variables: the bind address or the loopback, the port, the metrics token', () => {
    expect(targetOf('healthz', {})).toMatchObject({ host: '127.0.0.1', port: 8787, path: '/healthz' });
    expect(targetOf('readyz', { BIND: '0.0.0.0', PORT: '9000' })).toMatchObject({ host: '127.0.0.1', port: 9000, path: '/readyz' });
    expect(targetOf('healthz', { BIND: '10.0.0.5' })).toMatchObject({ host: '10.0.0.5' });
    expect(targetOf('metrics', { METRICS_PORT: '9464', METRICS_TOKEN: 'tok' })).toMatchObject({ port: 9464, path: '/metrics', headers: { Authorization: 'Bearer tok' } });
    expect(targetOf('metrics', { METRICS_PORT: '9464' })).toMatchObject({ problem: 'METRICS_TOKEN is not set' });
    expect(targetOf('healthz', { PORT: 'eighty' })).toMatchObject({ problem: 'PORT is not a port' });
    expect(targetOf('status', {})).toMatchObject({ problem: expect.stringMatching(/unknown probe/) });
  });

  it('exit 0 on a 200 (the body with --print), 1 on another status, 2 for a command line it cannot use; the metrics token is never printed', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const seen: unknown[] = [];
    expect(await probeMain(['healthz', '--print'], {}, { out: (t: string) => out.push(t), err: (t: string) => err.push(t), get: fakeGet(200, '{"ok":true}', seen) })).toBe(0);
    expect(out).toEqual(['{"ok":true}']);
    expect(await probeMain(['readyz'], {}, { out: () => undefined, err: (t: string) => err.push(t), get: fakeGet(503, '{"ok":false,"reasons":["draining"]}') })).toBe(1);
    expect(err.at(-1)).toMatch(/readyz: HTTP 503 .*draining/);
    const token = 'ef'.repeat(32);
    expect(await probeMain(['metrics'], { METRICS_PORT: '9464', METRICS_TOKEN: token }, { out: () => undefined, err: (t: string) => err.push(t), get: fakeGet(401, '') })).toBe(1);
    expect(err.join('\n')).not.toContain(token);
    expect(await probeMain(['healthz', '--verbose'], {}, { out: () => undefined, err: (t: string) => err.push(t) })).toBe(2);
    expect(await probeMain([], {}, { out: () => undefined, err: (t: string) => err.push(t) })).toBe(2);
  });
});
