/**
 * RPL-1 (replays design 10, D9): the replay library, every replay kept in this browser. Each replay is a summary row (`library`, what the Replays
 * screen lists) and its file (`files`, gzipped JSON as exported, design 4), written together in one transaction.
 *
 * Retention (design 10; adopted answer 4): every game is kept automatically, abandoned ones included. Of the replays not marked Keep, the newest
 * `retentionLimit()` (10, 50 or 200; 50 by default) stay, newest by when they came into the library (an imported old replay is not removed at once),
 * and older ones are removed when a replay is added. The library asks the browser once for persistent storage (`navigator.storage.persist()`), since
 * a browser may clear IndexedDB under pressure.
 *
 * Changes are made one at a time (a queue), so the recorder's finalizing, the fallback recording arriving from its worker and the player's renaming
 * or ticking a toggle never overwrite each other: each change reads the stored file, changes it and writes it back.
 *
 * A replay saved of a game played here carries a completion mark (`LibraryEntry.completion`) until its fallback recording is merged in
 * (completion.ts), so a page closed while the worker ran, or a crash right after the save, leaves the work for the next start.
 *
 * Import (design 4, "Compression and limits"; "Data, never code"): a file is refused, with a message the screen shows as it is, when it is larger
 * than 8 MB, does not expand, is not an OpenMTG replay, is of a newer format, or does not have the format's shape (the engine's `readReplayFile`). A
 * replay already in the library (the same id) is not added twice. The file is kept as it was given, so exporting it again gives the same bytes. Only
 * the named facts of a file go into its summary row, never fields the format does not know (the list reads every row each time it is shown).
 */
import {
  REPLAY_EXTENSION, REPLAY_FORMAT_VERSION, REPLAY_LIMITS, checkReplay, cleanText, fileText, parseBoundedJson,
  readReplayFile, writeGzippedJson, type Checked, type ReplayApp, type ReplayEngine, type ReplayFile, type ReplayGameInfo, type ReplayKind, type ReplayReveal,
} from '@openmtg/engine';
import type { DbRow, ReplayDb } from './db';
import { TITLE_MAX } from './file';

/** What the library lists of a replay (the file's own facts; the file itself is read only to watch, export or change it). */
export interface ReplaySummary {
  id: string;
  title: string;
  createdAt: string;
  kind: ReplayKind;
  formatVersion: number;
  app: ReplayApp;
  engine: ReplayEngine;
  game: ReplayGameInfo;
  reveal: ReplayReveal;
  /** The file has a recording: the fallback of a game replay (design 3), or the whole of a recording. */
  hasRecording: boolean;
}

export interface LibraryEntry extends DbRow {
  summary: ReplaySummary;
  /** Marked Keep: never removed by retention. */
  keep: boolean;
  /** Epoch milliseconds: when it came into this library (retention keeps the newest). */
  addedAt: number;
  /** The stored file's size in bytes. */
  size: number;
  /**
   * Set while the replay of a game played here waits for its fallback recording (completion.ts): from the save until the worker's result is merged
   * in, or until completing it is given up. `tries`: the runs that ended without a recording so far.
   */
  completion?: CompletionMark;
}

export interface CompletionMark {
  tries: number;
  /**
   * RPL-3: the file carries a recording of its own until the worker's lands (an online guest's live recording, online/recording.ts): the worker's
   * replaces it only when this build plays the game as it was recorded; otherwise it stays.
   */
  replace?: true;
}

/** A mark as stored: its tries, and `replace` only when set. */
const markOf = (m: CompletionMark): CompletionMark => ({ tries: m.tries, ...(m.replace ? { replace: true as const } : {}) });

interface FileRow extends DbRow {
  data: Uint8Array;
}

/** The choices of the retention setting (design 10). */
export const RETENTION_CHOICES = [10, 50, 200] as const;
export type RetentionLimit = (typeof RETENTION_CHOICES)[number];
export const DEFAULT_RETENTION: RetentionLimit = 50;
const RETENTION_KEY = 'openmtg.replays.retention';

