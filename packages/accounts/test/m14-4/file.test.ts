/**
 * M14-4: the contract suite (test/m14-4/contract.ts) on the file store, whose erase test is a byte search of everything under its directory
 * (ACCOUNTS_DATA_DIR), and the file store's own cases (design 11.2, 13.2): the journal and the snapshot across a reopen and a crash, a torn journal
 * line cut at open, a crash after the snapshot and before the journal rewrite (no line applied twice), corruption refused, the snapshot rewritten
 * and the journal truncated before erase and rekey return, the lock refusing a second opener (in this process and in another one), a stale lock
 * taken over, the files' modes. Fixed inputs only; a "crash" is a copy of the files a running store has written, or a test hook that throws.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AccountStoreError, FILE_STORE_FILES, FileAccountStore, openFileAccountStore, type AccountStore, type FileAccountStoreOptions,
} from '@openmtg/accounts';
import {
  accId, accountOf, accountStoreContract, at, auditOf, claimErasure, DAY, emailCodeOf, guestSession, HOUR, historyOf, MINUTE, newAccount, placeOf,
  placesInTables, refused, renameOpts, reportOf, sanctionId, sanctionOf, sessionOf, sha, T0, tombstoneOf,
} from './contract';

const root = mkdtempSync(join(tmpdir(), 'openmtg-m14-4-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const freshDir = (): string => join(root, `store-${++dirs}`);

/** Every file under `dir`, relative paths. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p).map((f) => join(e.name, f)));
    else out.push(e.name);
  }
  return out;
}

/**
 * The byte search: every file under the store's directory whose bytes hold `needle`. A hit in the snapshot or the journal is placed under the table
 * of the row it is in (placeOf); a hit placed nowhere, or in any other file, counts as `file:<name>`.
 */
function placesInDir(dir: string, needle: string): string[] {
  const bytes = Buffer.from(needle, 'utf8');
  const out: string[] = [];
  for (const f of filesUnder(dir)) {
    const buf = readFileSync(join(dir, f));
    if (!buf.includes(bytes)) continue;
    let found: string[] = [];
    if (f === FILE_STORE_FILES.snapshot) {
      found = placesInTables((JSON.parse(buf.toString('utf8')) as { tables: Record<string, [string, unknown][]> }).tables, needle);
    } else if (f === FILE_STORE_FILES.journal) {
      for (const line of buf.toString('utf8').split('\n').filter((l) => l !== '')) {
        for (const m of (JSON.parse(line) as { m: { t: string; k: string; v: unknown }[] }).m) {
          if (!JSON.stringify(m).includes(needle)) continue;
          found.push(m.v === null ? `journal-delete:${m.t}` : placeOf(m.t, m.v, needle));
        }
      }
    }
    out.push(...(found.length > 0 ? found : [`file:${relative(dir, join(dir, f))}`]));
  }
  return out;
}

function dirOf(store: AccountStore): string {
  if (!(store instanceof FileAccountStore)) throw new Error('not a file store');
  return store.dir;
}

accountStoreContract({
  name: 'file',
  open: async (limits) => openFileAccountStore({ dir: freshDir(), ...limits }),
  places: async (store, needle) => placesInDir(dirOf(store), needle),
});

// ---- the file store's own cases ---------------------------------------------------------------------------------------------------------------

const open = (dir: string, opts: Omit<FileAccountStoreOptions, 'dir'> = {}) => FileAccountStore.open({ dir, onWarning: () => undefined, ...opts });
const journalOf = (dir: string): string => readFileSync(join(dir, FILE_STORE_FILES.journal), 'utf8');
const journalLines = (dir: string): string[] => journalOf(dir).split('\n').filter((l) => l !== '');
const snapshotOf = (dir: string) => JSON.parse(readFileSync(join(dir, FILE_STORE_FILES.snapshot), 'utf8')) as { lastSeq: number; tables: Record<string, [string, unknown][]> };

/** Opens and closes a store in `dir`: an empty snapshot and journal, no lock. */
async function touch(dir: string): Promise<void> {
  await (await open(dir)).close();
}

