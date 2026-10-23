/**
 * RPL-1 (replays design 10, 4, D9): the replay library. Retention keeps the newest replays not marked Keep (a setting of 10, 50 or 200); Keep is
 * never removed, and a replay is saved though removing older ones fails. Export then import gives the same file back, byte for byte after
 * decompressing. Import refuses malformed and oversized files with a message, never by throwing, and lists only the format's named facts of a file.
 * The browser's database (IndexedDB `openmtg-replays`) is the same three calls as the memory one.
 */
import { REPLAY_LIMITS, gunzipBytes, isGzip, type ReplayFile } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { IndexedDbReplayDb, MemoryReplayDb } from '../../src/replays/db';
import { ReplayLibrary, encodeReplay, exportFileName, replayStatus, retentionLimit, setRetentionLimit, summaryOf } from '../../src/replays/library';
import { GameRecorder } from '../../src/replays/recorder';
import { fakeIndexedDB } from '../fake-indexeddb';
import { FlakyReplayDb, duel, playUntil, testClock, testEnv } from './helpers';

/** A local storage in memory; `failing`: every call throws, as in a browser that blocks storage. */
function memoryStorage(failing = false): Storage {
  const data = new Map<string, string>();
  const guard = () => {
    if (failing) throw new Error('storage blocked');
  };
  return {
    get length() {
      guard();
      return data.size;
    },
    clear: () => (guard(), data.clear()),
    getItem: (k) => (guard(), data.get(k) ?? null),
    key: (i) => (guard(), [...data.keys()][i] ?? null),
    removeItem: (k) => (guard(), void data.delete(k)),
    setItem: (k, v) => (guard(), void data.set(k, String(v))),
  };
}

/** One real game replay (a short hot-seat game, left after 16 actions), to copy with other ids and facts. */
async function sampleFile(): Promise<ReplayFile> {
  const env = testEnv();
  const conn = new LocalConnection(duel('rpl1-library'));
  const rec = GameRecorder.start(conn, { format: 'standard' }, env);
  await playUntil(conn, () => conn.session.actions.length >= 16);
  const entry = await rec.finish();
  const read = await env.library.read(entry!.key);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

const copyOf = (f: ReplayFile, n: number, createdAt = new Date(Date.UTC(2026, 9, 1 + n)).toISOString()): ReplayFile => ({
  ...f,
  id: `r-copy-${n}`,
  title: `Game ${n}`,
  createdAt,
  game: { ...f.game, startedAt: createdAt, endedAt: createdAt },
});

const text = async (bytes: Uint8Array): Promise<string> => {
  expect(isGzip(bytes)).toBe(true);
  const out = await gunzipBytes(bytes, REPLAY_LIMITS.maxTextBytes);
  if (!out.ok) throw new Error(out.error.message);
  return new TextDecoder().decode(out.value);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RPL-1: retention keeps the newest replays not marked Keep (design 10, adopted answer 4)', () => {
  it('of the replays not marked Keep only the newest `limit` stay as replays are added; a kept one is never removed', async () => {
    const base = await sampleFile();
    const clock = testClock();
    let limit = 3;
    const lib = new ReplayLibrary(new MemoryReplayDb(), { now: clock.now, limit: () => limit, persist: () => {} });
    for (let i = 1; i <= 3; i++) {
      clock.advance(1000);
      await lib.add(copyOf(base, i));
    }
    await lib.setKeep('r-copy-1', true);
    for (let i = 4; i <= 6; i++) {
      clock.advance(1000);
      await lib.add(copyOf(base, i));
    }
    const ids = (await lib.list()).map((e) => e.key).sort();
    // r-copy-1 is kept; of the others the newest three (4, 5, 6) stay
    expect(ids).toEqual(['r-copy-1', 'r-copy-4', 'r-copy-5', 'r-copy-6']);
    expect(await lib.bytes('r-copy-2')).toBeUndefined();
    // a smaller setting applies at the next save (or when retention runs)
    limit = 1;
    expect((await lib.retain()).sort()).toEqual(['r-copy-4', 'r-copy-5']);
    expect((await lib.list()).map((e) => e.key).sort()).toEqual(['r-copy-1', 'r-copy-6']);
    // unkeeping makes a replay count again
    await lib.setKeep('r-copy-1', false);
    expect(await lib.retain()).toEqual(['r-copy-1']);
  });

  it('a replay is kept by when it came into the library: an imported old game is not removed at once', async () => {
    const base = await sampleFile();
    const clock = testClock();
    const lib = new ReplayLibrary(new MemoryReplayDb(), { now: clock.now, limit: () => 2, persist: () => {} });
    await lib.add(copyOf(base, 5));
    clock.advance(10);
    await lib.add(copyOf(base, 6));
    clock.advance(10);
    const old = copyOf(base, 1, '2020-01-01T00:00:00.000Z');
    const r = await lib.importBytes(await encodeReplay(old));
    expect(r.ok).toBe(true);
    expect((await lib.list()).map((e) => e.key)).toEqual(['r-copy-6', 'r-copy-1']);
  });

  it('the setting is 10, 50 or 200, 50 by default, kept in local storage', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(retentionLimit()).toBe(50);
    setRetentionLimit(10);
    expect(retentionLimit()).toBe(10);
    localStorage.setItem('openmtg.replays.retention', '7');
    expect(retentionLimit()).toBe(50);
    vi.stubGlobal('localStorage', memoryStorage(true));
    expect(retentionLimit()).toBe(50);
    expect(() => setRetentionLimit(200)).not.toThrow();
  });

  it('a replay is saved though removing older ones fails: the add and an import report it saved, and retention catches up later', async () => {
    const base = await sampleFile();
    const clock = testClock();
    const db = new FlakyReplayDb();
    const lib = new ReplayLibrary(db, { now: clock.now, limit: () => 1, persist: () => {} });
    await lib.add(copyOf(base, 1));
    db.fails = (ops) => ops.some((op) => 'delete' in op && op.store === 'library');
    clock.advance(1000);
    expect((await lib.add(copyOf(base, 2))).key).toBe('r-copy-2');
    clock.advance(1000);
    const imported = await lib.importBytes(await encodeReplay(copyOf(base, 3)));
    expect(imported.ok).toBe(true);
    expect((await lib.list()).map((e) => e.key).sort()).toEqual(['r-copy-1', 'r-copy-2', 'r-copy-3']);
    db.fails = null;
    expect((await lib.retain()).sort()).toEqual(['r-copy-1', 'r-copy-2']);
  });

  it('asks the browser once for persistent storage when a replay is saved (design 10, risk 5)', async () => {
    const base = await sampleFile();
    const persist = vi.fn();
    const lib = new ReplayLibrary(new MemoryReplayDb(), { persist });
    await lib.add(copyOf(base, 1));
    expect(persist).toHaveBeenCalled();
  });
});

