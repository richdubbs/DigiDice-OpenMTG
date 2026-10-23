/**
 * M15-3: the file store's own cases (design 13.3, D20, 17.10): reopen and replay, a torn journal line, corruption refused, a crash after the snapshot
 * and before the journal rewrite applying no line twice (a replayed resetRating does not undo later games, the cursor does not move back), the
 * snapshot right after forgetAccount (a byte search of the directory finds no trace of the id), the lock (a second opener refused, a stale lock
 * taken over), and the files' modes. The contract suite runs on it in store.test.ts.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LADDER_FILE_STORE_FILES, LADDER_STORE_IN_USE, LadderStoreError, openFileLadderStore } from '../../src/service/create';
import { acc, ended, establish, gid, harness, HOUR, MINUTE } from './fixtures';
import { placesInDir, placesInDump } from './support';

const root = mkdtempSync(join(tmpdir(), 'openmtg-m15-3-file-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(root, `d${++n}`);
const journal = (dir: string) => join(dir, LADDER_FILE_STORE_FILES.journal);
const [A, B, C, D] = [acc(1), acc(2), acc(3), acc(4)];
const T = '2026-10-15T12:00:00.000Z';

describe('M15-3: the file store (13.3)', () => {
  it('a write is on disk before it returns: a reopen replays the journal; a clean close leaves a snapshot and an empty journal', async () => {
    const dir = fresh();
    const s1 = await openFileLadderStore({ dir });
    await s1.setIntakeCursor({ endedAt: T, game: gid(1) });
    await s1.putPenalties({ account: A, misses: [T], cooldownUntil: null });
    expect(readFileSync(journal(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l).seq)).toEqual([1, 2]);
    await s1.close();
    expect(readFileSync(journal(dir), 'utf8')).toBe('');
    const s3 = await openFileLadderStore({ dir });
    expect(await s3.intakeCursor()).toEqual({ endedAt: T, game: gid(1) });
    expect((await s3.penalties(A))?.misses).toEqual([T]);
    await s3.close();
  });

  it('a torn last line is cut at open; a bad line before a good one is corruption and the store refuses to open', async () => {
    const dir = fresh();
    const s = await openFileLadderStore({ dir });
    await s.setIntakeCursor({ endedAt: T, game: gid(1) });
    // a crash before close: copy the journal as it is now, close, then put it back with a torn line after it
    const lines = readFileSync(journal(dir));
    await s.close();
    writeFileSync(join(dir, LADDER_FILE_STORE_FILES.snapshot), JSON.stringify({ format: 'openmtg-ladder-store', version: 1, lastSeq: 0, tables: {} }));
    writeFileSync(journal(dir), Buffer.concat([lines, Buffer.from('{"seq":2,"op":"setIntakeCursor","m":[{"t":"meta","k":"cursor","v":{"endedAt":"2026-10-1')]));
    const s2 = await openFileLadderStore({ dir });
    expect(await s2.intakeCursor()).toEqual({ endedAt: T, game: gid(1) });
    expect(readFileSync(journal(dir), 'utf8')).toBe('');
    await s2.setIntakeCursor({ endedAt: '2026-10-16T12:00:00.000Z', game: gid(2) });
    await s2.close();
    // corruption: a bad line, then a good one
    writeFileSync(join(dir, LADDER_FILE_STORE_FILES.snapshot), JSON.stringify({ format: 'openmtg-ladder-store', version: 1, lastSeq: 0, tables: {} }));
    writeFileSync(journal(dir), 'not json\n' + lines.toString('utf8'));
    await expect(openFileLadderStore({ dir })).rejects.toMatchObject({ code: 'corrupt' });
    // and a gap in the seqs
    writeFileSync(journal(dir), lines.toString('utf8') + lines.toString('utf8').replace('"seq":1', '"seq":3'));
    await expect(openFileLadderStore({ dir })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('a crash after the snapshot and before the journal rewrite applies no line twice: a reset does not undo later games, the cursor does not move back', async () => {
    const dir = fresh();
    let crash = false;
    const store = await openFileLadderStore({
      dir, compactEvery: 1_000_000, afterSnapshot: () => {
        if (crash) throw new Error('power cut');
      },
    });
    const h = await harness({ accounts: [1, 2, 3, 4], store });
    await store.setIntakeCursor({ endedAt: T, game: gid(0) });
    await establish(h, A, { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 });
    await h.svc.resetRating(A, '1v1-standard', 'moderator-7', 'test'); // a resetRating line
    await h.play({ game: gid(1), accounts: [A, B] }); // a later game of A
    await store.setIntakeCursor({ endedAt: '2026-10-15T12:20:00.000Z', game: gid(1) }); // the cursor moves on
    h.clock.advance(HOUR);
    await h.play({ game: gid(2), accounts: [C, D] });
    const want = {
      a: (await store.ratings('1v1-standard', [A])).get(A), d: (await store.ratings('1v1-standard', [D])).get(D), cursor: await store.intakeCursor(),
      history: await store.history({ account: A, limit: 5 }),
    };
    // forgetAccount snapshots at once: the power fails after the new snapshot is in place, before the journal is rewritten
    crash = true;
    await expect(h.svc.forgetAccount(C)).rejects.toThrow(/power cut/);
    await expect(store.intakeCursor()).rejects.toMatchObject({ code: 'closed' });
    const snapshot = JSON.parse(readFileSync(join(dir, LADDER_FILE_STORE_FILES.snapshot), 'utf8')) as { lastSeq: number };
    const lines = readFileSync(journal(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number; op: string });
    expect(lines.at(-1)!.seq).toBe(snapshot.lastSeq); // every line is in the snapshot, and still in the journal
    expect(lines.map((l) => l.op)).toContain('resetRating');
    await store.close();
    const again = await openFileLadderStore({ dir, onWarning: () => undefined });
    expect((await again.ratings('1v1-standard', [A])).get(A)).toEqual(want.a);
    expect((await again.ratings('1v1-standard', [D])).get(D)).toEqual(want.d);
    expect(await again.intakeCursor()).toEqual(want.cursor);
    expect(await again.history({ account: A, limit: 5 })).toEqual(want.history);
    expect(await again.ratings('1v1-standard', [C])).toEqual(new Map());
    expect(placesInDir(dir, C)).toEqual([]); // the open rewrote the journal
    await again.close();
  });

  it('opening applies exactly the journal lines after the snapshot\'s lastSeq, never one at or below it', async () => {
    // journal lines hold row images, so an in-order replay of old lines converges anyway; the seq check is what keeps a line from being applied twice
    const dir = fresh();
    const s = await openFileLadderStore({ dir });
    await s.close();
    const line = (seq: number, game: string) => `${JSON.stringify({ seq, op: 'setIntakeCursor', m: [{ t: 'meta', k: 'cursor', v: { endedAt: T, game } }] })}\n`;
    const snapshot = (lastSeq: number, game: string) =>
      writeFileSync(join(dir, LADDER_FILE_STORE_FILES.snapshot), JSON.stringify({ format: 'openmtg-ladder-store', version: 1, lastSeq, tables: { meta: [['cursor', { endedAt: T, game }]] } }));
    snapshot(2, 'in-the-snapshot');
    writeFileSync(journal(dir), line(1, 'line-1') + line(2, 'line-2'));
    let o = await openFileLadderStore({ dir });
    expect((await o.intakeCursor())?.game).toBe('in-the-snapshot');
    await o.close();
    snapshot(2, 'in-the-snapshot');
    writeFileSync(journal(dir), line(1, 'line-1') + line(2, 'line-2') + line(3, 'line-3'));
    o = await openFileLadderStore({ dir });
    expect((await o.intakeCursor())?.game).toBe('line-3');
    await o.close();
    expect(readFileSync(journal(dir), 'utf8')).toBe('');
    // a line after a gap past the snapshot is corruption
    snapshot(2, 'in-the-snapshot');
    writeFileSync(journal(dir), line(4, 'line-4'));
    await expect(openFileLadderStore({ dir })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('forgetAccount snapshots at once: when it returns, a byte search of the whole directory finds no trace of the id', async () => {
    const dir = fresh();
    const store = await openFileLadderStore({ dir });
    const h = await harness({ accounts: [1, 2, 3, 4], store });
    for (let i = 0; i < 3; i++) {
      await h.play({ game: gid(i + 1), accounts: [A, B] });
      h.clock.advance(HOUR);
    }
    await h.svc.readyCheckMissed('m', [A]);
    const r = ended(await h.start({ game: gid(9), accounts: [A, C] }), {});
    expect(placesInDir(dir, A).length).toBeGreaterThan(0);
    await h.svc.forgetAccount(A);
    expect(placesInDir(dir, A)).toEqual([]);
    expect(placesInDir(dir, B)).not.toEqual([]); // the opponent is untouched
    h.clock.advance(20 * MINUTE);
    expect((await h.svc.intake({ ...r, endedAt: h.clock.iso() })).kind).toBe('applied');
    await store.close();
    expect(placesInDir(dir, A)).toEqual([]);
  });

  it('the lock: a second opener is refused while the first holds it; a lock whose process is gone is taken over with a warning', async () => {
    const dir = fresh();
    const s = await openFileLadderStore({ dir });
    const refused = await openFileLadderStore({ dir }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(LadderStoreError);
    expect((refused as LadderStoreError).code).toBe('locked');
    expect((refused as Error).message).toContain(LADDER_STORE_IN_USE);
    await s.close();
    // a crashed holder: a lock naming a process that does not exist
    writeFileSync(join(dir, LADDER_FILE_STORE_FILES.lock), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: T }));
    const warnings: string[] = [];
    const s2 = await openFileLadderStore({ dir, onWarning: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('taking over');
    await s2.close();
    expect(() => statSync(join(dir, LADDER_FILE_STORE_FILES.lock))).toThrow();
  });

  it('the lock: one left by an earlier process with this process id is stale (a container\'s PID 1 after a crash); two openers in one process get one store (review of M15-3)', async () => {
    const dir = fresh();
    await (await openFileLadderStore({ dir })).close();
    writeFileSync(join(dir, LADDER_FILE_STORE_FILES.lock), JSON.stringify({ pid: process.pid, startedAt: '2026-01-01T00:00:00.000Z' }));
    const warnings: string[] = [];
    const s = await openFileLadderStore({ dir, onWarning: (m) => warnings.push(m) });
    expect(warnings).toEqual([expect.stringContaining('an earlier process with this process id')]);
    await s.close();
    const opens = await Promise.allSettled([0, 1, 2].map(() => openFileLadderStore({ dir })));
    expect(opens.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const refusals = opens.flatMap((o) => (o.status === 'rejected' ? [o.reason as LadderStoreError] : []));
    expect(refusals.map((e) => e.code)).toEqual(['locked', 'locked']);
    for (const o of opens) if (o.status === 'fulfilled') await o.value.close();
    // once closed, this process may open it again
    await (await openFileLadderStore({ dir })).close();
  });

  it('the lock: a live process refuses with the lock file and the way out; on Linux, a live process that started after the lock was taken is stale (review of M15-3)', async () => {
    const dir = fresh();
    await (await openFileLadderStore({ dir })).close();
    const lock = join(dir, LADDER_FILE_STORE_FILES.lock);
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString() }));
    const refused = (await openFileLadderStore({ dir }).catch((e: unknown) => e)) as LadderStoreError;
    expect(refused.code).toBe('locked');
    expect(refused.message).toContain(LADDER_STORE_IN_USE);
    expect(refused.message).toContain(`if no server runs there, delete ${lock}`);
    if (process.platform === 'linux') {
      // the same live process id, but the lock was taken long before that process started: its id was reused
      writeFileSync(lock, JSON.stringify({ pid: process.ppid, startedAt: '1970-01-02T00:00:00.000Z' }));
      const warnings: string[] = [];
      const s = await openFileLadderStore({ dir, onWarning: (m) => warnings.push(m) });
      expect(warnings).toEqual([expect.stringContaining('its id was reused')]);
      await s.close();
    }
  });

  it('a snapshot that fails after a write committed fails nothing: the game is applied, its players told, the store keeps serving (review of M15-3)', async () => {
    const dir = fresh();
    const warnings: string[] = [];
    const store = await openFileLadderStore({ dir, compactEvery: 2, onWarning: (m) => warnings.push(m) });
    const h = await harness({ accounts: [1, 2, 3, 4], store });
    const rec = await h.start({ game: gid(1), accounts: [A, B] });
    // the snapshot cannot be written (a full disk stands for this): snapshot.tmp is a directory
    mkdirSync(join(dir, LADDER_FILE_STORE_FILES.snapshotTmp));
    h.clock.advance(20 * MINUTE);
    const done = ended(rec, { endedAt: h.clock.iso() });
    expect((await h.svc.intake(done)).kind).toBe('applied');
    expect(warnings.some((m) => m.includes('could not write its snapshot'))).toBe(true);
    expect(h.rated.map((r) => r.game)).toEqual([gid(1)]);
    expect(h.abuse.calls.filter((c) => c.kind === 'afterGame').map((c) => c.arg)).toEqual([gid(1)]);
    expect(h.svc.accountBusy(A)).toBe(false);
    // still serving: reads and writes
    expect((await store.applied(gid(1)))?.status).toBe('applied');
    await store.setIntakeCursor({ endedAt: done.endedAt, game: gid(1) });
    await h.play({ game: gid(2), accounts: [C, D] });
    expect(await h.svc.intake(done)).toEqual({ kind: 'duplicate', game: gid(1) });
    // the room comes back: the snapshot is tried again, at close at the latest; everything is there after a reopen
    rmSync(join(dir, LADDER_FILE_STORE_FILES.snapshotTmp), { recursive: true });
    await store.close();
    expect(readFileSync(journal(dir), 'utf8')).toBe('');
    const again = await openFileLadderStore({ dir });
    expect([(await again.applied(gid(1)))?.status, (await again.applied(gid(2)))?.status]).toEqual(['applied', 'applied']);
    expect(await again.intakeCursor()).toEqual({ endedAt: done.endedAt, game: gid(1) });
    await again.close();
  });

  it('a snapshot that fails at close is a warning, not a failed close: the next open replays the journal and writes it (review of M15-3)', async () => {
    const dir = fresh();
    const warnings: string[] = [];
    const s = await openFileLadderStore({ dir, onWarning: (m) => warnings.push(m) });
    await s.setIntakeCursor({ endedAt: T, game: gid(1) });
    mkdirSync(join(dir, LADDER_FILE_STORE_FILES.snapshotTmp));
    await expect(s.close()).resolves.toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining('could not write its snapshot at close')]);
    expect(() => statSync(join(dir, LADDER_FILE_STORE_FILES.lock))).toThrow(); // released
    rmSync(join(dir, LADDER_FILE_STORE_FILES.snapshotTmp), { recursive: true });
    const again = await openFileLadderStore({ dir });
    expect(await again.intakeCursor()).toEqual({ endedAt: T, game: gid(1) });
    expect(readFileSync(journal(dir), 'utf8')).toBe('');
    await again.close();
  });

  it('a forgetAccount whose snapshot fails is committed and answers notCompacted; the account is forgotten in memory; calling it again finishes it (review of M15-3)', async () => {
    const dir = fresh();
    const store = await openFileLadderStore({ dir, onWarning: () => undefined });
    const h = await harness({ accounts: [1, 2, 3, 4], store });
    await h.play({ game: gid(1), accounts: [A, B] });
    await h.start({ game: gid(2), accounts: [A, C] });
    expect(h.svc.accountBusy(A)).toBe(true);
    mkdirSync(join(dir, LADDER_FILE_STORE_FILES.snapshotTmp));
    await expect(h.svc.forgetAccount(A)).rejects.toMatchObject({ code: 'notCompacted' });
    // committed: every read answers without the id, and the memory forgot it
    expect(h.svc.accountBusy(A)).toBe(false);
    expect(await store.ratings('1v1-standard', [A])).toEqual(new Map());
    expect(placesInDump(store.dump(), A)).toEqual([]);
    expect(readFileSync(journal(dir)).includes(Buffer.from(A))).toBe(true); // the old lines, until the snapshot is written
    // the store keeps serving; the snapshot it owes is tried at every write
    await store.setIntakeCursor({ endedAt: T, game: gid(1) });
    rmSync(join(dir, LADDER_FILE_STORE_FILES.snapshotTmp), { recursive: true });
    expect(await h.svc.forgetAccount(A)).toEqual({ ratings: 0, seasonRecords: 0, historySeats: 0, reports: 0, starts: 0, penalties: 0, capSeats: 0, adjustments: 0 });
    expect(placesInDir(dir, A)).toEqual([]);
    await store.close();
  });

  it.skipIf(process.platform === 'win32')('files are 0600 and the directory 0700', async () => {
    const dir = fresh();
    const s = await openFileLadderStore({ dir });
    await s.setIntakeCursor({ endedAt: T, game: gid(1) });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const f of [LADDER_FILE_STORE_FILES.journal, LADDER_FILE_STORE_FILES.snapshot, LADDER_FILE_STORE_FILES.lock]) {
      expect(statSync(join(dir, f)).mode & 0o777, f).toBe(0o600);
    }
    await s.close();
  });

  it.skipIf(process.platform === 'win32')('a directory and a journal that were already there are narrowed to 0700 and 0600 at open (review of M15-3)', async () => {
    const dir = fresh();
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    writeFileSync(journal(dir), '');
    chmodSync(journal(dir), 0o644);
    const s = await openFileLadderStore({ dir });
    await s.setIntakeCursor({ endedAt: T, game: gid(1) });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(journal(dir)).mode & 0o777).toBe(0o600);
    await s.close();
  });

  it('mustExist: a directory without a store is refused as missing, and nothing is made (review of M15-3)', async () => {
    const dir = fresh();
    await expect(openFileLadderStore({ dir, mustExist: true })).rejects.toMatchObject({ code: 'missing', message: `no ladder store in ${dir}` });
    expect(existsSync(dir)).toBe(false);
    mkdirSync(dir);
    await expect(openFileLadderStore({ dir, mustExist: true })).rejects.toMatchObject({ code: 'missing' });
    expect(readdirSync(dir)).toEqual([]);
    await (await openFileLadderStore({ dir })).close();
    const s = await openFileLadderStore({ dir, mustExist: true });
    expect(s.dir).toBe(dir);
    await s.close();
  });

  it('snapshots every compactEvery lines, cutting the journal', async () => {
    const dir = fresh();
    const s = await openFileLadderStore({ dir, compactEvery: 3 });
    for (let i = 0; i < 7; i++) await s.setIntakeCursor({ endedAt: T, game: gid(i) });
    expect(readFileSync(journal(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l).seq)).toEqual([7]);
    expect(JSON.parse(readFileSync(join(dir, LADDER_FILE_STORE_FILES.snapshot), 'utf8')).lastSeq).toBe(6);
    await s.close();
  });
});
