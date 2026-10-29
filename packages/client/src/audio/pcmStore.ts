/**
 * Rendered sounds kept in this browser (Review 2026-10-26, Finding 21): the IndexedDB database `openmtg-sounds`, one row per rendered variant, keyed by
 * render.ts `soundCacheKey` (`${id}#${variant}#${recipeHash}`). A later session reads a sound back instead of rendering it again (about 40 MB for the
 * whole set, 145 variants). Rows of keys no longer in use (a changed recipe, a new release) are removed with `prune`.
 *
 * Storage is a convenience: every call settles, never rejects, and answers "nothing stored" when the browser has no IndexedDB, blocks site storage, or
 * fails (a full disk); the engine then renders the sound as if it had never been kept.
 */
import type { Stereo } from './dsp';

export interface PcmStore {
  /** The stored sound of this key, or undefined (not stored, or storage unavailable). */
  get(key: string): Promise<Stereo | undefined>;
  /** Keep a sound under this key (replacing any). Failures are ignored. */
  put(key: string, st: Stereo): Promise<void>;
  /** Remove every stored sound whose key is not in `keep`. */
  prune(keep: ReadonlySet<string>): Promise<void>;
}

/** Sounds kept in memory: for tests. */
export class MemoryPcmStore implements PcmStore {
  readonly rows = new Map<string, Stereo>();
  async get(key: string): Promise<Stereo | undefined> {
    const st = this.rows.get(key);
    return st && { l: st.l.slice(), r: st.r.slice() };
  }
  async put(key: string, st: Stereo): Promise<void> {
    this.rows.set(key, { l: st.l.slice(), r: st.r.slice() });
  }
  async prune(keep: ReadonlySet<string>): Promise<void> {
    for (const k of [...this.rows.keys()]) if (!keep.has(k)) this.rows.delete(k);
  }
}

const DB_NAME = 'openmtg-sounds';
const DB_VERSION = 1;
const STORE = 'pcm';

interface PcmRow {
  key: string;
  l: Float32Array;
  r: Float32Array;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** The browser's store, or null when this browser has no IndexedDB (or reading it throws: storage blocked). */
export function indexedDbPcmStore(factory?: IDBFactory, name = DB_NAME): PcmStore | null {
  let idb: IDBFactory | undefined;
  try {
    idb = factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  } catch {
    idb = undefined;
  }
  if (!idb) return null;
  const source = idb;
  let opened: Promise<IDBDatabase | null> | null = null;
  const db = (): Promise<IDBDatabase | null> => {
    opened ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = source.open(name, DB_VERSION);
        req.onupgradeneeded = () => {
          try {
            const d = req.result;
            if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'key' });
          } catch {
            /* the open then fails or the store is missing: both read as "nothing stored" */
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return opened;
  };
  return {
    async get(key) {
      try {
        const d = await db();
        if (!d) return undefined;
        const row = (await request(d.transaction(STORE, 'readonly').objectStore(STORE).get(key))) as PcmRow | undefined;
        if (!row || !(row.l instanceof Float32Array) || !(row.r instanceof Float32Array) || row.l.length !== row.r.length) return undefined;
        return { l: row.l, r: row.r };
      } catch {
        return undefined;
      }
    },
    async put(key, st) {
      try {
        const d = await db();
        if (!d) return;
        const tx = d.transaction(STORE, 'readwrite');
        const row: PcmRow = { key, l: st.l, r: st.r };
        tx.objectStore(STORE).put(row);
        await done(tx);
      } catch {
        /* not kept: rendered again next session */
      }
    },
    async prune(keep) {
      try {
        const d = await db();
        if (!d) return;
        const keys = (await request(d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys())) as IDBValidKey[];
        const stale = keys.filter((k) => typeof k !== 'string' || !keep.has(k));
        if (stale.length === 0) return;
        const tx = d.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const k of stale) store.delete(k);
        await done(tx);
      } catch {
        /* left for the next session */
      }
    },
  };
}
