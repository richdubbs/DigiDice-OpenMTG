/**
 * The file store's crash safety (M13-4, design 8.1): torn last writes simulated in process (bytes appended to a log as a crash mid-write would leave
 * them), corruption refused, a failing file failing only its game, an interrupted finish rolled forward, leftovers of interrupted writes cleaned up.
 */
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore, scanLog, StoreError } from '../../src/store';
import { gameRecord, newGame, record, records, running, snapshot, startRow, T0 } from './fixtures';

let dir: string;
let store: FileStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openmtg-m13-4-file-'));
  store = await FileStore.open(dir);
});
afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function reopen(): Promise<FileStore> {
  await store.close();
  store = await FileStore.open(dir);
  return store;
}

describe('M13-4 file store: torn writes', { timeout: 30_000 }, () => {
  it('a partial last line (a crash mid-append) is cut off at open; the log goes on cleanly from the last whole record', async () => {
    await running(store, 'g1', 3);
    const path = store.logPath('g1');
    const whole = (await stat(path)).size;
    const next = JSON.stringify(record('g1', 4));
    await appendFile(path, next.slice(0, Math.floor(next.length / 2))); // torn: half a line, no newline
    await reopen();
    expect((await stat(path)).size).toBe(whole);
    const r = await store.loadForRecovery('g1');
    expect(r.lastSeq).toBe(3);
    expect(r.records).toEqual(records('g1', 1, 3));
    expect(await store.appendRecords([record('g1', 4)])).toEqual({ committed: ['g1'], failed: [] });
    await reopen();
    expect((await store.loadForRecovery('g1')).records).toEqual(records('g1', 1, 4));
    expect((await readFile(path, 'utf8')).split('\n')).toHaveLength(5); // four lines and the final newline
  });

  it('a whole record without its newline was never acknowledged: dropped; trailing garbage (zeros, half a batch) too', async () => {
    await running(store, 'g1', 2);
    await running(store, 'g2', 2);
    await running(store, 'g3', 2);
    await appendFile(store.logPath('g1'), JSON.stringify(record('g1', 3)));
    await appendFile(store.logPath('g2'), Buffer.alloc(64)); // a size extended but never written: zeros
    await appendFile(store.logPath('g3'), `${JSON.stringify(record('g3', 3))}\n${JSON.stringify(record('g3', 4)).slice(0, 10)}`); // half a batch
    await reopen();
    expect((await store.loadForRecovery('g1')).lastSeq).toBe(2);
    expect((await store.loadForRecovery('g2')).lastSeq).toBe(2);
    // the first record of the torn batch is whole (with its newline): it counts (never acknowledged, but a legitimately applied action)
    expect((await store.loadForRecovery('g3')).lastSeq).toBe(3);
    expect((await store.appendRecords([record('g1', 3), record('g2', 3), record('g3', 4)])).committed).toEqual(['g1', 'g2', 'g3']);
  });

  it('a bad line with good records after it is corruption, not a torn write: the store refuses to open', async () => {
    await running(store, 'g1', 1);
    await appendFile(store.logPath('g1'), `{not json\n${JSON.stringify(record('g1', 2))}\n`);
    await store.close();
    await expect(FileStore.open(dir)).rejects.toBeInstanceOf(StoreError);
    store = await FileStore.open(join(dir, 'elsewhere')); // for afterEach
  });

  it('scanLog: lines count only with their newline and only in seq order', () => {
    const l = (n: number) => JSON.stringify(record('g', n));
    expect(scanLog(Buffer.from(''), 'f')).toEqual({ lines: [], bytes: 0, lastSeq: 0, cut: false });
    expect(scanLog(Buffer.from(`${l(1)}\n${l(2)}\n`), 'f')).toMatchObject({ lastSeq: 2, cut: false });
    expect(scanLog(Buffer.from(`${l(1)}\n${l(2)}`), 'f')).toMatchObject({ lastSeq: 1, cut: true, bytes: l(1).length + 1 });
    expect(scanLog(Buffer.from(`${l(1)}\n${l(3)}\n`), 'f')).toMatchObject({ lastSeq: 1, cut: true }); // a gap at the end: cut
    expect(() => scanLog(Buffer.from(`${l(1)}\n${l(1)}\n${l(2)}\n`), 'f')).toThrow(StoreError); // a repeat in the middle: corrupt
  });
});

describe('M13-4 file store: per-game failure, interrupted operations', { timeout: 30_000 }, () => {
  it('a game whose log cannot be written fails alone; the batch commits for the others', async () => {
    await running(store, 'a', 1);
    await running(store, 'b', 1);
    // make b's log unwritable in process: its path becomes a directory
    await rm(store.logPath('b'));
    await mkdir(store.logPath('b'));
    const res = await store.appendRecords([record('a', 2), record('b', 2), record('a', 3)]);
    expect(res.committed).toEqual(['a']);
    expect(res.failed.map((f) => f.game)).toEqual(['b']);
    expect((await store.loadForRecovery('a')).lastSeq).toBe(3);
  });

  it('a result beside a game still marked running (finishGame interrupted after the result) is rolled forward at open', async () => {
    await running(store, 'g1', 2);
    await store.putSnapshot(snapshot('g1', 2));
    const meta = await readFile(join(dir, 'games', 'g1', 'game.json'), 'utf8');
    await store.finishGame('g1', gameRecord('g1', new Date(T0.getTime() + 5000)));
    await store.close();
    // as if the crash came after the result and before the status and the snapshot deletion
    await writeFile(join(dir, 'games', 'g1', 'game.json'), meta);
    await mkdir(join(dir, 'games', 'g1', 'snapshots'), { recursive: true });
    await writeFile(join(dir, 'games', 'g1', 'snapshots', '2.json'), '{}');
    store = await FileStore.open(dir);
    const r = await store.loadForRecovery('g1');
    expect(r.status).toBe('finished');
    expect(r.snapshot).toBeNull();
    expect(await store.runningGames()).toEqual([]);
  });

  it('leftovers of interrupted atomic writes are deleted; a game directory without its row (createGame interrupted) is dropped', async () => {
    await running(store, 'g1', 1);
    await store.close();
    await writeFile(join(dir, 'sessions', 's1.json.tmp-abc123'), '{"half":');
    await writeFile(join(dir, 'games', 'g1', 'game.json.tmp-abc123'), '{"half":');
    await mkdir(join(dir, 'games', 'half'), { recursive: true });
    store = await FileStore.open(dir);
    expect(await readdir(join(dir, 'sessions'))).toEqual([]);
    expect((await readdir(join(dir, 'games', 'g1'))).some((n) => n.includes('.tmp-'))).toBe(false);
    expect(await readdir(join(dir, 'games'))).toEqual(['g1']);
    await store.createGame(newGame('half'));
    await store.startGame('half', startRow());
  });

  it('refuses a directory of another format', async () => {
    const other = await mkdtemp(join(tmpdir(), 'openmtg-m13-4-other-'));
    await writeFile(join(other, 'store.json'), JSON.stringify({ format: 'something-else', version: 9 }));
    await expect(FileStore.open(other)).rejects.toBeInstanceOf(StoreError);
    await rm(other, { recursive: true, force: true });
  });
});