describe('RPL-1: export and import (design 4, D9: gzipped JSON, .openmtg-replay)', () => {
  it('export then import round-trips byte for byte after decompressing', async () => {
    const file = await sampleFile();
    const a = new ReplayLibrary(new MemoryReplayDb(), { persist: () => {} });
    await a.add(file);
    const exported = (await a.bytes(file.id))!;
    const b = new ReplayLibrary(new MemoryReplayDb(), { persist: () => {} });
    const r = await b.importFile(new File([exported as BlobPart], 'Alice vs Bob.openmtg-replay', { type: 'application/gzip' }));
    expect(r.ok).toBe(true);
    const again = (await b.bytes(file.id))!;
    expect(await text(again)).toBe(await text(exported));
    expect(JSON.parse(await text(again))).toEqual(JSON.parse(JSON.stringify(file)));
    expect((await b.list())[0]!.summary).toEqual((await a.list())[0]!.summary);
    // a renamed replay exports its new title, the rest unchanged
    await b.rename(file.id, 'Our best game\u0007');
    const renamed = JSON.parse(await text((await b.bytes(file.id))!)) as ReplayFile;
    expect(renamed.title).toBe('Our best game');
    expect({ ...renamed, title: file.title }).toEqual(JSON.parse(JSON.stringify(file)));
    expect(exportFileName('Alice vs Bob: game 1/2')).toBe('Alice vs Bob game 1 2.openmtg-replay');
  });

  it('the summary row holds the format\'s named facts only: fields an imported file adds are kept in its file, never in the list', async () => {
    const file = await sampleFile();
    const junk = 'x'.repeat(500_000);
    const finished = { ...file, game: { ...file.game, ended: 'finished' as const, result: { winner: 'p1', reason: 'Bob has 0 or less life (CR 704.5a)' } } };
    // a long field the format does not know, at every level the summary reads
    const withJunk = <T extends object>(o: T): T => ({ ...o, junk });
    const odd = {
      ...withJunk(finished),
      app: withJunk(finished.app),
      engine: withJunk(finished.engine),
      reveal: withJunk(finished.reveal),
      game: withJunk({ ...finished.game, players: finished.game.players.map((p, i) => (i === 0 ? withJunk(p) : p)), result: withJunk(finished.game.result) }),
    };
    const bytes = await encodeReplay(odd);
    const lib = new ReplayLibrary(new MemoryReplayDb(), { persist: () => {} });
    const r = await lib.importBytes(bytes);
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    const [entry] = await lib.list();
    expect(entry!.summary).toEqual(summaryOf(finished));
    expect(JSON.stringify(entry!.summary).length).toBeLessThan(2000);
    // the file itself is kept as it was given
    expect(Array.from((await lib.bytes(file.id))!)).toEqual(Array.from(bytes));
  });

  it('a replay already in the library is not imported twice', async () => {
    const file = await sampleFile();
    const lib = new ReplayLibrary(new MemoryReplayDb(), { persist: () => {} });
    await lib.add(file);
    const r = await lib.importBytes((await lib.bytes(file.id))!, '“again.openmtg-replay”');
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/already in your replays/) });
    expect(await lib.list()).toHaveLength(1);
  });

  it('refuses malformed files with a message, never by throwing', async () => {
    const file = await sampleFile();
    const lib = new ReplayLibrary(new MemoryReplayDb(), { persist: () => {} });
    const enc = (s: string) => new TextEncoder().encode(s);
    const damaged = await encodeReplay(file);
    damaged[damaged.length - 12] = damaged[damaged.length - 12]! ^ 0xff;
    const badShape = { ...JSON.parse(JSON.stringify(file)), game: { ...file.game, players: [] } };
    const newer = { ...JSON.parse(JSON.stringify(file)), formatVersion: 99 };
    const cases: [string, Uint8Array, RegExp][] = [
      ['not JSON', enc('hello, this is no replay'), /not JSON/],
      ['JSON of something else', enc('{"deck":["Forest"]}'), /not an OpenMTG replay/],
      ['damaged gzip', damaged, /damaged/],
      ['a malformed replay', enc(JSON.stringify(badShape)), /game\.players: has no players/],
      ['a replay of a newer format', enc(JSON.stringify(newer)), /newer OpenMTG/],
      ['too deep', enc('['.repeat(5000) + ']'.repeat(5000)), /nested more than/],
    ];
    for (const [what, bytes, message] of cases) {
      const r = await lib.importFile(new File([bytes as BlobPart], `${what}.openmtg-replay`));
      expect(r.ok, what).toBe(false);
      if (!r.ok) expect(r.message, what).toMatch(message);
      if (!r.ok) expect(r.message, what).toContain(`“${what}.openmtg-replay” was not imported`);
    }
    expect(await lib.list()).toEqual([]);
  });

  it('refuses an oversized file before reading it (8 MB, design 4)', async () => {
    const lib = new ReplayLibrary(new MemoryReplayDb(), { persist: () => {} });
    const read = vi.fn();
    const huge = { name: 'huge.openmtg-replay', size: REPLAY_LIMITS.maxFileBytes + 1, arrayBuffer: read } as unknown as File;
    const r = await lib.importFile(huge);
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/“huge\.openmtg-replay” was not imported: at 8\.0 MB it is larger than a replay can be \(at most 8\.0 MB\)/) });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('RPL-1: what a replay can be watched as (design 5, 10)', () => {
  it('Exact under the same build, Checked when watched under another, Recording only or Needs a newer OpenMTG otherwise', async () => {
    const file = await sampleFile();
    const lib = new ReplayLibrary(new MemoryReplayDb(), { persist: () => {} });
    const s = (await lib.add(file)).summary;
    expect(replayStatus(s, 'test-engine-build')).toBe('exact');
    expect(replayStatus(s, 'other')).toBe('checked');
    expect(replayStatus(s, null)).toBe('checked');
    expect(replayStatus({ ...s, kind: 'recording' }, null)).toBe('recordingOnly');
    expect(replayStatus({ ...s, engine: { ...s.engine, model: s.engine.model + 1 } }, null)).toBe('needsNewer');
    expect(replayStatus({ ...s, engine: { ...s.engine, model: s.engine.model + 1 }, hasRecording: true }, null)).toBe('recordingOnly');
    expect(replayStatus({ ...s, formatVersion: 2 }, null)).toBe('needsNewer');
  });
});

