/**
 * PostgreSQL specifics (M13-4, design 8.2, 2.3, review 2) on PGlite in process: migrations, the schema's indexes and CHECKs, the database's own
 * refusal isolated by the per-game savepoint, a failed transaction failing the whole batch, and the version check at open.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, pgliteClient, PostgresStore, SCHEMA_VERSION, schemaVersion, StoreError, type SqlClient } from '../../src/store';
import { record, running, T0 } from './fixtures';

let db: PGlite;
let sql: SqlClient;

beforeEach(async () => {
  db = await PGlite.create();
  sql = pgliteClient(db);
});
afterEach(async () => {
  await sql.close();
});

describe('M13-4 postgres: migrations', () => {
  it('versioned SQL files, applied once each, recorded in schema_migrations; the store refuses another schema version', async () => {
    const list = await loadMigrations();
    expect(list.map((m) => [m.version, m.name])).toEqual([[1, 'initial']]);
    expect(SCHEMA_VERSION).toBe(list[list.length - 1]!.version);
    expect(await schemaVersion(sql)).toBe(0);
    await expect(PostgresStore.open(sql)).rejects.toMatchObject({ code: 'status' });
    expect(await migrate(sql)).toEqual([1]);
    expect(await migrate(sql)).toEqual([]);
    expect(await schemaVersion(sql)).toBe(1);
    const rows = (await sql.query<{ version: number; name: string }>('SELECT version, name FROM schema_migrations')).rows;
    expect(rows).toEqual([{ version: 1, name: 'initial' }]);
    await sql.query(`INSERT INTO schema_migrations (version, name) VALUES (2, 'future')`);
    await expect(PostgresStore.open(sql)).rejects.toMatchObject({ code: 'status' });
  });

  it('the schema: indexes for recovery and retention, no address column anywhere, attachments as text, the log as exact json', async () => {
    await migrate(sql);
    const idx = (await sql.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`)).rows.map((r) => r.indexname);
    for (const name of ['actions_pkey', 'snapshots_pkey', 'games_running', 'games_waiting', 'games_unstarted', 'games_ended', 'sessions_last_seen',
      'sessions_token_hash_key', 'results_ended', 'placements_session', 'bug_reports_created']) expect(idx, name).toContain(name);
    const cols = (await sql.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()`,
    )).rows;
    expect(cols.filter((c) => /addr|(^|_)ip($|_)|email/i.test(c.column_name))).toEqual([]);
    const type = (t: string, c: string) => cols.find((x) => x.table_name === t && x.column_name === c)?.data_type;
    expect(type('bug_reports', 'attachments')).toBe('text');
    expect(type('actions', 'action')).toBe('json');
    expect(type('games', 'config')).toBe('json');
    expect(type('games', 'seed')).toBe('text');
    expect(cols.filter((c) => c.table_name === 'sessions').map((c) => c.column_name).sort()).toEqual(['created_at', 'id', 'last_seen', 'name', 'token_hash']);
  });
});

describe('M13-4 postgres: group commit', () => {
  it('the refusal is the database\'s own (jsonb CHECK), and the savepoint keeps it to its game', async () => {
    await migrate(sql);
    const store = await PostgresStore.open(sql);
    await running(store, 'a', 0);
    await running(store, 'b', 0);
    const bad = { ...record('b', 1), action: { type: 'answer', answer: { kind: 'chooseName', name: 'x\u0000' }, player: 'p1' } as never };
    const res = await store.appendRecords([record('a', 1), bad]);
    expect(res.committed).toEqual(['a']);
    expect(res.failed[0]!.error).toMatch(/unicode|escape|json/i);
    // the raw column refuses it too, whoever writes it
    await expect(sql.query(`INSERT INTO actions (game_id, seq, seat, action, clocks, elapsed_ms, at) VALUES ('b', 1, 1, $1::json, '[]', 0, now())`, ['{"s":"\\u0000"}'])).rejects.toThrow();
    // other database refusals isolate the same way: a time that is not a time, an unknown cause
    const res2 = await store.appendRecords([record('a', 2), { ...record('b', 1), at: 'not a time' }, record('a', 3)]);
    expect(res2).toMatchObject({ committed: ['a'], failed: [{ game: 'b' }] });
    const res3 = await store.appendRecords([{ ...record('b', 1), cause: 'cosmic' as never }, record('a', 4)]);
    expect(res3).toMatchObject({ committed: ['a'], failed: [{ game: 'b' }] });
    expect((await store.loadForRecovery('a')).lastSeq).toBe(4);
    expect((await store.loadForRecovery('b')).lastSeq).toBe(0);
    expect((await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM actions WHERE game_id = 'b'`)).rows[0]!.n).toBe(0);
  });

  it('a transaction that fails as a whole (the connection, the COMMIT) fails every game of the batch; nothing commits', async () => {
    await migrate(sql);
    let failCommit = false;
    const flaky: SqlClient = {
      ...sql,
      transaction: (fn) =>
        sql.transaction(async (tx) => {
          const out = await fn(tx);
          if (failCommit) throw new Error('connection lost at COMMIT');
          return out;
        }),
      close: async () => {},
    };
    const store = await PostgresStore.open(flaky);
    await running(store, 'a', 0);
    await running(store, 'b', 0);
    failCommit = true;
    const res = await store.appendRecords([record('a', 1), record('b', 1)]);
    expect(res.committed).toEqual([]);
    expect(res.failed.map((f) => [f.game, f.error])).toEqual([['a', 'connection lost at COMMIT'], ['b', 'connection lost at COMMIT']]);
    failCommit = false;
    expect((await store.loadForRecovery('a')).lastSeq).toBe(0);
    expect(await store.appendRecords([record('a', 1), record('b', 1)])).toEqual({ committed: ['a', 'b'], failed: [] });
  });

  it('a finished game\'s final record, result and status are one transaction: a refused result leaves the game running without the record', async () => {
    await migrate(sql);
    const store = await PostgresStore.open(sql);
    await running(store, 'g1', 1);
    const { gameRecord } = await import('./fixtures');
    const rec = gameRecord('g1', new Date(T0.getTime() + 1000));
    // a placement the schema refuses (place 9) fails the whole finishing transaction
    await expect(store.finishGame('g1', { ...rec, placements: [{ ...rec.placements[0]!, place: 9 as never }] }, record('g1', 2))).rejects.toThrow();
    const r = await store.loadForRecovery('g1');
    expect(r).toMatchObject({ status: 'running', lastSeq: 1 });
    expect(await store.results(T0, 10)).toEqual([]);
    await store.finishGame('g1', rec, record('g1', 2));
    expect((await store.loadForRecovery('g1')).lastSeq).toBe(2);
  });

  it('a closed store refuses work with StoreError closed', async () => {
    await migrate(sql);
    const store = await PostgresStore.open({ ...sql, close: async () => {} });
    await store.close();
    await expect(store.runningGames()).rejects.toBeInstanceOf(StoreError);
  });
});
