/**
 * `FileLadderStore` (M15-3; design 13.3, D20): the development store, the memory store plus a journal, in `DATA_DIR/ladder/`. Server only. The
 * shape of milestone 14's file store (m14 9.6), which this copies:
 *
 *   <dir>/lock             the lock: { pid, startedAt }, made atomically (written beside, then hard-linked into place, so it is never half written)
 *   <dir>/snapshot.json    { format, version, lastSeq, tables }: every table, and the seq of the last journal line it includes
 *   <dir>/journal.jsonl    one line per committed write: { seq, op, m }, m the write's row mutations (src/store/memory.ts); seq rises by one a line
 *   <dir>/snapshot.tmp     only while a snapshot is being written
 *
 * - **Write-ahead.** Writes are serialized. Each one plans against the committed tables, appends its line with an fsync, and only then applies it, so
 *   a reader never sees a write that is not on disk. A refused write (a 'duplicate' or 'conflict' answer included) writes no line. An append that
 *   fails is cut back to the size before it; the store then refuses every call ('closed') until it is reopened.
 * - **Snapshots that know their place** (13.3): write snapshot.tmp, fsync it, rename it over snapshot.json, fsync the directory, then rewrite the
 *   journal without the lines at or below the snapshot's lastSeq (all of them: the snapshot is taken between writes, so the journal is cut to
 *   nothing). Opening loads the snapshot and replays only lines with seq > lastSeq, then snapshots again, so a crash at any point never applies a
 *   line twice: a replayed `resetRating` cannot undo later games and a replayed `setIntakeCursor` cannot move the cursor back. A snapshot is written
 *   at open, at close, every 1,000 lines and **at once after `forgetAccount`**, so a deleted id survives in no journal line when the call returns
 *   (8.7, 17.10). A snapshot that fails (a full disk: it needs room for the whole state, a journal line very little) leaves the files consistent at
 *   every step, so it fails no write that was already committed and stops nothing (review of M15-3, as milestone 14's store does): a threshold
 *   snapshot is tried again later with a warning; a forgetAccount whose snapshot fails answers 'notCompacted' (committed; calling it again finishes
 *   it), and the snapshot it owes is tried again at every write and at close. One that fails at close is a warning: the next open writes it.
 * - **A torn last line** (no newline, or a last line that does not parse) is cut at open; a bad line followed by a good one is corruption, and the
 *   store refuses to open ('corrupt') rather than guess, as does a gap in the seqs.
 * - **The lock** keeps a second process out ('locked': "the ladder store is in use: stop the server, or use PostgreSQL"), so `openmtg-ladder reset`
 *   and `reports` refuse while the server runs and a server never overwrites a command's write, and a second opener in the same process. A lock
 *   whose process is gone is taken over with a warning, and so is one whose process id now names a later process (this one: a container's PID 1
 *   after a restart; or, on Linux, one that started after the lock was taken), as milestone 14's store does (review of M15-3).
 * - Files are made 0600 and the directory 0700, and a directory or journal that was already there (restored from a backup, made by an operator) is
 *   narrowed to that at open: the store holds account ids, names at the time, rating histories and abuse reports.
 * - `mustExist` (the openmtg-ladder command): a directory that holds neither a snapshot nor a journal is refused ('missing'), and nothing is made.
 */
import { chmod, link, mkdir, open, readFile, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RandomBytes } from '../ids';
import {
  applyLadderMutations, emptyLadderTables, LADDER_TABLE_NAMES, ladderTablesFromJson, ladderTablesToJson, LadderStoreError, LadderTx,
  MemoryLadderStore, type LadderMutation, type LadderTables,
} from './memory';

export const LADDER_FILE_STORE_FORMAT = 'openmtg-ladder-store';
export const LADDER_FILE_STORE_VERSION = 1;
/** A snapshot after this many journal lines (13.3). */
export const LADDER_COMPACT_EVERY = 1_000;
export const LADDER_FILE_STORE_FILES = Object.freeze({ lock: 'lock', snapshot: 'snapshot.json', journal: 'journal.jsonl', snapshotTmp: 'snapshot.tmp' });
/** The text a second opener's refusal starts with (13.3). */
export const LADDER_STORE_IN_USE = 'the ladder store is in use: stop the server, or use PostgreSQL';

