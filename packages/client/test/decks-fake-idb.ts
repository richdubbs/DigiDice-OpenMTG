/**
 * A tiny in-memory IndexedDB for the deck store tests (jsdom has none): open with upgrade, object stores with a key path, readonly/readwrite
 * transactions with get, getAll, put and delete. As in a browser, requests succeed first and the transaction completes (or aborts) afterwards, so a test
 * can make a commit fail after every request succeeded (`abortNextCommit`, as a full disk does) or make `open` fail (`failOpen`, as blocked storage does).
 */

type Row = Record<string, unknown>;
type Handler = (() => void) | null;

class FakeRequest<T = unknown> {
  result = undefined as T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

const later = (f: () => void) => setTimeout(f, 0);
const copy = <T>(v: T): T => structuredClone(v);

class FakeTransaction {
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  error: DOMException | null = null;
  private pending = 0;
  private finished = false;
  private readonly writes: (() => void)[] = [];

  constructor(
    private readonly db: FakeDb,
    readonly mode: IDBTransactionMode,
  ) {
    // A transaction with no requests still completes.
    later(() => this.maybeFinish());
  }

  objectStore(name: string) {
    const rows = this.db.stores.get(name);
    if (!rows) throw new DOMException(`No object store ${name}`, 'NotFoundError');
    const keyPath = this.db.keyPaths.get(name)!;
    const req = <T>(work: () => T) => {
      const r = new FakeRequest<T>();
      this.pending++;
      later(() => {
        r.result = work();
        this.pending--;
        r.onsuccess?.();
        this.maybeFinish();
      });
      return r;
    };
    // Writes are staged and applied only when the transaction commits, so an aborted transaction leaves the data unchanged.
    const staged = new Map<string, Row | null>();
    const read = (k: string) => (staged.has(k) ? staged.get(k) : rows.get(k)) ?? undefined;
    return {
      get: (key: string) => req(() => copy(read(key))),
      getAll: () => req(() => [...new Map([...rows, ...staged]).values()].filter((v): v is Row => v !== null).map(copy)),
      put: (value: Row) =>
        req(() => {
          const k = String(value[keyPath]);
          staged.set(k, copy(value));
          this.writes.push(() => rows.set(k, staged.get(k)!));
          return k;
        }),
      delete: (key: string) =>
        req(() => {
          staged.set(key, null);
          this.writes.push(() => rows.delete(key));
          return undefined;
        }),
    };
  }

  abort() {
    if (this.finished) return;
    this.finished = true;
    later(() => this.onabort?.());
  }

  private maybeFinish() {
    if (this.finished || this.pending > 0) return;
    this.finished = true;
    const failure = this.mode === 'readwrite' && this.writes.length ? this.db.controls.takeCommitFailure() : null;
    if (failure) {
      this.error = failure;
      this.onerror?.();
      this.onabort?.();
      return;
    }
    for (const w of this.writes) w();
    this.oncomplete?.();
  }
}

class FakeDb {
  readonly stores = new Map<string, Map<string, Row>>();
  readonly keyPaths = new Map<string, string>();
  constructor(readonly controls: FakeIdbControls) {}
  readonly objectStoreNames = { contains: (n: string) => this.stores.has(n) };
  createObjectStore(name: string, opts: { keyPath: string }) {
    this.stores.set(name, new Map());
    this.keyPaths.set(name, opts.keyPath);
  }
  transaction(_name: string, mode: IDBTransactionMode = 'readonly') {
    return new FakeTransaction(this, mode);
  }
}

export class FakeIdbControls {
  private commitFailures: DOMException[] = [];
  private openFailure: DOMException | null = null;
  opens = 0;
  readonly db = new FakeDb(this);
  private upgraded = false;

  /** The next readwrite transaction aborts after its requests succeeded (as IndexedDB reports a QuotaExceededError). */
  abortNextCommit(error = new DOMException('The quota has been exceeded.', 'QuotaExceededError')) {
    this.commitFailures.push(error);
  }

  takeCommitFailure(): DOMException | null {
    return this.commitFailures.shift() ?? null;
  }

  /** Every `open` fails with this error until cleared (site storage blocked). */
  failOpen(error: DOMException | null = new DOMException('The operation is insecure.', 'SecurityError')) {
    this.openFailure = error;
  }

  readonly factory = {
    open: (_name: string, _version?: number) => {
      this.opens++;
      const r = new FakeRequest<FakeDb>();
      const failure = this.openFailure;
      if (failure) throw failure;
      later(() => {
        r.result = this.db;
        if (!this.upgraded) {
          this.upgraded = true;
          r.onupgradeneeded?.();
        }
        r.onsuccess?.();
      });
      return r;
    },
  } as unknown as IDBFactory;
}
