/**
 * The M13-4 review's findings (Opus review of b4146018), each pinned in process: short writes in the file store, retried finishes in the indexed
 * stores, PostgreSQL's ambiguous COMMIT, and the migration's encoding check.
 */
import { mkdtemp, open, rm, stat, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore, MemoryStore, migrate, pgliteClient, PostgresStore, StoreError, type SqlClient } from '../../src/store';
import { gameRecord, record, records, running, T0 } from './fixtures';

type WriteFn = (this: FileHandle, buf: Uint8Array, offset?: number, length?: number, position?: number | null) => Promise<{ bytesWritten: number; buffer: Uint8Array }>;

/** Runs `fn` with FileHandle.write replaced (every file handle of the process; restored afterwards). */
async function withWrite<T>(make: (orig: WriteFn) => WriteFn, fn: () => Promise<T>): Promise<T> {
  const probe = await open(join(tmpdir(), `openmtg-m13-4-probe-${process.pid}`), 'w');
  const proto = Object.getPrototypeOf(probe) as { write: WriteFn };
  await probe.close();
  await rm(join(tmpdir(), `openmtg-m13-4-probe-${process.pid}`), { force: true });
  const orig = proto.write;
  proto.write = make(orig);
  try {
    return await fn();
  } finally {
    proto.write = orig;
  }
}

describe('M13-4 review MAJOR: the file store never acknowledges a short write', { timeout: 30_000 }, () => {
  let dir: string;
  let store: FileStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'openmtg-m13-4-short-'));
    store = await FileStore.open(dir);
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('writes that take only part of the buffer each time: the append goes on until every byte is written', async () => {
    await running(store, 'g3', 3);
    const half: (orig: WriteFn) => WriteFn = (orig) =>
      function (buf, offset = 0, length = buf.byteLength - offset, position) {
        return orig.call(this, buf, offset, Math.max(1, Math.floor(length / 2)), position);
      };
    expect(await withWrite(half, () => store.appendRecords(records('g3', 4, 5)))).toEqual({ committed: ['g3'], failed: [] });
    expect((await store.loadForRecovery('g3')).records).toEqual(records('g3', 1, 5));
    await store.close();
    store = await FileStore.open(dir);
    expect((await store.loadForRecovery('g3')).records).toEqual(records('g3', 1, 5));
  });

  it('a write that stops short (disk full): the append fails, the partial bytes are cut off, the game goes on after it', async () => {
    await running(store, 'g3', 3);
    await running(store, 'ok', 1);
    const size = (await stat(store.logPath('g3'))).size;
    let calls = 0;
    const full: (orig: WriteFn) => WriteFn = (orig) =>
      function (buf, offset = 0, length = buf.byteLength - offset, position) {
        // the first write of the batch takes half, the next finds the disk full
        if (calls++ === 0) return orig.call(this, buf, offset, Math.max(1, Math.floor(length / 2)), position);
        return Promise.reject(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }));
      };
    const res = await withWrite(full, () => store.appendRecords([record('g3', 4), record('g3', 5)]));
    expect(res.committed).toEqual([]);
    expect(res.failed.map((f) => f.game)).toEqual(['g3']);
    expect((await stat(store.logPath('g3'))).size).toBe(size);
    expect((await store.loadForRecovery('g3')).lastSeq).toBe(3);
    expect(await store.appendRecords([record('g3', 4), record('ok', 2)])).toEqual({ committed: ['g3', 'ok'], failed: [] });
    await store.close();
    store = await FileStore.open(dir);
    expect((await store.loadForRecovery('g3')).records).toEqual(records('g3', 1, 4));
  });

  it('a write that makes no progress at all is a failure, not an endless loop', async () => {
    await running(store, 'g3', 1);
    const none: (orig: WriteFn) => WriteFn = () => async (buf) => ({ bytesWritten: 0, buffer: buf });
    const res = await withWrite(none, () => store.appendRecords([record('g3', 2)]));
    expect(res.failed.map((f) => f.game)).toEqual(['g3']);
    expect((await store.loadForRecovery('g3')).lastSeq).toBe(1);
  });
});