export interface FileLadderStoreOptions {
  /** `DATA_DIR/ladder`. */
  dir: string;
  /** Told when a stale lock is taken over, or a snapshot could not be written (default: process.emitWarning). */
  onWarning?: (message: string) => void;
  /**
   * Open only a store that is there (snapshot.json or journal.jsonl in `dir`): otherwise 'missing', and no directory or file is made. For the
   * openmtg-ladder command, which must never act on a new, empty store beside the server's (review of M15-3).
   */
  mustExist?: boolean;
  /** A snapshot after this many journal lines (LADDER_COMPACT_EVERY). */
  compactEvery?: number;
  /** The random source of the 'deleted:' markers (8.7); node:crypto by default. */
  random?: RandomBytes;
  /**
   * Test seam: runs after the new snapshot is in place and before the journal is rewritten. A hook that throws stands for a crash at that point: the
   * store stops (every call answers 'closed'; close() releases it without writing anything more), and the files stay as the crash left them.
   */
  afterSnapshot?: () => void | Promise<void>;
}

const isWindows = process.platform === 'win32';

async function fsyncDir(dir: string): Promise<void> {
  // Windows cannot open a directory for fsync (its renames are durable through NTFS's journal); elsewhere a failure is real.
  if (isWindows) return;
  const fh = await open(dir, 'r');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Every byte of `buf` at the end of an append-mode file (a write may take only part of it: a full disk returns a short count before it fails). */
async function writeAll(fh: FileHandle, buf: Uint8Array): Promise<void> {
  let off = 0;
  while (off < buf.byteLength) {
    const { bytesWritten } = await fh.write(buf, off, buf.byteLength - off);
    if (!(bytesWritten > 0)) throw new Error(`a write stopped after ${off} of ${buf.byteLength} bytes`);
    off += bytesWritten;
  }
}

/**
 * Cuts the append-mode file at `path` to `size` bytes and fsyncs it, through a handle of its own: Windows opens an append-mode file without the
 * right to change its size (ftruncate fails with EPERM). The append-mode handle writes at the end wherever it is, so it carries on after the cut.
 */
async function cutFile(path: string, size: number): Promise<void> {
  const fh = await open(path, 'r+');
  try {
    await fh.truncate(size);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function renameRetry(from: string, to: string): Promise<void> {
  // Windows refuses a rename over a file another process (an indexer, an antivirus) holds open for a moment: retry briefly.
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 8 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw e;
      await new Promise((r) => setTimeout(r, 10 * (i + 1)));
    }
  }
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Whether `path` is a file (a missing one, or a missing directory on the way, is not). */
async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw e;
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

// ---- the lock ----------------------------------------------------------------------------------------------------------------------------------

/** `startedAt`: when the holding process started (13.3 keeps "the process id and start time"), so a later process that got its id is told apart. */
interface LockInfo { pid: number; startedAt: string }

/**
 * The lock files this process holds or is taking (by the store directory's real path). A second opener in this process is refused by this set, not
 * by the process id, so a lock that carries this process's id but is not in the set was left by an earlier process that had the same id: a
 * container's PID 1 after a restart, or any process after a reboot (review of M15-3, as milestone 14's store).
 */
const HELD = new Set<string>();

/** How much later than its recorded start a process read from the system may have started and still be the holder (whole-second boot time, clock steps). */
const START_SLACK_MS = 60_000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * When process `pid` started, by the wall clock, where the system tells (Linux: its start in clock ticks after boot from /proc/<pid>/stat, at
 * USER_HZ 100, plus /proc/stat's boot time); null elsewhere or when it cannot be read.
 */
async function processStartMs(pid: number): Promise<number | null> {
  if (process.platform !== 'linux') return null;
  try {
    const st = await readFile(`/proc/${pid}/stat`, 'utf8');
    // the fields after the command name (which may hold spaces and parentheses) start at field 3; starttime is field 22
    const ticks = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[19]);
    const btime = (await readFile('/proc/stat', 'utf8')).split('\n').find((l) => l.startsWith('btime '));
    const boot = Number(btime?.slice('btime '.length));
    return btime !== undefined && Number.isFinite(ticks) && Number.isFinite(boot) ? boot * 1000 + ticks * 10 : null;
  } catch {
    return null;
  }
}

function parseLock(buf: Buffer | null): LockInfo | null {
  if (buf === null) return null;
  try {
    const j = JSON.parse(buf.toString('utf8')) as Partial<LockInfo>;
    return typeof j.pid === 'number' && Number.isSafeInteger(j.pid) && j.pid > 0 && typeof j.startedAt === 'string' ? { pid: j.pid, startedAt: j.startedAt } : null;
  } catch {
    return null;
  }
}

/** Why the lock `holder` is stale, or null while its process may still hold it. Asked only for a lock this process does not hold (HELD). */
async function staleReason(holder: LockInfo | null): Promise<string | null> {
  if (holder === null) return 'it does not parse';
  if (holder.pid === process.pid) return `it was left by an earlier process with this process id (${holder.pid})`;
  if (!processAlive(holder.pid)) return `process ${holder.pid} is gone`;
  const recorded = Date.parse(holder.startedAt);
  const started = await processStartMs(holder.pid);
  if (started !== null && Number.isFinite(recorded) && started > recorded + START_SLACK_MS) {
    return `process ${holder.pid} started after the lock was taken (its id was reused)`;
  }
  return null;
}

export interface LadderStoreLock { release(): Promise<void> }

/**
 * Takes `<dir>/lock`: 'locked' while this process holds it (HELD) or a live process does; a lock whose process is gone, whose process id now names
 * a later process (this one, or one that started after the lock was taken), or that does not parse, is taken over with a warning. The refusal names
 * the lock file and the way out. The lock file is written in full beside it and hard-linked into place, so another opener never reads half of one.
 * Two processes taking over the same stale lock at the same moment could both succeed; for a development store, after a crash, that race is
 * accepted (as milestone 14's).
 */
export async function takeLadderLock(dir: string, warn: (message: string) => void): Promise<LadderStoreLock> {
  const real = await realpath(dir);
  const path = join(real, LADDER_FILE_STORE_FILES.lock);
  // checked and reserved in one step, so two openers in this process at once never both pass
  if (HELD.has(real)) throw new LadderStoreError('locked', `${LADDER_STORE_IN_USE} (${real}: by this process)`);
  HELD.add(real);
  // the process's own start (not the lock's time), which a later process with the same id cannot have
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  const body = JSON.stringify({ pid: process.pid, startedAt, lockedAt: new Date().toISOString() });
  try {
    const tmp = join(real, `lock.${process.pid}.${Date.now()}.tmp`);
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(body);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await link(tmp, path);
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          const holder = parseLock(await readIfExists(path));
          const why = await staleReason(holder);
          if (why === null) {
            throw new LadderStoreError(
              'locked',
              `${LADDER_STORE_IN_USE} (${real}, process ${holder!.pid}, started ${holder!.startedAt}); if no server runs there, delete ${path}`,
            );
          }
          if (attempt >= 2) throw new LadderStoreError('locked', `${LADDER_STORE_IN_USE} (${real}: its lock ${path} could not be taken)`);
          warn(`taking over the ladder store lock in ${real}: ${why}`);
          await unlinkIfExists(path);
        }
      }
    } finally {
      await unlinkIfExists(tmp);
    }
    await fsyncDir(real);
  } catch (e) {
    HELD.delete(real);
    throw e;
  }
  return {
    async release() {
      try {
        // only our own lock: one taken over since (this process was presumed gone) is the new holder's
        const now = await readIfExists(path);
        if (now !== null && now.toString('utf8') === body) await unlinkIfExists(path);
      } finally {
        HELD.delete(real);
      }
    },
  };
}

