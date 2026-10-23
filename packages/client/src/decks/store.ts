/**
 * Where decks live: only in the player's browser (IndexedDB), never sent anywhere (docs/design/decks-and-formats.md "Deck library"). Screens use the
 * `DeckStore` interface. `BrowserDeckStore` is IndexedDB with a memory fallback for browsers without IndexedDB or that block site storage (decks then
 * last only until the page closes, and the library says so); `MemoryDeckStore` also backs tests.
 *
 * A write counts as saved only when its IndexedDB transaction commits (a full disk aborts the transaction after the request itself succeeded). A save
 * can name the version it replaces (`expected`): when the stored deck is a different version (the deck was changed in another tab), nothing is written
 * and the save fails with `DeckConflictError`.
 */
import { isDeck, type Deck } from './model';

export interface DeckStore {
  /** False when decks are kept in memory only (no IndexedDB, or site storage blocked). */
  readonly persistent: boolean;
  /** Why decks are not kept, in plain words (shown by the library); undefined when they are, or when there is no IndexedDB at all. */
  readonly storageNote?: string;
  list(): Promise<Deck[]>;
  get(id: string): Promise<Deck | undefined>;
  /**
   * Save a deck. `expected`: the `updatedAt` of the stored version this save replaces (null: the deck must not exist yet); a different stored version
   * rejects with `DeckConflictError` and writes nothing. Undefined: no check.
   */
  put(deck: Deck, expected?: string | null): Promise<void>;
  delete(id: string): Promise<void>;
}

/** The stored deck is not the version the screen loaded: it was changed somewhere else (another tab). */
export class DeckConflictError extends Error {
  constructor(readonly stored: Deck | undefined) {
    super('This deck was changed in another tab.');
    this.name = 'DeckConflictError';
  }
}

const conflicts = (stored: Deck | undefined, expected: string | null | undefined) =>
  expected !== undefined && (expected === null ? stored !== undefined : stored?.updatedAt !== expected);

/** Fill fields that older records may lack. */
function normalize(d: Deck): Deck {
  return { ...d, notes: typeof d.notes === 'string' ? d.notes : '' };
}

/** Newest first, then by name. */
export function sortDecks(decks: Deck[]): Deck[] {
  return [...decks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

export class MemoryDeckStore implements DeckStore {
  readonly persistent: boolean = false;
  private readonly decks = new Map<string, Deck>();

  constructor(initial: Deck[] = []) {
    for (const d of initial) this.decks.set(d.id, d);
  }

  async list(): Promise<Deck[]> {
    return sortDecks([...this.decks.values()].map((d) => structuredClone(d)));
  }

  async get(id: string): Promise<Deck | undefined> {
    const d = this.decks.get(id);
    return d ? structuredClone(d) : undefined;
  }

  async put(deck: Deck, expected?: string | null): Promise<void> {
    const stored = this.decks.get(deck.id);
    if (conflicts(stored, expected)) throw new DeckConflictError(stored && structuredClone(stored));
    this.decks.set(deck.id, structuredClone(deck));
  }

  async delete(id: string): Promise<void> {
    this.decks.delete(id);
  }
}

const DB_NAME = 'openmtg-decks';
const DB_VERSION = 1;
const STORE = 'decks';

/** A storage error in plain words (a full disk is the one players can act on). */
function storageError(e: unknown, fallback: string): Error {
  if (e instanceof DOMException && e.name === 'QuotaExceededError') {
    return new Error('This browser has no room left to save decks. Free some site storage, or export decks to keep them.');
  }
  return e instanceof Error ? e : new Error(fallback);
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(storageError(r.error, 'IndexedDB request failed'));
  });
}

/** Settles when the transaction commits (or aborts): only a committed write is saved. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(storageError(tx.error, 'The deck library could not save the change'));
    tx.onerror = () => reject(storageError(tx.error, 'The deck library could not save the change'));
  });
}

export class IndexedDbDeckStore implements DeckStore {
  readonly persistent = true;
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  /** The open database; a failed open is not kept, so the next call tries again. */
  open(): Promise<IDBDatabase> {
    if (!this.db) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const r = this.factory.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('Could not open the deck library'));
        r.onblocked = () => reject(new Error('The deck library is open in an older tab; close it and reload'));
      });
      this.db = opening;
      opening.catch(() => {
        if (this.db === opening) this.db = null;
      });
    }
    return this.db;
  }

  private async tx(mode: IDBTransactionMode): Promise<{ tx: IDBTransaction; store: IDBObjectStore }> {
    const tx = (await this.open()).transaction(STORE, mode);
    return { tx, store: tx.objectStore(STORE) };
  }

  async list(): Promise<Deck[]> {
    const all = await request((await this.tx('readonly')).store.getAll());
    return sortDecks((all as unknown[]).filter(isDeck).map(normalize));
  }

  async get(id: string): Promise<Deck | undefined> {
    const d: unknown = await request((await this.tx('readonly')).store.get(id));
    return isDeck(d) ? normalize(d) : undefined;
  }

  async put(deck: Deck, expected?: string | null): Promise<void> {
    const { tx, store } = await this.tx('readwrite');
    const done = committed(tx);
    if (expected === undefined) {
      store.put(deck);
      return done;
    }
    // The check and the write are one transaction (the write is made inside the read's callback, while the transaction is active), so another tab
    // cannot write in between.
    let conflict: DeckConflictError | null = null;
    const read = store.get(deck.id);
    read.onsuccess = () => {
      const raw: unknown = read.result;
      const stored = isDeck(raw) ? normalize(raw) : undefined;
      if (conflicts(stored, expected)) {
        conflict = new DeckConflictError(stored);
        tx.abort();
      } else store.put(deck);
    };
    try {
      await done;
    } catch (e) {
      throw conflict ?? e;
    }
  }

  async delete(id: string): Promise<void> {
    const { tx, store } = await this.tx('readwrite');
    const done = committed(tx);
    store.delete(id);
    await done;
  }
}

/** IndexedDB while the browser lets us open it; otherwise decks are kept in memory and the library says why. */
export class BrowserDeckStore implements DeckStore {
  private readonly idb: IndexedDbDeckStore;
  private readonly memory = new MemoryDeckStore();
  private fellBack = false;

  constructor(factory: IDBFactory) {
    this.idb = new IndexedDbDeckStore(factory);
  }

  get persistent(): boolean {
    return !this.fellBack;
  }

  get storageNote(): string | undefined {
    return this.fellBack ? "This browser is blocking site storage, so decks can't be saved and last only until the page is closed. Export decks to keep them." : undefined;
  }

  private async target(): Promise<DeckStore> {
    if (this.fellBack) return this.memory;
    try {
      await this.idb.open();
      return this.idb;
    } catch {
      this.fellBack = true;
      return this.memory;
    }
  }

  async list() {
    return (await this.target()).list();
  }
  async get(id: string) {
    return (await this.target()).get(id);
  }
  async put(deck: Deck, expected?: string | null) {
    return (await this.target()).put(deck, expected);
  }
  async delete(id: string) {
    return (await this.target()).delete(id);
  }
}

/** The store for this browser: IndexedDB when available (falling back to memory if it cannot be opened), else memory. */
export function defaultDeckStore(): DeckStore {
  return typeof indexedDB !== 'undefined' ? new BrowserDeckStore(indexedDB) : new MemoryDeckStore();
}
