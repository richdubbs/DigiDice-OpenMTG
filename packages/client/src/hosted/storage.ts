/**
 * What the page keeps of its hosted session between sockets and reloads (hosted design D6, 3.2, 4.3):
 *
 * - **The guest token** (32 random bytes as 64 hex digits), issued by the server in `welcome` and sent only in `hello`; never in a URL. It is the player's
 *   seat: whoever has it can sit where the player sits, so it stays in this browser's own storage and nowhere else. One key per server.
 * - **The command counter.** A seat's `act` ids must keep counting up across sockets and reloads: the table answers an older id as `stale`. Every command
 *   takes the next number, and the counter is saved before the command is sent.
 * - **The table last seen** (title, format, clocks, who sits where) and **the invite codes** the creator was shown. A reload into a running game gets no
 *   `table` message (design 3.3), and the server cannot show a code again (design 4.3: it keeps only their hashes), so the page keeps both for the session.
 *
 * Where: the identity (token, counter, name) lives in this tab's `sessionStorage` (it survives a reload) and, for the one tab that owns it, in
 * `localStorage` too, so closing the browser and coming back still finds the seat inside the 5 minutes the drop clock allows. "Owns" is a Web Lock per
 * server: a second tab or window of the same browser finds the lock taken and plays as a guest of its own (a second guest, a second token). Without that two
 * windows of one browser could not play each other: the second hello with the same token would replace the first (4001). Where there is no Web Locks API
 * the first tab owns it. The table and the codes are only in `sessionStorage`.
 *
 * Every read and write is guarded: private windows and blocked storage throw, and the page then works without keeping anything.
 */
import { isHostedToken, type ClockSettings, type HostedFormatId, type SeatNumber, type TableSource, type TableStatus } from '@openmtg/hosted/api';

/** The table as the page last saw it (shown again after a reload, when the server sends no `table` message into a running game). */
export interface StoredTable {
  table: string;
  title: string;
  format: HostedFormatId;
  source: TableSource;
  status: TableStatus;
  clock: ClockSettings;
  /** Who sat where (names only; null for an open seat). */
  seats: { seat: SeatNumber; name: string | null }[];
  /** The seat of this session. */
  you: SeatNumber | null;
}

/** The invite codes of one table's open seats, as the creator was shown them. */
export interface StoredCodes {
  table: string;
  list: { seat: SeatNumber; code: string }[];
}

export interface StoredSession {
  /** The guest token, or null before the server has issued one. */
  token: string | null;
  /** The id of the next command: only goes up. */
  nextId: number;
  /** The name last used. */
  name: string | null;
  table: StoredTable | null;
  codes: StoredCodes | null;
}

export const EMPTY_SESSION: StoredSession = { token: null, nextId: 1, name: null, table: null, codes: null };

export interface HostedStorage {
  /** The session this page continues (or a new, empty one). Once per page. */
  open(): Promise<StoredSession>;
  /** Keeps the session (never throws). */
  save(session: StoredSession): void;
}

/** Nothing kept anywhere (tests, and the page when the browser has no storage). */
export class MemoryHostedStorage implements HostedStorage {
  constructor(public session: StoredSession = EMPTY_SESSION) {}

  open(): Promise<StoredSession> {
    return Promise.resolve(this.session);
  }

