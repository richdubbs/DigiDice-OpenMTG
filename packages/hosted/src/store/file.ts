/**
 * `FileStore` (M13-4, design 8.1, owner answer 5): the development store, a directory.
 *
 *   <dir>/store.json                    the format and its version
 *   <dir>/sessions/<id>.json            one per guest session
 *   <dir>/games/<id>/game.json          the game's row and seats (no seed, no config)
 *   <dir>/games/<id>/start.json         the seed and the config, written once at the start
 *   <dir>/games/<id>/log.jsonl          the action log: one JSON line per record, appended with an fsync per batch (write-ahead)
 *   <dir>/games/<id>/snapshots/<seq>.json   snapshots (state as base64), deleted when the game ends
 *   <dir>/results/<game>.json           the ledger: one per ended game, never changed
 *   <dir>/reports/<id>.json             the bug inbox
 *
 * Crash safety: every file but the logs is replaced atomically (written to a temporary file, fsync'd, renamed over the old one). A log line counts only
 * with its newline: at open, a torn last write (a partial line, or bytes that do not parse at the end of the file) is cut off, and a bad line followed
 * by good ones is corruption (the store refuses to open). An append that fails is truncated back to the size before it. Each game has its own log, so
 * a failure is per game by construction (design 2.3). `finishGame` writes the final record, then the result, then the status; a result found beside a
 * game still marked running at open is rolled forward.
 *
 * Unlike PostgreSQL, one game's records of one batch are not atomic in a crash: a torn batch may keep its first records. They were never acknowledged
 * (nothing derived from them was sent), and a recovery replays them as legitimately applied actions.
 *
 * Not handled (review minor 5, documented): a crash that loses the middle of the last batch but keeps whole lines after it (possible only where a
 * filesystem persists appended data out of order; NTFS and ext4's default data=ordered mode write it in order) looks like corruption in the middle
 * of the log, and the store refuses to open (`StoreError` 'corrupt') rather than guess. Telling the two apart would need a batch marker or an
 * acknowledged-length file (one more fsync per batch). For this development store the operator truncates the log after the last good line and reopens.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameRecord } from '../ledger/types';
import type { ReportRow, SessionRow, SnapshotRow } from './api';
import {
  emptyIndex, IndexedStore, reportFromJson, reportToJson, sessionFromJson, sessionToJson, type GameMeta, type IndexedStoreOptions, type Persistence,
  type ReportJson, type SessionJson, type StoreIndex,
} from './indexed';
import { checkId, endStatus, STORE_ID, StoreError } from './rules';

const FORMAT = { format: 'openmtg-file-store', version: 1 } as const;

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

/**
 * Writes every byte of `buf` at the end of an append-mode file. `write` may take only part of it (a full disk on Linux returns a short count before it
 * fails), so this goes on until all is written and throws when a write makes no progress (review MAJOR: a short write is never acknowledged).
 */
export async function writeAll(fh: FileHandle, buf: Uint8Array): Promise<void> {
  let off = 0;
  while (off < buf.byteLength) {
    const { bytesWritten } = await fh.write(buf, off, buf.byteLength - off);
    if (!(bytesWritten > 0)) throw new Error(`a write stopped after ${off} of ${buf.byteLength} bytes`);
    off += bytesWritten;
  }
}