describe('RPL-1: the browser database (IndexedDB openmtg-replays: inProgress, library, files)', () => {
  it('writes a batch in one transaction and reads rows back by key and by store', async () => {
    const idb = fakeIndexedDB();
    const db = new IndexedDbReplayDb(idb.factory);
    await db.write([
      { store: 'library', put: { key: 'r-1', n: 1 } as never },
      { store: 'files', put: { key: 'r-1', data: new Uint8Array([1, 2]) } as never },
      { store: 'inProgress', put: { key: 'r-2', type: 'head' } as never },
    ]);
    expect(await db.get('library', 'r-1')).toEqual({ key: 'r-1', n: 1 });
    expect((await db.getAll('inProgress')).map((r) => r.key)).toEqual(['r-2']);
    await db.write([{ store: 'library', delete: 'r-1' }]);
    expect(await db.get('library', 'r-1')).toBeUndefined();
    expect(idb.rows('openmtg-replays', 'files')).toHaveLength(1);
  });

  it('a write that does not commit (a full disk) is an error in plain words', async () => {
    const idb = fakeIndexedDB();
    const db = new IndexedDbReplayDb(idb.factory);
    await db.write([{ store: 'library', put: { key: 'r-1' } }]);
    idb.failNextWrite();
    await expect(db.write([{ store: 'library', put: { key: 'r-2' } }])).rejects.toThrow(/no room left to save replays/);
  });

  it('the library runs on it as on memory', async () => {
    const idb = fakeIndexedDB();
    const lib = new ReplayLibrary(new IndexedDbReplayDb(idb.factory), { persist: () => {} });
    expect(lib.persistent).toBe(true);
    const file = await sampleFile();
    await lib.add(file);
    const read = await lib.read(file.id);
    expect(read.ok && read.value).toEqual(JSON.parse(JSON.stringify(file)));
    expect((await lib.list()).map((e) => e.key)).toEqual([file.id]);
  });
});