  save(session: StoredSession): void {
    this.session = session;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The browser's storage

/** What the browser's storage needs of its environment (tests pass fakes: jsdom has no Web Locks). */
export interface BrowserStorageEnv {
  local: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  locks: LockManagerLike | null;
  /** How long a reloaded tab waits for the page it replaces to let go of the identity lock (ms). */
  lockWaitMs: number;
}

/** The part of `navigator.locks` used here. */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}

function guarded<T>(f: () => T, otherwise: T): T {
  try {
    return f();
  } catch {
    return otherwise;
  }
}

export function defaultBrowserEnv(): BrowserStorageEnv {
  return {
    local: guarded(() => (typeof localStorage === 'undefined' ? null : localStorage), null),
    session: guarded(() => (typeof sessionStorage === 'undefined' ? null : sessionStorage), null),
    locks: guarded(() => (typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator.locks as unknown as LockManagerLike) : null), null),
    lockWaitMs: 1500,
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A stored session read back, or null when it is not one (a damaged or foreign value is dropped, never trusted). */
export function parseStoredSession(text: string | null): StoredSession | null {
  if (text === null) return null;
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(x)) return null;
  const token = typeof x['token'] === 'string' && isHostedToken(x['token']) ? x['token'] : null;
  const nextId = typeof x['nextId'] === 'number' && Number.isSafeInteger(x['nextId']) && x['nextId'] >= 1 && x['nextId'] < 2 ** 31 - 1 ? x['nextId'] : 1;
  const name = typeof x['name'] === 'string' ? x['name'] : null;
  const table = isObject(x['table']) && typeof x['table']['table'] === 'string' ? (x['table'] as unknown as StoredTable) : null;
  const codes =
    isObject(x['codes']) && typeof x['codes']['table'] === 'string' && Array.isArray(x['codes']['list']) ? (x['codes'] as unknown as StoredCodes) : null;
  return { token, nextId, name, table, codes };
}

/**
 * The browser's storage for the hosted server at `serverKey` (its WebSocket origin). See the file comment for who keeps what and where.
 */
export class BrowserHostedStorage implements HostedStorage {
  private readonly key: string;
  private readonly lockName: string;
  private owns = false;
  private readonly env: BrowserStorageEnv;

  constructor(serverKey: string, env: BrowserStorageEnv = defaultBrowserEnv()) {
    this.key = `openmtg.hosted.${serverKey}`;
    this.lockName = `openmtg-hosted:${serverKey}`;
    this.env = env;
  }

  private read(store: BrowserStorageEnv['local']): StoredSession | null {
    return store ? parseStoredSession(guarded(() => store.getItem(this.key), null)) : null;
  }

  private write(store: BrowserStorageEnv['local'], text: string): void {
    if (store) guarded(() => store.setItem(this.key, text), undefined);
  }

  /**
   * Takes the identity lock once per page: at once if it is free, or (a reloaded tab) after waiting for the page it replaces. Held until this page goes
   * away; asking again (a screen that opens the link twice: React's StrictMode, "Try again") gives the same answer, never a lock that this very page holds.
   */
  private acquire(wait: boolean): Promise<boolean> {
    return (this.lock ??= this.request(wait));
  }

  private lock: Promise<boolean> | null = null;

  private request(wait: boolean): Promise<boolean> {
    const locks = this.env.locks;
    if (!locks) return Promise.resolve(true); // no Web Locks: the first tab owns the identity
    return new Promise<boolean>((resolve) => {
      const hold = (lock: unknown) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>(() => undefined);
      };
      try {
        if (!wait) {
          void Promise.resolve(locks.request(this.lockName, { ifAvailable: true }, hold)).catch(() => resolve(true));
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.env.lockWaitMs);
        void Promise.resolve(locks.request(this.lockName, { signal: controller.signal }, (lock) => {
          clearTimeout(timer);
          return hold(lock);
        })).catch(() => resolve(false)); // aborted: another tab still holds it
      } catch {
        resolve(true);
      }
    });
  }

  async open(): Promise<StoredSession> {
    const mine = this.read(this.env.session);
    const shared = this.read(this.env.local);
    if (mine?.token) {
      // This tab's own identity (a reload). It owns the shared one too when that is the same token.
      if (shared?.token === mine.token) this.owns = await this.acquire(true);
      return mine;
    }
    if (shared?.token) {
      if (await this.acquire(false)) {
        this.owns = true;
        return { ...EMPTY_SESSION, ...shared, table: null, codes: null };
      }
      // Another tab of this browser plays as that guest: this one is a guest of its own.
      return { ...EMPTY_SESSION, name: shared.name };
    }
    this.owns = await this.acquire(false);
    return { ...EMPTY_SESSION, ...(mine ? { name: mine.name } : shared ? { name: shared.name } : {}) };
  }

  save(session: StoredSession): void {
    this.write(this.env.session, JSON.stringify(session));
    // The identity alone goes to the browser's shared storage (and only from the tab that owns it): another tab never inherits this tab's table or codes.
    if (this.owns && session.token) this.write(this.env.local, JSON.stringify({ ...session, table: null, codes: null }));
  }
}

/** The storage for a hosted server in this browser. */
export function hostedStorageFor(serverKey: string): HostedStorage {
  return new BrowserHostedStorage(serverKey);
}