/** The retention setting: how many replays not marked Keep stay (kept in this browser's local storage). */
export function retentionLimit(): RetentionLimit {
  try {
    const n = Number(globalThis.localStorage?.getItem(RETENTION_KEY));
    return (RETENTION_CHOICES as readonly number[]).includes(n) ? (n as RetentionLimit) : DEFAULT_RETENTION;
  } catch {
    return DEFAULT_RETENTION;
  }
}

export function setRetentionLimit(n: RetentionLimit): void {
  try {
    globalThis.localStorage?.setItem(RETENTION_KEY, String(n));
  } catch {
    // storage blocked: the setting lasts until the page closes (the screen keeps its own state)
  }
}

let persistAsked = false;

/** Ask the browser once per page to keep this site's storage under pressure (design 10, risk 5). Never throws. */
export function requestPersistentStorage(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage;
    if (!storage || typeof storage.persist !== 'function') return;
    void (typeof storage.persisted === 'function' ? storage.persisted() : Promise.resolve(false))
      .then((already) => (already ? true : storage.persist()))
      .catch(() => false);
  } catch {
    // nothing to do: the replays are still saved, only not protected from eviction
  }
}

/**
 * A file's summary row, made of the format's named facts only: a checked file keeps fields the format does not know (an imported file is kept as
 * given), and those are neither copied into the row nor listed.
 */
export function summaryOf(file: ReplayFile): ReplaySummary {
  const { app, engine, game, reveal } = file;
  return {
    id: file.id,
    title: file.title,
    createdAt: file.createdAt,
    kind: file.kind,
    formatVersion: file.formatVersion,
    app: { version: app.version, commit: app.commit },
    engine: { build: engine.build, compiler: engine.compiler, model: engine.model, stateSchema: engine.stateSchema, viewSchema: engine.viewSchema },
    game: {
      mode: game.mode,
      format: game.format,
      players: game.players.map(({ id, name, kind }) => ({ id, name, kind })),
      savedBy: game.savedBy,
      ended: game.ended,
      result: game.result ? { winner: game.result.winner, reason: game.result.reason } : null,
      turns: game.turns,
      actions: game.actions,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
    },
    reveal: { policy: reveal.policy, agreed: [...reveal.agreed] },
    hasRecording: file.recording !== undefined,
  };
}

export { replayStatus, STATUS_LABEL, type ReplayStatus } from '@openmtg/play/replay/status'; // shared with the local server's library

