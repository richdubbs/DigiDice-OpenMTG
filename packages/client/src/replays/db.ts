/**
 * RPL-1 (replays design D9, 7.1, 10): where replays are kept, only in this browser: the IndexedDB database `openmtg-replays`, like `openmtg-images`
 * and `openmtg-decks`. Everything above this file talks to it through `ReplayDb`, a small interface of three calls (read one row, read a store, write
 * a batch of rows in one transaction), so the recorder and the library are tested against `MemoryReplayDb`, and the browser's database is one more
 * implementation of the same three calls.
 *
 * The stores, each keyed by its rows' `key`:
 *  - `inProgress`: the games being played (or left unfinished by a closed tab or a crash): a head row per game and a row per action (inProgress.ts);
 *  - `library`: one summary row per kept replay, what the Replays screen lists (library.ts);
 *  - `files`: the replay files themselves (gzipped JSON, design 4), by the same key, read only to watch, export or change one.
 *
 * A write counts as saved only when its transaction commits (a full disk aborts the transaction after the request itself succeeded), as in the deck
 * store (decks/store.ts).
 */

export type ReplayStoreName = 'inProgress' | 'library' | 'files';

export const REPLAY_STORES: readonly ReplayStoreName[] = ['inProgress', 'library', 'files'];

/** Every row has its key in `key`. */
export interface DbRow {
  key: string;
}

/** One change of a batch: a row written (replacing the row of its key) or the row of a key removed. */
export type DbOp = { store: ReplayStoreName; put: DbRow } | { store: ReplayStoreName; delete: string };

export interface ReplayDb {
  /** False when replays are kept in memory only (no IndexedDB, or site storage blocked). */
  readonly persistent: boolean;
  get<T extends DbRow>(store: ReplayStoreName, key: string): Promise<T | undefined>;
  getAll<T extends DbRow>(store: ReplayStoreName): Promise<T[]>;
  /** Apply every op in one transaction: all of them are saved, or none. */
  write(ops: readonly DbOp[]): Promise<void>;
}

/** A copy as IndexedDB's structured clone makes it (Uint8Arrays copied too), so a caller never edits what is stored. */
const copy = <T>(row: T): T => structuredClone(row);

/** Replays in memory: for tests, and for a browser that cannot open IndexedDB (they then last until the page closes). */
export class MemoryReplayDb implements ReplayDb {
  readonly persistent: boolean = false;
  private readonly stores = new Map<ReplayStoreName, Map<string, DbRow>>(REPLAY_STORES.map((s) => [s, new Map()]));
  /** Writes made, for tests that count them. */
  writes = 0;
  /** Makes the next write fail (tests). */
  failNext: Error | null = null;

  async get<T extends DbRow>(store: ReplayStoreName, key: string): Promise<T | undefined> {
    const row = this.stores.get(store)!.get(key);
    return row === undefined ? undefined : (copy(row) as T);
  }

  async getAll<T extends DbRow>(store: ReplayStoreName): Promise<T[]> {
    return [...this.stores.get(store)!.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => copy(r) as T);
  }

  async write(ops: readonly DbOp[]): Promise<void> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.writes++;
    for (const op of ops) {
      const rows = this.stores.get(op.store)!;
      if ('put' in op) rows.set(op.put.key, copy(op.put));
      else rows.delete(op.delete);
    }
  }
}

const DB_NAME = 'openmtg-replays';
const DB_VERSION = 1;

/** A storage error in plain words (a full disk is the one players can act on). */
function storageError(e: unknown, fallback: string): Error {
  if (e instanceof DOMException && e.name === 'QuotaExceededError') {
    return new Error('This browser has no room left to save replays. Free some site storage, or export replays and delete them here.');
  }
  return e instanceof Error ? e : new Error(fallback);
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(storageError(r.error, 'A replay could not be read'));
  });
}

/** Settles when the transaction commits (or aborts). */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(storageError(tx.error, 'The replay could not be saved'));
    tx.onerror = () => reject(storageError(tx.error, 'The replay could not be saved'));
  });
}

/** The browser's IndexedDB. */
export class IndexedDbReplayDb implements ReplayDb {
  readonly persistent = true;
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  /** The open database; a failed open is not kept, so the next call tries again. */
  open(): Promise<IDBDatabase> {
    if (!this.db) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const r = this.factory.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          for (const s of REPLAY_STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'key' });
        };
        r.onsuccess = () => {
          const db = r.result;
          // Another tab opening a newer version: let it, and open again on the next call.
          db.onversionchange = () => {
            db.close();
            this.db = null;
          };
          resolve(db);
        };
        r.onerror = () => reject(r.error ?? new Error('Could not open the replay library'));
        r.onblocked = () => reject(new Error('The replay library is open in an older tab; close it and reload'));
      });
      this.db = opening;
      opening.catch(() => {
        if (this.db === opening) this.db = null;
      });
    }
    return this.db;
  }

  async get<T extends DbRow>(store: ReplayStoreName, key: string): Promise<T | undefined> {
    const tx = (await this.open()).transaction(store, 'readonly');
    return (await request(tx.objectStore(store).get(key))) as T | undefined;
  }

  async getAll<T extends DbRow>(store: ReplayStoreName): Promise<T[]> {
    const tx = (await this.open()).transaction(store, 'readonly');
    return (await request(tx.objectStore(store).getAll())) as T[];
  }

  async write(ops: readonly DbOp[]): Promise<void> {
    if (ops.length === 0) return;
    const names = [...new Set(ops.map((o) => o.store))];
    const tx = (await this.open()).transaction(names, 'readwrite');
    const done = committed(tx);
    for (const op of ops) {
      const store = tx.objectStore(op.store);
      if ('put' in op) store.put(op.put);
      else store.delete(op.delete);
    }
    await done;
  }
}

/** IndexedDB while the browser lets us open it; otherwise memory (replays then last until the page closes, and the Replays screen says so). */
export class BrowserReplayDb implements ReplayDb {
  private readonly idb: IndexedDbReplayDb;
  private readonly memory = new MemoryReplayDb();
  private fellBack = false;

  constructor(factory: IDBFactory) {
    this.idb = new IndexedDbReplayDb(factory);
  }

  get persistent(): boolean {
    return !this.fellBack;
  }

  private async target(): Promise<ReplayDb> {
    if (this.fellBack) return this.memory;
    try {
      await this.idb.open();
      return this.idb;
    } catch {
      this.fellBack = true;
      return this.memory;
    }
  }

  async get<T extends DbRow>(store: ReplayStoreName, key: string): Promise<T | undefined> {
    return (await this.target()).get<T>(store, key);
  }
  async getAll<T extends DbRow>(store: ReplayStoreName): Promise<T[]> {
    return (await this.target()).getAll<T>(store);
  }
  async write(ops: readonly DbOp[]): Promise<void> {
    return (await this.target()).write(ops);
  }
}

/** The database for this browser: IndexedDB when there is one (memory when it cannot be opened), else memory. */
export function defaultReplayDb(): ReplayDb {
  return typeof indexedDB !== 'undefined' ? new BrowserReplayDb(indexedDB) : new MemoryReplayDb();
}
