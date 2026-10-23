/**
 * A small in-memory IndexedDB for client tests (jsdom has none): the subset images/store.ts uses (open with upgrade, object stores with a key path,
 * readonly/readwrite transactions, get, getAll, put, delete, clear). Requests complete asynchronously, in order, then the transaction completes, as in
 * a browser. Values are copied on write and read (like the structured clone), Blobs kept by reference.
 */

type Row = Record<string, unknown>;

interface StoreData {
  keyPath: string;
  rows: Map<string, Row>;
}

interface DbData {
  version: number;
  stores: Map<string, StoreData>;
}

class FakeRequest<T = unknown> {
  result: T = undefined as T;
  error: DOMException | null = null;
  onsuccess: ((e: { target: FakeRequest<T> }) => void) | null = null;
  onerror: ((e: { target: FakeRequest<T> }) => void) | null = null;
  onupgradeneeded: ((e: { target: FakeRequest<T> }) => void) | null = null;
  onblocked: (() => void) | null = null;
}

const copy = (v: Row): Row => ({ ...v });

export interface FakeIdbControls {
  factory: IDBFactory;
  /** The rows of a store, for assertions. */
  rows(db: string, store: string): Row[];
  /** Make the next write transaction fail. */
  failNextWrite(): void;
}

export function fakeIndexedDB(): FakeIdbControls {
  const dbs = new Map<string, DbData>();
  let failWrite = false;

  const makeDb = (name: string, data: DbData) => {
    const db = {
      name,
      get version() {
        return data.version;
      },
      onversionchange: null as null | (() => void),
      objectStoreNames: { contains: (n: string) => data.stores.has(n) },
      createObjectStore(n: string, opts: { keyPath: string }) {
        data.stores.set(n, { keyPath: opts.keyPath, rows: new Map() });
      },
      close() {},
      transaction(names: string | string[], mode: 'readonly' | 'readwrite' = 'readonly') {
        const ops: (() => void)[] = [];
        const shouldFail = mode === 'readwrite' && failWrite;
        if (shouldFail) failWrite = false;
        const tx = {
          error: null as DOMException | null,
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          onabort: null as null | (() => void),
          objectStore(n: string) {
            const listed = Array.isArray(names) ? names : [names];
            if (!listed.includes(n)) throw new Error(`Store ${n} is not in this transaction`);
            const s = data.stores.get(n);
            if (!s) throw new Error(`No object store ${n}`);
            const op = <T>(fn: () => T, writes = false) => {
              if (writes && mode !== 'readwrite') throw new Error('ReadOnlyError');
              const r = new FakeRequest<T>();
              ops.push(() => {
                r.result = fn();
                r.onsuccess?.({ target: r });
              });
              return r;
            };
            return {
              get: (key: string) => op(() => {
                const row = s.rows.get(key);
                return row ? copy(row) : undefined;
              }),
              getAll: () => op(() => [...s.rows.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => copy(v))),
              put: (value: Row) =>
                op(() => {
                  const key = String(value[s.keyPath]);
                  s.rows.set(key, copy(value));
                  return key;
                }, true),
              delete: (key: string) => op(() => void s.rows.delete(key), true),
              clear: () => op(() => void s.rows.clear(), true),
            };
          },
        };
        setTimeout(() => {
          if (shouldFail) {
            tx.error = new DOMException('Quota exceeded', 'QuotaExceededError');
            tx.onerror?.();
            return;
          }
          for (const o of ops) o();
          tx.oncomplete?.();
        }, 0);
        return tx;
      },
    };
    return db;
  };

  const factory = {
    open(name: string, version = 1) {
      const req = new FakeRequest<unknown>();
      setTimeout(() => {
        let data = dbs.get(name);
        const upgrade = !data || data.version < version;
        if (!data) {
          data = { version, stores: new Map() };
          dbs.set(name, data);
        }
        data.version = Math.max(data.version, version);
        req.result = makeDb(name, data);
        if (upgrade) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
    deleteDatabase(name: string) {
      dbs.delete(name);
      return new FakeRequest();
    },
    cmp: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
    databases: async () => [...dbs].map(([name, d]) => ({ name, version: d.version })),
  };

  return {
    factory: factory as unknown as IDBFactory,
    rows: (db, store) => [...(dbs.get(db)?.stores.get(store)?.rows.values() ?? [])],
    failNextWrite: () => {
      failWrite = true;
    },
  };
}

/** Object URLs for jsdom (which has no URL.createObjectURL): "blob:fake/N", remembering which Blob each URL is for. */
export function fakeObjectUrls() {
  let n = 0;
  const live = new Map<string, Blob>();
  const revoked: string[] = [];
  return {
    create: (blob: Blob) => {
      const url = `blob:fake/${++n}`;
      live.set(url, blob);
      return url;
    },
    revoke: (url: string) => {
      live.delete(url);
      revoked.push(url);
    },
    live,
    revoked,
  };
}
