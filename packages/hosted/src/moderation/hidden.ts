/**
 * The admin command that hides a table from the lobby (design 4.2: "the operator can hide a table and its title with an admin command run on the
 * server (not a network endpoint)"; package M13-8).
 *
 * The command line and the running server are two processes, so the command is a line appended to a file in `DATA_DIR` (`hidden-tables.jsonl`, one JSON
 * object per line: `{ op: 'hide' | 'unhide', table, at }`), which the server reads again whenever it changes (`HideList`, every 2 s). No socket, no HTTP,
 * nothing a network client can reach. What the command line (M13-13's `cli.ts`, `openmtg-hosted hide <table>`) calls is `hideTable` and `unhideTable`.
 *
 * - **Effect**: a hidden table is not in `browse` and its changes are not in `lobbyUpdate`; the table itself goes on (its seated players keep it and
 *   still see its title, the table closes by its own rules). A hide holds for 24 hours (listings.ts `HIDE_TTL_MS`), far longer than a table lives, so
 *   the file is never a record the server needs to keep: a restart reads it again and hides the tables it still lists.
 * - **Reading** is bounded: the last 1 MiB of the file at most; a line that is not a record (another shape, a table id that is not one) is skipped and
 *   counted in the log, never an error. A deleted file lifts every hide.
 * - **The table id** is checked by the command (the same pattern as the protocol's, `TABLE_ID`) so a path or a stray text never becomes a record.
 */
import { appendFile, mkdir, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TABLE_ID } from '../gateway/frames';
import { HIDE_TTL_MS } from '../lobby/listings';
import { NULL_LOGGER, type Logger } from '../obs';

export interface HideRecord {
  op: 'hide' | 'unhide';
  table: string;
  /** Server time of the command (milliseconds since the epoch). */
  at: number;
}

export const HIDE_FILE = 'hidden-tables.jsonl';
/** The most of the file's end a read looks at. */
export const HIDE_FILE_READ_MAX = 1024 * 1024;
export const HIDE_POLL_MS = 2_000;

/** Where `DATA_DIR` keeps the commands. */
export const hideFileOf = (dataDir: string): string => join(dataDir, HIDE_FILE);