// ---- the journal ---------------------------------------------------------------------------------------------------------------------------

interface JournalLine { seq: number; op: string; m: LadderMutation[] }

function journalLine(text: string): JournalLine | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof j !== 'object' || j === null) return null;
  const { seq, op, m } = j as Partial<JournalLine>;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || typeof op !== 'string' || !Array.isArray(m)) return null;
  for (const x of m as unknown[]) {
    if (typeof x !== 'object' || x === null) return null;
    const { t, k } = x as { t?: unknown; k?: unknown };
    if (typeof t !== 'string' || !(LADDER_TABLE_NAMES as readonly string[]).includes(t) || typeof k !== 'string' || !('v' in x)) return null;
  }
  return { seq, op, m: m as LadderMutation[] };
}

/**
 * The journal's lines in order, and whether a torn tail was found. A line counts only with its newline; a last line that does not parse is torn (a
 * write cut short); a bad line followed by a good one, or seqs that do not rise by one, are corruption.
 */
export function scanLadderJournal(buf: Buffer, file: string): { lines: JournalLine[]; torn: boolean } {
  const lines: JournalLine[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) return { lines, torn: true };
    const line = journalLine(buf.toString('utf8', pos, nl));
    if (line === null) {
      const rest = buf.toString('utf8', nl + 1).split('\n');
      if (rest.some((l) => journalLine(l) !== null)) throw new LadderStoreError('corrupt', `${file}: a bad line before a good one: the journal is corrupt`);
      return { lines, torn: true };
    }
    const prev = lines[lines.length - 1];
    if (prev !== undefined && line.seq !== prev.seq + 1) throw new LadderStoreError('corrupt', `${file}: line ${line.seq} follows line ${prev.seq}`);
    lines.push(line);
    pos = nl + 1;
  }
  return { lines, torn: false };
}