/** What a crash leaves: a copy of the store's files as they are now (the lock stays behind with the running store). */
function crashCopy(from: string): string {
  const to = freshDir();
  mkdirSync(to, { mode: 0o700 });
  for (const f of [FILE_STORE_FILES.snapshot, FILE_STORE_FILES.journal]) if (existsSync(join(from, f))) copyFileSync(join(from, f), join(to, f));
  return to;
}

/** Three writes after the open's snapshot: three journal lines (a registration, an avatar change, a change-feed entry). */
async function threeWrites(store: AccountStore): Promise<void> {
  await store.createAccount(newAccount(1, 'Alice', 'allce'), T0);
  const a = (await store.account(accId(1)))!;
  await store.updateAccount(a.id, a.version, { avatar: 'd20-amber' });
  await store.appendChange({ at: T0, account: a.id, kind: 'avatar' });
}

/** A row in every table: accounts with an email and a deletion, every name kind, rotated and revoked sessions, a closed report, an answered appeal, a tombstone. */
async function fillEveryTable(s: AccountStore): Promise<void> {
  await s.createAccount(newAccount(1, 'Alice', 'allce', { claim: guestSession(1) }), T0);
  await s.createAccount(newAccount(2, 'Bob', 'bob'), T0);
  await s.createAccount(newAccount(3, 'Gone', 'gone'), T0);
  let a = (await s.account(accId(1)))!;
  // the optional fields of M14-15 (review A5: when the address was set; A7: a reserved key's name) round-trip too
  a = await s.updateAccount(a.id, a.version, { email: { address: 'alice@example.org', verifiedAt: T0, setAt: T0 }, lastSignInAt: at(MINUTE) });
  a = await s.rename(a.id, a.version, historyOf(1, 'Alicia', 'allcla', at(HOUR)), renameOpts(at(HOUR)));
  await s.redactName(a.id, 'allce');
  const b = (await s.account(accId(2)))!;
  await s.updateAccount(b.id, b.version, { deletion: { requestedAt: T0, purgeAt: at(7 * DAY), erasingAt: null, done: ['hosted'] } });
  await s.putNameEntry({ key: 'staff', keyVersion: 1, kind: 'reserved', account: null, until: null, note: 'the team', createdAt: T0, name: 'Staff' });
  await s.putNameEntry({ key: 'slur', keyVersion: 1, kind: 'banned', account: null, until: null, note: null, createdAt: T0 });
  await s.putCredential({ account: accId(1), provider: 'shopify', subject: 'gid-1', secret: null, meta: { count: 3, linked: true, note: null }, createdAt: T0, lastUsedAt: null });
  await s.spendRecoveryCode(accId(1), 2, sha('rc:1:2:1'), at(MINUTE));
  await s.putDevice({ hash: sha('device:1:1'), account: accId(1), createdAt: T0, lastUsedAt: at(MINUTE), failures: 1 });
  await s.rotateSession(sessionOf(1, 0).id, sessionOf(1, 0).tokenHash, sha('next'), at(DAY));
  await s.putSession(sessionOf(1, 1, { device: sha('device:1:1') }));
  await s.revokeSession(accId(1), sessionOf(1, 1).id, 'signOut', at(HOUR));
  await s.setRelation({ account: accId(1), other: accId(2), kind: 'mute', createdAt: T0 });
  await s.putEmailCode(emailCodeOf(1, accId(1), 'verify'), T0);
  await s.useEmailCode(emailCodeOf(1, accId(1), 'verify').id, at(MINUTE));
  await s.putReport(reportOf(1, { kind: 'system', source: 'ladder' }, { account: accId(2) }, 'Bob', {
    reason: 'collusion', related: [accId(1)], evidence: { games: ['g_1'], stats: { share: 0.9 } }, game: 'g_1', text: 'pods',
  }));
  await s.putReport(reportOf(2, { kind: 'guest', session: guestSession(5) }, { guestSession: guestSession(6) }, 'Wolf (guest)'));
  await s.closeReport(reportOf(2, null, { account: accId(2) }, 'Bob').id, 'dismissed', 'op', at(DAY), 'no');
  await s.putSanction(sanctionOf(1, accId(1), 'mute', at(DAY), { reports: [reportOf(1, null, { account: accId(1) }, 'x').id] }));
  await s.endSanction(sanctionId(1), at(HOUR), 'lifted', 'op');
  await s.putAppeal({ sanction: sanctionId(1), account: accId(1), text: 'Sorry.', createdAt: T0, answer: null, answerMessage: null, answeredAt: null, answeredBy: null });
  await s.answerAppeal(sanctionId(1), 'lifted', 'Fine.', 'op', at(HOUR));
  await s.appendAudit([auditOf(1, 'adminViewed', accId(1), { what: 'show' }, { actor: 'admin:op', actorOs: 'root', addressTag: 'tag' })]);
  await s.appendChange({ at: T0, account: accId(1), kind: 'sessionsRevoked', session: sessionOf(1, 0).id, detail: { except: sessionOf(1, 0).id, now: true } });
  await claimErasure(s, accId(3));
  await s.erase(accId(3), tombstoneOf(accId(3), T0, at(DAY)), at(90 * DAY));
  // erase and the open wrote snapshots: these last lines are in the journal only
  await s.appendChange({ at: at(DAY), account: accId(3), kind: 'deleted' });
  await s.updateDevice(sha('device:1:1'), { failures: 2 });
}