/** Appends one command to `file` (made, with its directory, when it is not there yet). Throws a `RangeError` for a table id that is not one. */
export async function appendHide(file: string, op: HideRecord['op'], table: string, now: number = Date.now()): Promise<HideRecord> {
  if (typeof table !== 'string' || !TABLE_ID.test(table)) throw new RangeError('That is not a table id.');
  const record: HideRecord = { op, table, at: now };
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/** The admin command: hide a table from the lobby (`dataDir`: the server's `DATA_DIR`). */
export const hideTable = (dataDir: string, table: string, now?: number): Promise<HideRecord> => appendHide(hideFileOf(dataDir), 'hide', table, now);

/** The admin command: list a table again. */
export const unhideTable = (dataDir: string, table: string, now?: number): Promise<HideRecord> => appendHide(hideFileOf(dataDir), 'unhide', table, now);

/** The records of a file's text, in order, and how many lines were not records. */
export function parseHideRecords(text: string): { records: HideRecord[]; skipped: number } {
  const records: HideRecord[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let x: unknown;
    try {
      x = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const r = x as Partial<Record<keyof HideRecord, unknown>> | null;
    if (typeof r === 'object' && r !== null && (r.op === 'hide' || r.op === 'unhide') && typeof r.table === 'string' && TABLE_ID.test(r.table) && typeof r.at === 'number' && Number.isFinite(r.at)) {
      records.push({ op: r.op, table: r.table, at: r.at });
    } else skipped++;
  }
  return { records, skipped };
}

/** The tables the records hide at `now` (a table's last command decides; a hide older than `HIDE_TTL_MS` is over), each with the time it was hidden. */
export function effectiveHides(records: readonly HideRecord[], now: number): Map<string, number> {
  const last = new Map<string, HideRecord>();
  for (const r of records) last.set(r.table, r);
  const out = new Map<string, number>();
  for (const [table, r] of last) if (r.op === 'hide' && now - r.at < HIDE_TTL_MS) out.set(table, r.at);
  return out;
}

/** The end of `file` (at most `HIDE_FILE_READ_MAX` bytes, from the start of a line); null when there is no file. */
async function readEnd(file: string): Promise<string | null> {
  let fh;
  try {
    fh = await open(file, 'r');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    const st = await fh.stat();
    // a directory (or anything else) where the file should be is an error, not an empty file: the hides in force stay
    if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOTFILE' });
    const size = st.size;
    const from = Math.max(0, size - HIDE_FILE_READ_MAX);
    if (from === 0) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      return buf.toString('utf8');
    }
    // one byte before the window too: when it is a line end, the window starts at a whole line, which is kept (M13-8 review, finding 5)
    const buf = Buffer.alloc(size - from + 1);
    await fh.read(buf, 0, buf.length, from - 1);
    if (buf[0] === 0x0a) return buf.subarray(1).toString('utf8');
    const nl = buf.indexOf(0x0a, 1);
    return nl < 0 ? '' : buf.subarray(nl + 1).toString('utf8');
  } finally {
    await fh.close();
  }
}

/** What `HideList` tells: the lobby (`LobbyBrowser`). */
export interface Hideable {
  hide(table: string, now: number): boolean;
  unhide(table: string): boolean;
}

export interface HideListOptions {
  file: string;
  lobby: Hideable;
  now?: () => number;
  logger?: Logger;
  pollMs?: number;
}

/** Keeps the lobby's hidden set equal to what the command file says: reads it when it changes (and once at the start), hides and lists again. */
export class HideList {
  private readonly now: () => number;
  private readonly logger: Logger;
  /** What the file has hidden in the lobby now (table and when). */
  private applied = new Map<string, number>();
  /** The file as it was when it was last read (`mtime:size`; null: none was read yet). */
  private seen: string | null = null;
  private polling = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The last read error logged (its code): the same error again is not logged every poll, only when it changes or after a good read. */
  private lastError: string | null = null;

  constructor(private readonly o: HideListOptions) {
    this.now = o.now ?? Date.now;
    this.logger = o.logger ?? NULL_LOGGER;
  }

  /** Reads the file if it changed since the last read and applies it. Never throws (a read that fails is logged and tried again at the next poll). */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const mark = await this.mark();
      if (mark === this.seen) return;
      const text = await readEnd(this.o.file);
      this.seen = mark;
      this.lastError = null;
      const { records, skipped } = parseHideRecords(text ?? '');
      if (skipped > 0) this.logger.log('warn', 'hideFileSkipped', { lines: skipped });
      this.apply(effectiveHides(records, this.now()));
    } catch (e) {
      const error = (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.name : 'error');
      // a directory where the file should be fails every poll: logged once, not every 2 s (M13-8 review, finding 7)
      if (error !== this.lastError) this.logger.log('error', 'hideFileError', { error });
      this.lastError = error;
    } finally {
      this.polling = false;
    }
  }

  /**
   * Polls now and then every `pollMs` (unref'd). The promise settles when the first read is done: the server awaits it before it listens, so a table a
   * hide holds is never listed after a restart, not even for a moment (M13-8 review, finding 7).
   */
  start(): Promise<void> {
    if (this.timer) return Promise.resolve();
    const first = this.poll();
    this.timer = setInterval(() => void this.poll(), this.o.pollMs ?? HIDE_POLL_MS);
    this.timer.unref?.();
    return first;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async mark(): Promise<string> {
    try {
      const s = await stat(this.o.file);
      return `${s.mtimeMs}:${s.size}`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'none';
      throw e;
    }
  }

  private apply(want: Map<string, number>): void {
    for (const [table, at] of want) if (!this.applied.has(table)) this.o.lobby.hide(table, at);
    for (const table of this.applied.keys()) if (!want.has(table)) this.o.lobby.unhide(table);
    this.applied = want;
  }
}