function loadSnapshot(buf: Buffer | null, file: string): { tables: LadderTables; lastSeq: number } {
  if (buf === null) return { tables: emptyLadderTables(), lastSeq: 0 };
  try {
    const j = JSON.parse(buf.toString('utf8')) as { format?: unknown; version?: unknown; lastSeq?: unknown; tables?: unknown };
    if (j.format !== LADDER_FILE_STORE_FORMAT) throw new Error('it is not a ladder store snapshot');
    if (j.version !== LADDER_FILE_STORE_VERSION) throw new Error(`its version ${String(j.version)} is not ${LADDER_FILE_STORE_VERSION}`);
    if (typeof j.lastSeq !== 'number' || !Number.isSafeInteger(j.lastSeq) || j.lastSeq < 0) throw new Error('its lastSeq is not a count');
    return { tables: ladderTablesFromJson(j.tables), lastSeq: j.lastSeq };
  } catch (e) {
    throw new LadderStoreError('corrupt', `${file}: ${(e as Error).message}`);
  }
}

// ---- the store -------------------------------------------------------------------------------------------------------------------------------

/** The file store (13.3). `openFileLadderStore` opens one. */
export class FileLadderStore extends MemoryLadderStore {
  private queue: Promise<unknown> = Promise.resolve();
  private failed: unknown = null;
  private linesSinceSnapshot = 0;
  private journalSize = 0;
  /** The next threshold snapshot: after this many journal lines (compactEvery, pushed back by a snapshot that failed). */
  private compactAt: number;
  /** A forgetAccount's snapshot failed: the next write and close try it again (old journal lines still hold the id). */
  private owed = false;

  private constructor(
    tables: LadderTables,
    /** `DATA_DIR/ladder`. */
    readonly dir: string,
    private readonly fh: FileHandle,
    private readonly lock: LadderStoreLock,
    private lastSeq: number,
    private readonly opts: {
      compactEvery: number; afterSnapshot: (() => void | Promise<void>) | null; random: RandomBytes | undefined; warn: (message: string) => void;
    },
  ) {
    super(tables, { random: opts.random });
    this.compactAt = opts.compactEvery;
  }