/** A file name for an exported replay: the title without characters file systems refuse, and the extension. */
export function exportFileName(title: string): string {
  const base = cleanText(title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'replay';
  return `${base}${REPLAY_EXTENSION}`;
}

export type ImportResult = { ok: true; entry: LibraryEntry } | { ok: false; message: string };

/** The bytes of a file to keep: its JSON, gzipped (as JSON text when this browser cannot compress; reading takes both). */
export async function encodeReplay(file: ReplayFile): Promise<Uint8Array> {
  const gz = await writeGzippedJson(file);
  if (gz.ok) return gz.value;
  if (gz.error.code !== 'unavailable') throw new Error(gz.error.message);
  return new TextEncoder().encode(JSON.stringify(file));
}

export interface LibraryOptions {
  /** Epoch milliseconds (default Date.now). */
  now?: () => number;
  /** The retention setting (default `retentionLimit`). */
  limit?: () => number;
  /** Asks for persistent storage (default `requestPersistentStorage`). */
  persist?: () => void;
}

export class ReplayLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly limit: () => number;
  private readonly persist: () => void;

  constructor(
    readonly db: ReplayDb,
    opts: LibraryOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.limit = opts.limit ?? retentionLimit;
    this.persist = opts.persist ?? requestPersistentStorage;
  }

  /** Whether replays outlive the page (false: memory only, the screen says so). */
  get persistent(): boolean {
    return this.db.persistent;
  }

  /** Called after every change of the library. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        console.error('[Replays] listener failed', e);
      }
    }
  }

  /** Run one change after the ones before it (a failed change does not stop the next). */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Every replay, newest game first. */
  async list(): Promise<LibraryEntry[]> {
    const rows = await this.db.getAll<LibraryEntry>('library');
    return rows.filter((r) => r.summary !== undefined).sort((a, b) => b.summary.createdAt.localeCompare(a.summary.createdAt) || b.addedAt - a.addedAt);
  }

  async entry(id: string): Promise<LibraryEntry | undefined> {
    return this.db.get<LibraryEntry>('library', id);
  }

  /** The stored file's bytes (gzipped JSON), as exported. */
  async bytes(id: string): Promise<Uint8Array | undefined> {
    return (await this.db.get<FileRow>('files', id))?.data;
  }

  /** The stored file, read and checked as an imported one is (a stored file is data too). */
  async read(id: string): Promise<Checked<ReplayFile>> {
    const data = await this.bytes(id);
    if (!data) return { ok: false, error: { code: 'notReplay', message: 'This replay is no longer in the library.' } };
    return readReplayFile(data);
  }

  /**
   * Put a replay into the library (replacing one of the same id), then apply retention. `data`: its bytes as given (an import). `toComplete`: the
   * replay of a game played here, which waits for its fallback recording (it gets the completion mark); `'replace'` (RPL-3): one whose recording is to
   * be replaced by the worker's when it succeeds (`CompletionMark.replace`). Settles with the entry once it is written: retention after it is best
   * effort (a replay that could not be removed now is removed the next time retention runs).
   */
  add(file: ReplayFile, opts: { keep?: boolean; data?: Uint8Array; toComplete?: boolean | 'replace' } = {}): Promise<LibraryEntry> {
    const completion: CompletionMark | null =
      opts.toComplete === 'replace' && file.recording !== undefined ? { tries: 0, replace: true } : opts.toComplete && file.recording === undefined ? { tries: 0 } : null;
    return this.serial(async () => {
      const entry = await this.write(file, opts.data ?? (await encodeReplay(file)), {
        keep: opts.keep ?? false,
        addedAt: this.now(),
        ...(completion ? { completion } : {}),
      });
      try {
        await this.retainNow(new Set([entry.key]));
      } catch (e) {
        console.error('[Replays] older replays could not be removed', e);
      }
      this.persist();
      this.changed();
      return entry;
    });
  }

  private async write(file: ReplayFile, data: Uint8Array, at: Pick<LibraryEntry, 'keep' | 'addedAt' | 'completion'>): Promise<LibraryEntry> {
    const entry: LibraryEntry = {
      key: file.id,
      summary: summaryOf(file),
      keep: at.keep,
      addedAt: at.addedAt,
      size: data.length,
      ...(at.completion ? { completion: markOf(at.completion) } : {}),
    };
    const row: FileRow = { key: file.id, data };
    await this.db.write([
      { store: 'library', put: entry },
      { store: 'files', put: row },
    ]);
    return entry;
  }

  /**
   * Change a stored replay's file: `change` gets the file as stored and returns the new one (or null to leave it). Null when the replay is gone or its
   * file cannot be read.
   */
  update(id: string, change: (file: ReplayFile) => ReplayFile | null): Promise<LibraryEntry | null> {
    return this.serial(async () => {
      const entry = await this.entry(id);
      if (!entry) return null;
      const read = await this.read(id);
      if (!read.ok) return null;
      const next = change(read.value);
      if (next === null) return entry;
      // The completion mark stays until the file has its recording (a rename or a toggle while the worker runs keeps the work to do); with `replace`,
      // until the recording is another than the one it had (the worker's).
      const unchanged = entry.completion?.replace === true && next.recording === read.value.recording;
      const completion = next.recording === undefined || unchanged ? entry.completion : undefined;
      const out = await this.write(next, await encodeReplay(next), { keep: entry.keep, addedAt: entry.addedAt, completion });
      this.changed();
      return out;
    });
  }

  /**
   * Change a replay's completion mark (completion.ts): `change` gets the mark and returns the new one, or null to remove it (completing it is done
   * or given up). Nothing happens to a replay without a mark.
   */
  markCompletion(id: string, change: (mark: CompletionMark) => CompletionMark | null): Promise<void> {
    return this.serial(async () => {
      const entry = await this.entry(id);
      if (!entry?.completion) return;
      const mark = change(entry.completion);
      const { completion: _done, ...rest } = entry;
      const next: LibraryEntry = mark ? { ...rest, completion: markOf(mark) } : rest;
      await this.db.write([{ store: 'library', put: next }]);
    });
  }

  /** Rename a replay (its file's title too). The title is cleaned of control characters and cut to the format's bound. */
  rename(id: string, title: string): Promise<LibraryEntry | null> {
    const clean = cleanText(title).trim().slice(0, TITLE_MAX);
    return this.update(id, (f) => (f.title === clean ? null : { ...f, title: clean }));
  }

  /** Mark a replay Keep (never removed by retention), or unmark it. */
  setKeep(id: string, keep: boolean): Promise<void> {
    return this.serial(async () => {
      const entry = await this.entry(id);
      if (!entry || entry.keep === keep) return;
      const kept: LibraryEntry = { ...entry, keep };
      await this.db.write([{ store: 'library', put: kept }]);
      this.changed();
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      await this.db.write([
        { store: 'library', delete: id },
        { store: 'files', delete: id },
      ]);
      this.changed();
    });
  }

  /** Apply retention now (the newest `limit` replays not marked Keep stay). Returns the ids removed. */
  retain(): Promise<string[]> {
    return this.serial(async () => {
      const removed = await this.retainNow(new Set());
      if (removed.length > 0) this.changed();
      return removed;
    });
  }

  private async retainNow(spare: ReadonlySet<string>): Promise<string[]> {
    const limit = Math.max(0, this.limit());
    const rows = await this.db.getAll<LibraryEntry>('library');
    const auto = rows.filter((r) => !r.keep && !spare.has(r.key)).sort((a, b) => b.addedAt - a.addedAt);
    const room = Math.max(0, limit - rows.filter((r) => !r.keep && spare.has(r.key)).length);
    const out = auto.slice(room).map((r) => r.key);
    if (out.length > 0) await this.db.write(out.flatMap((id) => [{ store: 'library' as const, delete: id }, { store: 'files' as const, delete: id }]));
    return out;
  }

  /** Import a replay file the player chose or dropped (see the file comment). Never throws. */
  async importFile(file: Blob & { name?: string }): Promise<ImportResult> {
    const label = file.name ? `“${cleanText(file.name).slice(0, 100)}”` : 'The file';
    if (file.size > REPLAY_LIMITS.maxFileBytes) {
      return { ok: false, message: `${label} was not imported: at ${megabytes(file.size)} it is larger than a replay can be (at most ${megabytes(REPLAY_LIMITS.maxFileBytes)}).` };
    }
    let data: Uint8Array;
    try {
      data = new Uint8Array(await readBlob(file));
    } catch (e) {
      return { ok: false, message: `${label} could not be read: ${e instanceof Error ? e.message : String(e)}` };
    }
    return this.importBytes(data, label);
  }

  /** Import a replay from its bytes (see `importFile`). */
  async importBytes(data: Uint8Array, label = 'The file'): Promise<ImportResult> {
    try {
      // The engine's readReplayFile, in its steps, to see the version the file was written in.
      const text = await fileText(data);
      const parsed = text.ok ? parseBoundedJson(text.value) : text;
      const read = parsed.ok ? checkReplay(parsed.value) : parsed;
      if (!read.ok) return { ok: false, message: `${label} was not imported: ${read.error.message}` };
      if (await this.entry(read.value.id)) return { ok: false, message: `${label} is already in your replays (“${read.value.title || 'untitled'}”).` };
      // A file of the current format is kept as given; an older one as the upgrade chain brought it up to date.
      const written = parsed.ok ? (parsed.value as { formatVersion?: unknown }).formatVersion : undefined;
      const entry = await this.add(read.value, written === REPLAY_FORMAT_VERSION ? { data } : {});
      return { ok: true, entry };
    } catch (e) {
      return { ok: false, message: `${label} could not be imported: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

const megabytes = (n: number): string => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** A Blob's bytes (FileReader where `arrayBuffer` is missing). */
function readBlob(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('The file could not be read.'));
    r.readAsArrayBuffer(b);
  });
}