describe('M13-4 review minor 1: a finish interrupted after its result is retryable, and the ledger decides the status', { timeout: 30_000 }, () => {
  let failOp: string | null = null;
  const make = () => new MemoryStore({ fault: (op) => { if (op === failOp) throw new Error(`disk failed at ${op}`); } });
  afterEach(() => {
    failOp = null;
  });

  it('finishGame retried with the same final record and result completes (the record is not appended twice)', async () => {
    const s = make();
    await running(s, 'g1', 2);
    const rec = gameRecord('g1', new Date(T0.getTime() + 5000));
    failOp = 'putGame'; // the record and the result are written, the status is not
    await expect(s.finishGame('g1', rec, record('g1', 3))).rejects.toThrow(/putGame/);
    failOp = null;
    await s.finishGame('g1', rec, record('g1', 3));
    const r = await s.loadForRecovery('g1');
    expect(r).toMatchObject({ status: 'finished', lastSeq: 3 });
    expect(r.records.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(await s.results(T0, 10)).toHaveLength(1);
  });

  it('a different result on retry is refused (append-only), but the status still follows the stored result', async () => {
    const s = make();
    await running(s, 'g1', 1);
    failOp = 'putGame';
    await expect(s.finishGame('g1', gameRecord('g1', new Date(T0.getTime() + 5000)))).rejects.toThrow();
    failOp = null;
    const err = await s.finishGame('g1', gameRecord('g1', new Date(T0.getTime() + 9000), { reason: 'other' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe('exists');
    expect((await s.loadForRecovery('g1')).status).toBe('finished');
  });

  it('a voidGame after an interrupted finish does not mark void a game whose ledger row is a win', async () => {
    const s = make();
    await running(s, 'g1', 1);
    failOp = 'putGame';
    await expect(s.finishGame('g1', gameRecord('g1', new Date(T0.getTime() + 5000)))).rejects.toThrow();
    failOp = null;
    await s.voidGame('g1', 'commit');
    expect((await s.loadForRecovery('g1')).status).toBe('finished');
    expect((await s.results(T0, 10)).map((r) => [r.outcome, r.reason])).toEqual([['win', 'life']]);
  });
});

describe('M13-4 review minor 2 and 6: PostgreSQL', { timeout: 30_000 }, () => {
  let db: PGlite;
  let sql: SqlClient;
  beforeEach(async () => {
    db = await PGlite.create();
    sql = pgliteClient(db);
  });
  afterEach(async () => {
    await sql.close();
  });

  it('an ambiguous COMMIT (it committed, the connection then failed): the retried batch is reported committed, its rows stored once', async () => {
    await migrate(sql);
    let lose = false;
    const flaky: SqlClient = {
      ...sql,
      transaction: async (fn) => {
        const out = await sql.transaction(fn);
        if (lose) throw new Error('connection lost after COMMIT');
        return out;
      },
      close: async () => {},
    };
    const store = await PostgresStore.open(flaky);
    await running(store, 'a', 0);
    await running(store, 'b', 0);
    lose = true;
    const first = await store.appendRecords([record('a', 1), record('a', 2), record('b', 1)]);
    expect(first.committed).toEqual([]);
    lose = false;
    expect(await store.appendRecords([record('a', 1), record('a', 2), record('b', 1)])).toEqual({ committed: ['a', 'b'], failed: [] });
    expect((await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM actions')).rows[0]!.n).toBe(3);
    // a batch that differs from what is stored is no retry: it fails
    expect((await store.appendRecords([record('a', 2, { seat: 7 })])).failed.map((f) => f.game)).toEqual(['a']);
  });

  it('migrate refuses a database whose server encoding is not UTF8 (text rules assume UTF-8)', async () => {
    const latin: SqlClient = {
      ...sql,
      query: (async (text: string, params?: readonly unknown[]) =>
        /server_encoding/i.test(text) ? { rows: [{ server_encoding: 'LATIN1' }], rowCount: 0 } : sql.query(text, params)) as SqlClient['query'],
    };
    await expect(migrate(latin)).rejects.toThrow(/UTF8/);
    expect(await migrate(sql)).toEqual([1]);
  });
});