  static async open(options: FileLadderStoreOptions): Promise<FileLadderStore> {
    const dir = resolve(options.dir);
    const warn = options.onWarning ?? ((m: string) => process.emitWarning(m));
    if (options.mustExist === true) {
      // never made here: a command pointed at the wrong directory must not act on a new, empty store (review of M15-3)
      const there = await Promise.all([LADDER_FILE_STORE_FILES.snapshot, LADDER_FILE_STORE_FILES.journal].map((f) => exists(join(dir, f))));
      if (!there.some(Boolean)) throw new LadderStoreError('missing', `no ladder store in ${dir}`);
    } else {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
    // mkdir's mode counts only for a directory it makes: one that was there (restored from a backup, made by an operator) is narrowed too
    if (!isWindows) await chmod(dir, 0o700);
    const lock = await takeLadderLock(dir, warn);
    let fh: FileHandle | null = null;
    try {
      await unlinkIfExists(join(dir, LADDER_FILE_STORE_FILES.snapshotTmp));
      const snap = loadSnapshot(await readIfExists(join(dir, LADDER_FILE_STORE_FILES.snapshot)), LADDER_FILE_STORE_FILES.snapshot);
      let lastSeq = snap.lastSeq;
      const journal = await readIfExists(join(dir, LADDER_FILE_STORE_FILES.journal));
      if (journal !== null) {
        const { lines } = scanLadderJournal(journal, LADDER_FILE_STORE_FILES.journal);
        for (const line of lines) {
          if (line.seq <= lastSeq) continue; // in the snapshot already (a crash between the snapshot and the journal's rewrite)
          if (line.seq !== lastSeq + 1) throw new LadderStoreError('corrupt', `${LADDER_FILE_STORE_FILES.journal}: line ${line.seq} after the snapshot's ${lastSeq}`);
          applyLadderMutations(snap.tables, line.m);
          lastSeq = line.seq;
        }
      }
      fh = await open(join(dir, LADDER_FILE_STORE_FILES.journal), 'a', 0o600);
      // likewise the journal, which is only ever cut and reused, never made again
      if (!isWindows) await fh.chmod(0o600);
      const store = new FileLadderStore(snap.tables, dir, fh, lock, lastSeq, {
        compactEvery: options.compactEvery ?? LADDER_COMPACT_EVERY,
        afterSnapshot: options.afterSnapshot ?? null,
        random: options.random,
        warn,
      });
      await store.compact();
      return store;
    } catch (e) {
      await fh?.close().catch(() => undefined);
      await lock.release().catch(() => undefined);
      throw e;
    }
  }

  protected override live(): void {
    super.live();
    if (this.failed !== null) throw new LadderStoreError('closed', 'the ladder store stopped after a failed write: reopen it');
  }

  private serial<R>(f: () => Promise<R>): Promise<R> {
    const run = this.queue.then(f, f);
    this.queue = run.catch(() => undefined);
    return run;
  }

  protected override write<R>(op: string, plan: (tx: LadderTx) => R): Promise<R> {
    return this.serial(async () => {
      this.live();
      const tx = new LadderTx(this.t);
      const out = plan(tx);
      if (tx.muts.length > 0) {
        const seq = this.lastSeq + 1;
        await this.append(`${JSON.stringify({ seq, op, m: tx.muts } satisfies JournalLine)}\n`);
        applyLadderMutations(this.t, tx.muts);
        this.lastSeq = seq;
        this.linesSinceSnapshot++;
      }
      // committed (on disk and applied): what follows is housekeeping, whose failure never turns a done write into a failed one (review of M15-3)
      await this.housekeep(op);
      return structuredClone(out);
    });
  }

  /**
   * The snapshot after a write: always after forgetAccount (it returns only once the snapshot is written), after compactEvery lines, and after any
   * write while a forgetAccount's snapshot is owed. Every step of a snapshot leaves the files consistent (the journal holds every line the snapshot
   * may lack), so a failed one stops nothing: a threshold snapshot is tried again after compactEvery more lines (with a warning), an owed one at the
   * next write and at close; forgetAccount answers 'notCompacted' (committed; call it again to finish, which is safe). Only the test hook's "crash"
   * stops the store.
   */
  private async housekeep(op: string): Promise<void> {
    const must = op === 'forgetAccount';
    if (!must && !this.owed && this.linesSinceSnapshot < this.compactAt) return;
    try {
      await this.compact();
    } catch (e) {
      if (this.failed !== null) throw e; // a crash (the test hook) or a journal in doubt: the store has stopped
      const why = e instanceof Error ? e.message : String(e);
      if (must) {
        this.owed = true;
        throw new LadderStoreError(
          'notCompacted',
          `the erasure is committed, but the snapshot that drops the old journal lines could not be written in ${this.dir} (${why}): call forgetAccount again`,
        );
      }
      this.compactAt = this.linesSinceSnapshot + this.opts.compactEvery;
      this.opts.warn(`the ladder store in ${this.dir} could not write its snapshot (${why}); the journal keeps every write, and the snapshot is tried again`);
    }
  }

  private async append(line: string): Promise<void> {
    const buf = Buffer.from(line, 'utf8');
    const size = this.journalSize;
    try {
      await writeAll(this.fh, buf);
      await this.fh.sync();
      this.journalSize += buf.byteLength;
    } catch (e) {
      // cut the line back so it never counts; either way the store stops until it is reopened (the journal is the truth)
      await cutFile(join(this.dir, LADDER_FILE_STORE_FILES.journal), size).catch(() => undefined);
      this.failed = e;
      throw e;
    }
  }

  /**
   * The snapshot, in 13.3's order, then the journal cut to nothing (every line is in the snapshot). A failure at any step leaves the files
   * consistent and the store running (housekeep); only the test hook's throw stands for a crash and stops it, and so does a journal whose size can
   * no longer be told (append's cut-back needs it).
   */
  private async compact(): Promise<void> {
    const tmp = join(this.dir, LADDER_FILE_STORE_FILES.snapshotTmp);
    const data = JSON.stringify({
      format: LADDER_FILE_STORE_FORMAT, version: LADDER_FILE_STORE_VERSION, lastSeq: this.lastSeq, tables: ladderTablesToJson(this.t),
    });
    try {
      const out = await open(tmp, 'w', 0o600);
      try {
        if (!isWindows) await out.chmod(0o600);
        await writeAll(out, Buffer.from(data, 'utf8'));
        await out.sync();
      } finally {
        await out.close();
      }
      await renameRetry(tmp, join(this.dir, LADDER_FILE_STORE_FILES.snapshot));
    } catch (e) {
      // snapshot.json and the journal are as they were; a part-written snapshot.tmp is removed (the next open would remove it too)
      await unlinkIfExists(tmp).catch(() => undefined);
      throw e;
    }
    await fsyncDir(this.dir);
    if (this.opts.afterSnapshot) {
      try {
        await this.opts.afterSnapshot();
      } catch (e) {
        this.failed = e;
        throw e;
      }
    }
    try {
      await cutFile(join(this.dir, LADDER_FILE_STORE_FILES.journal), 0);
    } catch (e) {
      // the snapshot holds every line, so an open skips what the journal still has; append's cut-back needs the journal's true size
      this.journalSize = await this.fh.stat().then(
        (st) => st.size,
        (e2: unknown) => {
          this.failed = e2;
          return this.journalSize;
        },
      );
      throw e;
    }
    this.journalSize = 0;
    this.linesSinceSnapshot = 0;
    this.compactAt = this.opts.compactEvery;
    this.owed = false;
  }

  /** Waits for the writes in flight, writes a last snapshot (unless the store stopped after a failure), and releases the journal and the lock. */
  override close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return this.serial(async () => {
      if (this.closed) return;
      try {
        if (this.failed === null) await this.compact();
      } catch (e) {
        // a crash (the test hook) or a journal in doubt is the caller's to hear; a snapshot that could not be written is not: every write is in the
        // journal, and the next open writes the snapshot (so a command's committed write is never reported as failed)
        if (this.failed !== null) throw e;
        const why = e instanceof Error ? e.message : String(e);
        this.opts.warn(`the ladder store in ${this.dir} could not write its snapshot at close (${why}); the journal keeps every write, and the next open writes it`);
      } finally {
        this.closed = true;
        await this.fh.close().catch(() => undefined);
        await this.lock.release();
      }
    });
  }
}

/** Opens the file store in `options.dir` (`DATA_DIR/ladder`): takes the lock, loads the snapshot, replays the journal past it, snapshots. */
export function openFileLadderStore(options: FileLadderStoreOptions): Promise<FileLadderStore> {
  return FileLadderStore.open(options);
}