/** A process id that is surely gone: a child's, after it exited. */
function deadPid(): number {
  return Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
}

describe('M14-4 file store', () => {
  it('keeps every write across a close and a reopen, and goes on from the seq it reached', async () => {
    const dir = freshDir();
    const a = await open(dir);
    await threeWrites(a);
    const b0 = (await a.account(accId(1)))!;
    await a.rename(b0.id, b0.version, historyOf(1, 'Alicia', 'allcla', at(MINUTE)), renameOpts(at(MINUTE)));
    const before = a.dump();
    await a.close();
    expect(existsSync(join(dir, FILE_STORE_FILES.lock))).toBe(false);
    expect(journalOf(dir)).toBe('');
    const b = await open(dir);
    expect(b.dump()).toEqual(before);
    expect(await b.changesHead()).toBe(1);
    expect(await b.appendChange({ at: T0, account: accId(1), kind: 'renamed' })).toBe(2);
    await b.close();
  });

  it('a crash (no close): the next open replays every journal line after the snapshot', async () => {
    const dir = freshDir();
    const a = await open(dir);
    await threeWrites(a);
    expect(journalLines(dir).map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([1, 2, 3]);
    const crashed = crashCopy(dir);
    const b = await open(crashed);
    expect(b.dump()).toEqual(a.dump());
    expect(journalOf(crashed)).toBe(''); // the open's snapshot holds them now
    expect(snapshotOf(crashed).lastSeq).toBe(3);
    await b.close();
    await a.close();
  });

  it('a torn last line is cut at open: without its newline, or a last line that does not parse', async () => {
    const dir = freshDir();
    const a = await open(dir);
    await threeWrites(a);
    const want = a.dump();
    const line4 = '{"seq":4,"op":"updateAccount","m":[{"t":"accounts","k":"acc_00000000000000000000000001","v":{"id":"acc_0';
    for (const tail of [line4, `${line4}\n`, '\n']) {
      const crashed = crashCopy(dir);
      writeFileSync(join(crashed, FILE_STORE_FILES.journal), journalOf(dir) + tail);
      const b = await open(crashed);
      expect(b.dump(), JSON.stringify(tail)).toEqual(want);
      expect(journalOf(crashed)).toBe('');
      const acc = (await b.account(accId(1)))!;
      await b.updateAccount(acc.id, acc.version, { avatar: 'd4-white' });
      expect(journalLines(crashed).map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([4]);
      await b.close();
    }
    await a.close();
  });

  it('a bad line before a good one, or a gap in the seqs, is corruption: the open is refused and the lock released', async () => {
    const dir = freshDir();
    const a = await open(dir);
    await threeWrites(a);
    const [l1, l2, l3] = journalLines(dir) as [string, string, string];
    await a.close();
    for (const journal of [`${l1}\nnot json\n${l3}\n`, `${l1}\n${l3}\n`, `${l2}\n${l1}\n`]) {
      const d = freshDir();
      await touch(d);
      writeFileSync(join(d, FILE_STORE_FILES.journal), journal);
      await refused(open(d), 'corrupt');
      expect(existsSync(join(d, FILE_STORE_FILES.lock))).toBe(false);
    }
    // lines that start after the snapshot's lastSeq + 1 are a gap too
    const d = freshDir();
    await touch(d);
    writeFileSync(join(d, FILE_STORE_FILES.journal), `${l2}\n${l3}\n`);
    await refused(open(d), 'corrupt');
  });

  it('a damaged snapshot is refused (corrupt), never read as an empty store', async () => {
    const damaged = [
      '{"format":"openmtg-accounts-store","version":1,"lastSeq":0,"tables":', // cut short
      '{"format":"other","version":1,"lastSeq":0,"tables":{}}', // another file
      '{"format":"openmtg-accounts-store","version":2,"lastSeq":0,"tables":{}}', // a later format
      '{"format":"openmtg-accounts-store","version":1,"lastSeq":-1,"tables":{}}',
      '{"format":"openmtg-accounts-store","version":1,"lastSeq":0,"tables":{"accounts":[["x"]]}}',
    ];
    // rows no write would store (review of M14-4: they opened, and a later call failed with a TypeError)
    const snapshot = (tables: Record<string, unknown>) => JSON.stringify({ format: 'openmtg-accounts-store', version: 1, lastSeq: 0, tables });
    damaged.push(
      snapshot({ accounts: [['x', null]] }),
      snapshot({ accounts: [[accId(2), accountOf(1, 'Alice', 'allce')]] }), // under another account's key
      snapshot({ accounts: [[accId(1), { ...accountOf(1, 'Alice', 'allce'), createdAt: 'yesterday' }]] }),
      snapshot({ names: [['allce', { key: 'allce', keyVersion: 1, kind: 'current', account: accId(1), until: null, note: null, createdAt: T0 }]] }),
      snapshot({ history: [[accId(1), [historyOf(2, 'Bob', 'bob', T0)]]] }),
      snapshot({ sessions: [[sessionOf(1, 0).id, { ...sessionOf(1, 0), tokenHash: 7 }]] }),
      snapshot({ changes: [['1', { at: T0, account: accId(1), kind: 'avatar' }]] }), // no seq
      snapshot({ tombstones: [[accId(1), { row: tombstoneOf(accId(1)) }]] }), // no hold
      snapshot({ meta: [['sneaky', 1]] }),
    );
    for (const body of damaged) {
      const d = freshDir();
      await touch(d);
      writeFileSync(join(d, FILE_STORE_FILES.snapshot), body);
      await refused(open(d), 'corrupt');
      expect(existsSync(join(d, FILE_STORE_FILES.lock))).toBe(false);
    }
  });

  it('a journal line that parses but holds a row no write would store is corruption, not a torn tail', async () => {
    for (const v of ['null', '{"id":"x"}', JSON.stringify({ ...accountOf(1, 'Alice', 'allce'), version: -1 })]) {
      const d = freshDir();
      await touch(d);
      writeFileSync(join(d, FILE_STORE_FILES.journal), `{"seq":1,"op":"createAccount","m":[{"t":"accounts","k":"${accId(1)}","v":${v}}]}\n`);
      // null deletes a row (a line may delete what is not there); anything else must be a row
      if (v === 'null') {
        const s = await open(d);
        expect(await s.changesHead()).toBe(0);
        await s.close();
      } else await refused(open(d), 'corrupt');
    }
  });

  it('every kind of row comes back from the snapshot and from the journal as it was stored', async () => {
    // the checks at open refuse damage, never a row a write stored
    const dir = freshDir();
    const s = await open(dir);
    await fillEveryTable(s);
    const want = s.dump();
    for (const [t, rows] of Object.entries(want)) expect(rows.length, t).toBeGreaterThan(0);
    const fromJournal = crashCopy(dir);
    await s.close();
    const b = await open(dir);
    expect(b.dump()).toEqual(want);
    await b.close();
    const c = await open(fromJournal);
    expect(c.dump()).toEqual(want);
    await c.close();
  });

  it('a crash after the snapshot and before the journal rewrite: the reopen applies no line twice', async () => {
    const dir = freshDir();
    let crash = false;
    const a = await open(dir, {
      afterSnapshot: () => {
        if (crash) throw new Error('crash');
      },
    });
    await threeWrites(a);
    crash = true;
    await expect(a.close()).rejects.toThrow('crash');
    expect(existsSync(join(dir, FILE_STORE_FILES.lock))).toBe(false);
    // the snapshot holds lines 1-3, and the journal still has them
    expect(snapshotOf(dir).lastSeq).toBe(3);
    const lines = journalLines(dir);
    expect(lines).toHaveLength(3);
    // were line 2 applied again, the avatar would be this one
    writeFileSync(join(dir, FILE_STORE_FILES.journal), [lines[0], lines[1]!.replace('"d20-amber"', '"d4-white"'), lines[2], ''].join('\n'));
    const b = await open(dir);
    expect((await b.account(accId(1)))?.avatar).toBe('d20-amber');
    expect(await b.changesHead()).toBe(1);
    expect(journalOf(dir)).toBe('');
    expect(await b.appendChange({ at: T0, account: accId(1), kind: 'avatar' })).toBe(2);
    expect(journalLines(dir).map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([4]);
    await b.close();
  });

  it('erase returns only after the snapshot is rewritten and the journal truncated: no file holds the names or the email', async () => {
    const dir = freshDir();
    const s = await open(dir);
    await s.createAccount(newAccount(1, 'Quillfeather', 'qulllfeather'), T0);
    let x = (await s.account(accId(1)))!;
    x = await s.updateAccount(x.id, x.version, { email: { address: 'quill@example.org', verifiedAt: T0 } });
    await s.rename(x.id, x.version, historyOf(1, 'Zephyrine', 'zephyrlne', at(HOUR)), renameOpts(at(HOUR)));
    await claimErasure(s, accId(1));
    expect(journalLines(dir).length).toBeGreaterThan(0);
    expect(placesInDir(dir, 'Zephyrine')).not.toEqual([]);
    await s.erase(accId(1), tombstoneOf(accId(1), at(DAY)), at(91 * DAY));
    expect(journalOf(dir)).toBe('');
    expect(existsSync(join(dir, FILE_STORE_FILES.snapshotTmp))).toBe(false);
    for (const needle of ['Quillfeather', 'Zephyrine', 'quill@example.org']) expect(placesInDir(dir, needle), needle).toEqual([]);
    for (const p of placesInDir(dir, accId(1))) expect(p).toBe('tombstone');
    await s.close();
  });

  it('a crash during erase\'s snapshot: the store stops, and the reopen leaves no copy of the erased account', async () => {
    const dir = freshDir();
    let crash = false;
    const s = await open(dir, {
      afterSnapshot: () => {
        if (crash) throw new Error('crash');
      },
    });
    await s.createAccount(newAccount(1, 'Quillfeather', 'qulllfeather'), T0);
    await claimErasure(s, accId(1));
    crash = true;
    await expect(s.erase(accId(1), tombstoneOf(accId(1)), at(90 * DAY))).rejects.toThrow('crash');
    await refused(s.account(accId(1)), 'closed');
    await refused(s.appendChange({ at: T0, account: accId(1), kind: 'deleted' }), 'closed');
    await s.close();
    expect(placesInDir(dir, 'Quillfeather')).not.toEqual([]); // the old journal, as the crash left it
    const b = await open(dir);
    expect(await b.account(accId(1))).toBeNull();
    expect(await b.tombstone(accId(1))).toEqual(tombstoneOf(accId(1)));
    expect(placesInDir(dir, 'Quillfeather')).toEqual([]);
    await b.close();
  });

  /** Makes the next snapshot fail without a crash, as a full disk would: snapshot.tmp is a directory. Returns the undo. */
  function blockSnapshot(dir: string): () => void {
    mkdirSync(join(dir, FILE_STORE_FILES.snapshotTmp));
    return () => rmSync(join(dir, FILE_STORE_FILES.snapshotTmp), { recursive: true, force: true });
  }

  it('a snapshot that fails after a committed write fails nothing: the write resolves, the store goes on, the snapshot is tried again', async () => {
    // review of M14-4: the write was durable while its caller was told it failed, and the store stopped
    const dir = freshDir();
    const warnings: string[] = [];
    const s = await open(dir, { compactEvery: 1, onWarning: (m) => warnings.push(m) });
    const unblock = blockSnapshot(dir);
    await s.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('could not write its snapshot');
    expect(await s.account(accId(1))).not.toBeNull();
    expect(await s.spendRecoveryCode(accId(1), 3, sha('rc:1:3:1'), at(MINUTE))).toBe(true);
    expect(await s.appendChange({ at: T0, account: accId(1), kind: 'avatar' })).toBe(1);
    expect(journalLines(dir)).toHaveLength(3);
    expect(warnings).toHaveLength(3); // tried again after compactEvery more lines each time
    unblock();
    expect(await s.appendChange({ at: T0, account: accId(1), kind: 'avatar' })).toBe(2);
    expect(journalOf(dir)).toBe('');
    expect(snapshotOf(dir).lastSeq).toBe(4);
    await s.close();
    const b = await open(dir);
    expect((await b.recoveryCodes(accId(1)))[3]?.usedAt).toBe(at(MINUTE));
    expect(await b.spendRecoveryCode(accId(1), 3, sha('rc:1:3:1'), at(HOUR))).toBe(false);
    expect((await b.changes(0, 10)).map((c) => c.seq)).toEqual([1, 2]);
    await refused(b.createAccount(newAccount(1, 'Alice', 'allce'), T0), 'exists');
    await b.close();
  });

  it('an erase whose snapshot fails answers notCompacted, and erase again finishes it: then no file holds the names', async () => {
    const dir = freshDir();
    const s = await open(dir);
    await s.createAccount(newAccount(1, 'Quillfeather', 'qulllfeather'), T0);
    await claimErasure(s, accId(1));
    const unblock = blockSnapshot(dir);
    await refused(s.erase(accId(1), tombstoneOf(accId(1), at(DAY)), at(91 * DAY)), 'notCompacted');
    // committed: every read sees it, and the store goes on
    expect(await s.account(accId(1))).toBeNull();
    expect(await s.tombstone(accId(1))).toEqual(tombstoneOf(accId(1), at(DAY)));
    expect(placesInDir(dir, 'Quillfeather')).not.toEqual([]); // the old copies, until the snapshot is written
    await refused(s.erase(accId(1), tombstoneOf(accId(1), at(DAY)), at(91 * DAY)), 'notCompacted');
    unblock();
    await s.erase(accId(1), tombstoneOf(accId(1), at(DAY)), at(91 * DAY));
    expect(journalOf(dir)).toBe('');
    expect(placesInDir(dir, 'Quillfeather')).toEqual([]);
    await s.close();
  });

  it('a rekey whose snapshot fails answers notCompacted; the next write writes the snapshot it owes', async () => {
    const dir = freshDir();
    const s = await open(dir);
    await s.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    const unblock = blockSnapshot(dir);
    await refused(s.rekey(1, 2, new Map([['allce', 'allce2']])), 'notCompacted');
    expect(await s.nameKeyVersion()).toBe(2);
    await refused(s.rekey(1, 2, new Map([['allce', 'allce2']])), 'conflict'); // done already
    unblock();
    await s.appendChange({ at: T0, account: accId(1), kind: 'renamed' });
    expect(journalOf(dir)).toBe('');
    expect(snapshotOf(dir).tables['meta']).toContainEqual(['nameVersion', 2]);
    await s.close();
  });

  it('rekey is one snapshot rewrite: the journal is empty when it returns', async () => {
    const dir = freshDir();
    const s = await open(dir);
    await s.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    await s.rekey(1, 2, new Map([['allce', 'allce2']]));
    expect(journalOf(dir)).toBe('');
    expect(snapshotOf(dir).tables['meta']).toContainEqual(['nameVersion', 2]);
    await s.close();
  });

  it('writes a snapshot after compactEvery journal lines; a refused write writes no line', async () => {
    const dir = freshDir();
    const s = await open(dir, { compactEvery: 3 });
    await s.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    await refused(s.createAccount(newAccount(2, 'ALICE', 'allce'), T0), 'exists');
    expect(await s.spendRecoveryCode(accId(1), 0, 'not-the-hash', T0)).toBe(false);
    expect(journalLines(dir)).toHaveLength(1);
    await s.appendChange({ at: T0, account: accId(1), kind: 'avatar' });
    expect(journalLines(dir)).toHaveLength(2);
    await s.appendChange({ at: T0, account: accId(1), kind: 'avatar' });
    expect(journalOf(dir)).toBe('');
    expect(snapshotOf(dir).lastSeq).toBe(3);
    await s.close();
  });

  it('refuses a live-code cap that is not a whole number from 0 (RangeError) before it touches the directory', async () => {
    const dir = freshDir();
    await expect(openFileAccountStore({ dir, emailResetLiveCodes: -1 })).rejects.toThrow(RangeError);
    expect(existsSync(dir)).toBe(false);
  });

  it('the lock refuses a second opener, in this process and in another one, until the store is closed', async () => {
    const dir = freshDir();
    const s = await open(dir);
    await s.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    const second = await open(dir).then(
      () => null,
      (e: unknown) => e,
    );
    expect(second).toBeInstanceOf(AccountStoreError);
    expect((second as AccountStoreError).code).toBe('locked');
    expect((second as AccountStoreError).message).toContain('stop the server, or use PostgreSQL');
    // another process (the admin command beside a running server)
    const pkg = fileURLToPath(new URL('../../', import.meta.url));
    const script = join(root, 'open-store.mjs');
    writeFileSync(
      script,
      [
        `import { FileAccountStore } from ${JSON.stringify(pathToFileURL(join(pkg, 'src', 'store', 'file.ts')).href)};`,
        'try {',
        '  const s = await FileAccountStore.open({ dir: process.argv[2], onWarning: () => undefined });',
        '  console.log(JSON.stringify({ code: "opened", alice: (await s.accountByKey("allce", 1))?.name ?? null }));',
        '  await s.close();',
        '} catch (e) {',
        '  console.log(JSON.stringify({ code: e.code ?? String(e) }));',
        '}',
      ].join('\n'),
    );
    const other = () => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', script, dir], { cwd: pkg, encoding: 'utf8' })) as unknown;
    expect(other()).toEqual({ code: 'locked' });
    expect(await s.account(accId(1))).not.toBeNull(); // the refused opener changed nothing
    await s.close();
    expect(other()).toEqual({ code: 'opened', alice: 'Alice' });
    const again = await open(dir);
    await again.close();
  });

  it('a lock whose process is gone, or that does not parse, is taken over with a warning', async () => {
    for (const [body, why] of [[JSON.stringify({ pid: deadPid(), startedAt: T0 }), 'is gone'], ['{"pid":', 'does not parse']] as const) {
      const dir = freshDir();
      await touch(dir);
      writeFileSync(join(dir, FILE_STORE_FILES.lock), body);
      const warnings: string[] = [];
      const s = await open(dir, { onWarning: (m) => warnings.push(m) });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(why);
      expect(JSON.parse(readFileSync(join(dir, FILE_STORE_FILES.lock), 'utf8'))).toMatchObject({ pid: process.pid });
      await refused(open(dir), 'locked');
      await s.close();
      expect(existsSync(join(dir, FILE_STORE_FILES.lock))).toBe(false);
    }
  });

  it('a lock with this process\'s id that this process does not hold was left by an earlier process: taken over', async () => {
    // a container's PID 1 after a restart, or a reboot: process.kill(pid, 0) succeeds on this process itself (review of M14-4)
    const dir = freshDir();
    await touch(dir);
    writeFileSync(join(dir, FILE_STORE_FILES.lock), JSON.stringify({ pid: process.pid, startedAt: '2026-10-01T00:00:00.000Z' }));
    const warnings: string[] = [];
    const s = await open(dir, { onWarning: (m) => warnings.push(m) });
    expect(warnings).toEqual([expect.stringContaining('an earlier process with this process id')]);
    // while this process holds it, a second opener here is still refused
    await refused(open(dir), 'locked');
    await s.close();
    expect(existsSync(join(dir, FILE_STORE_FILES.lock))).toBe(false);
    const again = await open(dir, { onWarning: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(1);
    await again.close();
  });

  it('two openers in this process at once: exactly one gets the store', async () => {
    const dir = freshDir();
    await touch(dir);
    const both = await Promise.allSettled([open(dir), open(dir)]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as AccountStoreError).code).toBe('locked');
    await (both.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<FileAccountStore>).value.close();
  });

  it.skipIf(process.platform !== 'linux')('a lock whose process id now names a process that started after it is taken over; a live holder names the lock file', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      const pid = child.pid!;
      const dir = freshDir();
      await touch(dir);
      // the child started just now: a lock it "took" an hour ago belonged to an earlier process with the same id
      writeFileSync(join(dir, FILE_STORE_FILES.lock), JSON.stringify({ pid, startedAt: new Date(Date.now() - 3_600_000).toISOString() }));
      const warnings: string[] = [];
      const s = await open(dir, { onWarning: (m) => warnings.push(m) });
      expect(warnings).toEqual([expect.stringContaining('its id was reused')]);
      await s.close();
      // a lock taken after the child started is the child's: refused, and the message says which file to delete if no server runs
      writeFileSync(join(dir, FILE_STORE_FILES.lock), JSON.stringify({ pid, startedAt: new Date().toISOString() }));
      const e = await open(dir).then(
        () => null,
        (x: unknown) => x,
      );
      expect((e as AccountStoreError).code).toBe('locked');
      expect((e as AccountStoreError).message).toContain(join(realpathSync(dir), FILE_STORE_FILES.lock));
    } finally {
      child.kill();
    }
  });

  it.skipIf(process.platform === 'win32')('makes its directory 0700 and its files 0600: it holds personal data', async () => {
    const dir = freshDir();
    const s = await open(dir);
    await s.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const f of [FILE_STORE_FILES.lock, FILE_STORE_FILES.snapshot, FILE_STORE_FILES.journal]) expect(statSync(join(dir, f)).mode & 0o777, f).toBe(0o600);
    await s.close();
  });

  it.skipIf(process.platform === 'win32')('narrows a directory and a journal that were already there, wider, to 0700 and 0600', async () => {
    // mkdir's and open's modes count only for what they make (review of M14-4): ACCOUNTS_DATA_DIR may come from another part or a backup
    const dir = freshDir();
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    writeFileSync(join(dir, FILE_STORE_FILES.journal), '');
    chmodSync(join(dir, FILE_STORE_FILES.journal), 0o644);
    const s = await open(dir);
    await s.createAccount(newAccount(1, 'Alice', 'allce', { account: { email: { address: 'alice@example.org', verifiedAt: null } } }), T0);
    expect(journalLines(dir)).toHaveLength(1);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const f of [FILE_STORE_FILES.lock, FILE_STORE_FILES.snapshot, FILE_STORE_FILES.journal]) expect(statSync(join(dir, f)).mode & 0o777, f).toBe(0o600);
    await s.close();
  });
});