/** Truncates a file to `size` bytes through a read-write handle and fsyncs it. */
async function cutBack(path: string, size: number): Promise<void> {
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

/** Writes `data` to `path` atomically: a temporary file in the same directory, fsync'd, renamed over `path`, the directory fsync'd. */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } catch (e) {
    await fh.close();
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  await fh.close();
  try {
    await renameRetry(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  await fsyncDir(join(path, '..'));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/** The JSON files of a directory (leftover temporary files of an interrupted atomic write are deleted). */
async function jsonFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  const out: string[] = [];
  for (const n of names) {
    if (n.includes('.tmp-')) await unlink(join(dir, n)).catch(() => undefined);
    else if (n.endsWith('.json')) out.push(n);
  }
  return out.sort();
}

/**
 * The committed lines of a log file and where they end: complete lines (ended by "\n") that parse as records continuing one another. A torn tail is
 * reported (`cut` true) so the caller truncates it; a bad line with a good record after it throws (corruption, not a torn write).
 */
export function scanLog(buf: Buffer, file: string): { lines: string[]; bytes: number; lastSeq: number; cut: boolean } {
  const lines: string[] = [];
  let pos = 0;
  let lastSeq = 0;
  let badAt = -1;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break; // a partial last line: torn
    const text = buf.toString('utf8', pos, nl);
    let seq: number | null = null;
    try {
      const r = JSON.parse(text) as { seq?: unknown };
      if (typeof r === 'object' && r !== null && r.seq === lastSeq + 1) seq = r.seq;
    } catch {
      seq = null;
    }
    if (seq === null) {
      badAt = pos;
      break;
    }
    lines.push(text);
    lastSeq = seq;
    pos = nl + 1;
  }
  if (badAt >= 0) {
    // Is anything after the bad line a good record? Then this is corruption in the middle of the log, not a torn last write.
    const rest = buf.toString('utf8', badAt).split('\n').slice(1);
    for (const l of rest) {
      try {
        const r = JSON.parse(l) as { seq?: unknown };
        if (typeof r === 'object' && r !== null && typeof r.seq === 'number') throw new StoreError('corrupt', `${file}: a bad line before record ${r.seq}: the log is corrupt`);
      } catch (e) {
        if (e instanceof StoreError) throw e;
      }
    }
  }
  return { lines, bytes: pos, lastSeq, cut: pos < buf.length };
}

class FilePersistence implements Persistence {
  constructor(private readonly dir: string) {}

  private sessionPath(id: string): string {
    return join(this.dir, 'sessions', `${checkId('session', id)}.json`);
  }
  gameDir(id: string): string {
    return join(this.dir, 'games', checkId('game', id));
  }
  logPath(id: string): string {
    return join(this.gameDir(id), 'log.jsonl');
  }
  snapshotDir(id: string): string {
    return join(this.gameDir(id), 'snapshots');
  }

  async putSession(s: SessionRow): Promise<void> {
    await writeAtomic(this.sessionPath(s.id), JSON.stringify(sessionToJson(s)));
  }
  async deleteSession(id: string): Promise<void> {
    await rm(this.sessionPath(id), { force: true });
  }
  async putGame(meta: GameMeta): Promise<void> {
    const dir = this.gameDir(meta.id);
    await mkdir(dir, { recursive: true });
    await writeAtomic(join(dir, 'game.json'), JSON.stringify(meta));
  }
  async putStart(id: string, configJson: string, seed: string): Promise<void> {
    const dir = this.gameDir(id);
    await writeAtomic(join(dir, 'start.json'), `{"seed":${JSON.stringify(seed)},"config":${configJson}}`);
    // the log exists (empty) before the game is 'running', and its directory entry is durable
    const fh = await open(this.logPath(id), 'w');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsyncDir(dir);
  }
  async readStart(id: string): Promise<{ configJson: string; seed: string }> {
    const s = await readJson<{ seed: string; config: unknown }>(join(this.gameDir(id), 'start.json'));
    return { seed: s.seed, configJson: JSON.stringify(s.config) };
  }
  /** Each log's committed length, as this process last wrote it (a failed cut-back is retried before the next append). */
  private readonly ends = new Map<string, number>();

  async appendLog(id: string, lines: string[]): Promise<void> {
    const path = this.logPath(id);
    const buf = Buffer.from(lines.map((l) => `${l}\n`).join(''), 'utf8');
    let size = (await stat(path)).size;
    const end = this.ends.get(id);
    if (end !== undefined && size !== end) {
      // an earlier failed append left bytes behind: cut them off before anything is appended after them
      await cutBack(path, end);
      size = end;
    }
    const fh = await open(path, 'a');
    try {
      await writeAll(fh, buf);
      await fh.datasync();
    } catch (e) {
      await fh.close().catch(() => undefined);
      // Nothing of a failed append is kept, a short write's partial bytes included. Windows cannot truncate through an append-mode handle, so the
      // cut goes through a read-write one; if even that fails, the next append cuts first (above), and an open cuts a torn tail.
      this.ends.set(id, size);
      await cutBack(path, size).catch(() => undefined);
      throw e;
    }
    await fh.close();
    this.ends.set(id, size + buf.byteLength);
  }
  async readLog(id: string): Promise<string[]> {
    const path = this.logPath(id);
    if (!(await exists(path))) return [];
    return scanLog(await readFile(path), path).lines;
  }
  async putSnapshot(s: SnapshotRow): Promise<void> {
    const dir = this.snapshotDir(s.game);
    await mkdir(dir, { recursive: true });
    const body = { game: s.game, seq: s.seq, engineBuild: s.engineBuild, hash: s.hash, createdAt: s.createdAt.toISOString(), state: Buffer.from(s.state).toString('base64') };
    await writeAtomic(join(dir, `${s.seq}.json`), JSON.stringify(body));
  }
  async snapshotSeqs(id: string): Promise<number[]> {
    const dir = this.snapshotDir(id);
    if (!(await exists(dir))) return [];
    return (await jsonFiles(dir)).filter((n) => /^\d+\.json$/.test(n)).map((n) => Number(n.slice(0, -5)));
  }
  async readSnapshot(id: string, seq: number): Promise<SnapshotRow> {
    const b = await readJson<{ game: string; seq: number; engineBuild: string; hash: string; createdAt: string; state: string }>(join(this.snapshotDir(id), `${seq}.json`));
    return { game: b.game, seq: b.seq, engineBuild: b.engineBuild, hash: b.hash, createdAt: new Date(b.createdAt), state: new Uint8Array(Buffer.from(b.state, 'base64')) };
  }
  async deleteSnapshots(id: string): Promise<number> {
    const n = (await this.snapshotSeqs(id)).length;
    await rm(this.snapshotDir(id), { recursive: true, force: true });
    return n;
  }
  async deleteGame(id: string): Promise<{ records: number; snapshots: number }> {
    const records = (await this.readLog(id)).length;
    const snapshots = (await this.snapshotSeqs(id)).length;
    await rm(this.gameDir(id), { recursive: true, force: true });
    this.ends.delete(id);
    return { records, snapshots };
  }
  async putResult(r: GameRecord): Promise<void> {
    await writeAtomic(join(this.dir, 'results', `${checkId('game', r.game)}.json`), JSON.stringify(r));
  }
  async putReport(r: ReportRow): Promise<void> {
    await writeAtomic(join(this.dir, 'reports', `${checkId('report', r.id)}.json`), JSON.stringify(reportToJson(r)));
  }
  async close(): Promise<void> {}
}

export interface FileStoreOptions extends IndexedStoreOptions {}

export class FileStore extends IndexedStore {
  private constructor(
    private readonly fio: FilePersistence,
    ix: StoreIndex,
    opts: FileStoreOptions,
  ) {
    super(fio, ix, opts);
  }

  /** Opens (or creates) the store in `dir`: reads the index, cuts torn log tails, rolls finished games forward. Throws for a corrupt log. */
  static async open(dir: string, opts: FileStoreOptions = {}): Promise<FileStore> {
    for (const sub of ['sessions', 'games', 'results', 'reports']) await mkdir(join(dir, sub), { recursive: true });
    const marker = join(dir, 'store.json');
    if (await exists(marker)) {
      const m = await readJson<{ format?: string; version?: number }>(marker);
      if (m.format !== FORMAT.format || m.version !== FORMAT.version) throw new StoreError('value', `${dir} is not a version ${FORMAT.version} OpenMTG file store`);
    } else {
      await writeAtomic(marker, JSON.stringify(FORMAT));
    }
    const fio = new FilePersistence(dir);
    const ix = emptyIndex();
    for (const n of await jsonFiles(join(dir, 'sessions'))) {
      const s = sessionFromJson(await readJson<SessionJson>(join(dir, 'sessions', n)));
      ix.sessions.set(s.id, s);
    }
    for (const n of await jsonFiles(join(dir, 'results'))) {
      const r = await readJson<GameRecord>(join(dir, 'results', n));
      ix.results.set(r.game, r);
    }
    for (const n of await jsonFiles(join(dir, 'reports'))) {
      const r = reportFromJson(await readJson<ReportJson>(join(dir, 'reports', n)));
      ix.reports.set(r.id, r);
    }
    for (const id of await readdir(join(dir, 'games'))) {
      if (!STORE_ID.test(id)) continue;
      const gdir = join(dir, 'games', id);
      await jsonFiles(gdir); // deletes leftover temporary files
      const metaPath = join(gdir, 'game.json');
      if (!(await exists(metaPath))) {
        // createGame was interrupted before its row was written: nothing of the game was ever acknowledged
        await rm(gdir, { recursive: true, force: true });
        continue;
      }
      let meta = await readJson<GameMeta>(metaPath);
      let lastSeq = 0;
      const logPath = join(gdir, 'log.jsonl');
      if (await exists(logPath)) {
        const scan = scanLog(await readFile(logPath), logPath);
        lastSeq = scan.lastSeq;
        if (scan.cut) {
          const fh = await open(logPath, 'r+');
          try {
            await fh.truncate(scan.bytes);
            await fh.sync();
          } finally {
            await fh.close();
          }
        }
      }
      const result = ix.results.get(id);
      if (result && (meta.status === 'running' || meta.status === 'lobby' || meta.status === 'waitingCapacity')) {
        // finishGame or voidGame stopped after the result: roll the status forward
        meta = { ...meta, status: endStatus(result), endedAt: result.endedAt, voidReason: result.outcome === 'void' ? result.reason : null };
        await fio.putGame(meta);
        await fio.deleteSnapshots(id);
      }
      ix.games.set(id, { meta, lastSeq });
    }
    return new FileStore(fio, ix, opts);
  }

  /** The log file of a game (tests simulate torn writes and failing files with it). */
  logPath(game: string): string {
    return this.fio.logPath(game);
  }

  /** Test hook (the contract suite, review 8): writes a snapshot file without the committed-seq check, as a crash could leave one. */
  forceSnapshot(s: SnapshotRow): Promise<void> {
    return this.fio.putSnapshot(s);
  }
}
